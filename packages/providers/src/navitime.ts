import { z } from "zod";
import {
  NavError,
  type Coordinate,
  type Route,
  type RouteLeg,
  type RouteStop,
  type StationAccess,
} from "../../contracts/src/index";
import { boundedJson, upstream, type Fetcher } from "./index";
import { selectStationAccessForRoute } from "./station-access";

export const NAVITIME_HOST = "navitime-transport.p.rapidapi.com";
const name = z.string().trim().min(1).max(200);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const coord = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
const node = z.object({ id, name, coord });
const company = z.object({ name });
const link = z.object({
  id,
  name,
  company: company.nullish(),
  companies: z.array(company).nullish(),
  nodes: z.array(node).max(1000).nullish(),
});
const links = z
  .object({
    count: z.object({
      total: z.number().int().nonnegative(),
      offset: z.literal(0),
    }),
    items: z.array(link).max(100).nullish(),
    unit: z
      .object({
        datum: z.literal("wgs84"),
        coord_unit: z.literal("degree"),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.count.total > 0 && (!data.items || !data.unit))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Nonempty search requires items and units",
      });
  })
  .transform((data) => ({ ...data, items: data.items ?? [] }));
const gateways = z.object({
  count: z.object({
    total: z.number().int().nonnegative(),
    offset: z.literal(0),
  }),
  node,
  link: z.object({ id }).nullable(),
  items: z.array(z.object({ name, coord })).max(100).nullable(),
  unit: z.object({
    datum: z.literal("wgs84"),
    coord_unit: z.literal("degree"),
  }),
});
const normalized = (value: string) => {
  const text = value.normalize("NFKC").trim();
  // MOTIS bilingual Japanese labels append a separated Latin translation.
  // Only remove an entirely ASCII suffix after a Japanese-leading name.
  const bilingual = text.match(
    /^([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][^A-Za-z]*?)\s+[A-Za-z][A-Za-z0-9 .,'()/-]*$/u,
  );
  return bilingual ? bilingual[1]!.trim() : text;
};
const operatorName = (value: string) => {
  const text = normalized(value);
  // Reviewed against this provider's live Tokyo Metro response; no fuzzy aliases.
  return text === "東京地下鉄(メトロ)" ? "東京メトロ" : text;
};
const equal = (a: string, b: string) => normalized(a) === normalized(b);
function distance(a: Coordinate, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  return (
    6371000 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(((a.lat - b.lat) * rad) / 2) ** 2 +
            Math.cos(a.lat * rad) *
              Math.cos(b.lat * rad) *
              Math.sin(((a.lng - b.lon) * rad) / 2) ** 2,
        ),
      ),
    )
  );
}
function matchStop(nodes: z.infer<typeof node>[], stop: RouteStop) {
  const matches = nodes.filter(
    (n) =>
      stop.name &&
      stop.coordinate &&
      equal(n.name, stop.name) &&
      distance(stop.coordinate, n.coord) <= 250,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
function eligible(leg: RouteLeg) {
  return (
    leg.mode === "RIDE" &&
    !!leg.line &&
    !/^\d+$/.test(normalized(leg.line)) &&
    !!leg.agency &&
    !!leg.fromStop?.name &&
    !!leg.fromStop.coordinate &&
    !!leg.toStop?.name &&
    !!leg.toStop.coordinate
  );
}

/** Optional metadata only. Never modifies route geometry, times, stops or platform fields. */
export async function enrichNavitime(
  routes: Route[],
  key: string | undefined,
  reserve: () => Promise<void>,
  fetcher: Fetcher = fetch,
): Promise<Route[]> {
  const output = structuredClone(routes);
  for (const route of output)
    route.navitime = {
      exits: key ? "NO_MATCH" : "NOT_CONFIGURED",
      platforms: "NOT_INCLUDED_IN_FREE_TRANSPORT",
    };
  if (!key) return output;
  const signal = AbortSignal.timeout(6000);
  let requests = 0;
  let stopped: "LIMIT_REACHED" | "UNAVAILABLE" | undefined;
  // Request-scoped deduplication only; provider data is never persisted/cached.
  const searches = new Map<string, z.infer<typeof links>>();
  const accesses = new Map<string, StationAccess>();
  async function get(path: string, params: Record<string, string>) {
    if (stopped || requests >= 15 || signal.aborted) {
      stopped ??= signal.aborted ? "UNAVAILABLE" : "LIMIT_REACHED";
      throw new Error("Enrichment stopped");
    }
    await reserve();
    if (signal.aborted) throw new Error("Enrichment expired");
    requests++;
    const url = new URL(`https://${NAVITIME_HOST}${path}`);
    url.search = new URLSearchParams({
      ...params,
      datum: "wgs84",
      coord_unit: "degree",
      limit: "100",
      offset: "0",
    }).toString();
    return boundedJson(
      await upstream(
        url,
        {
          signal,
          headers: { "X-RapidAPI-Key": key!, "X-RapidAPI-Host": NAVITIME_HOST },
        },
        fetcher,
      ),
    );
  }
  for (const route of output) {
    let matched = 0;
    let missing = 0;
    for (const leg of route.legs) {
      if (leg.mode !== "RIDE") continue;
      if (!eligible(leg) || stopped) {
        missing++;
        continue;
      }
      try {
        const query = normalized(leg.line!);
        let result = searches.get(query);
        if (!result) {
          result = links.parse(
            await get("/transport_link", {
              word: query,
              type: "train",
              options: "node",
              sort: "down",
            }),
          );
          searches.set(query, result);
        }
        // A truncated result cannot prove identity is unambiguous.
        if (result.count.total !== result.items.length) {
          missing++;
          continue;
        }
        const candidates = result.items.flatMap((candidate) => {
          if (
            !equal(candidate.name, leg.line!) ||
            ![candidate.company, ...(candidate.companies ?? [])].some(
              (c) => c && operatorName(c.name) === operatorName(leg.agency!),
            )
          )
            return [];
          const from = matchStop(candidate.nodes ?? [], leg.fromStop!);
          const to = matchStop(candidate.nodes ?? [], leg.toStop!);
          return from && to && from.id !== to.id
            ? [{ candidate, from, to }]
            : [];
        });
        if (candidates.length !== 1) {
          missing++;
          continue;
        }
        const { candidate, from, to } = candidates[0]!;
        for (const [stop, source] of [
          [leg.fromStop!, from],
          [leg.toStop!, to],
        ] as const) {
          const lookup = `${candidate.id}:${source.id}`;
          let access = accesses.get(lookup);
          if (!access) {
            const merged: StationAccess["gateways"] = [];
            for (const direction of ["up", "down"] as const) {
              const data = gateways.parse(
                await get("/transport_node/gateway", {
                  node: source.id,
                  link: candidate.id,
                  direction,
                }),
              );
              if (data.count.total !== (data.items?.length ?? 0))
                throw new Error("Incomplete gateways");
              if (
                data.node.id !== source.id ||
                data.link?.id !== candidate.id ||
                !equal(data.node.name, source.name) ||
                distance(
                  { lat: source.coord.lat, lng: source.coord.lon },
                  data.node.coord,
                ) > 250
              )
                throw new Error("Identity mismatch");
              for (const gateway of data.items ?? []) {
                if (
                  distance(
                    { lat: source.coord.lat, lng: source.coord.lon },
                    gateway.coord,
                  ) > 1500
                )
                  continue;
                const existing = merged.find(
                  (x) =>
                    equal(x.name, gateway.name) &&
                    x.coordinate.lat === gateway.coord.lat &&
                    x.coordinate.lng === gateway.coord.lon,
                );
                if (existing) existing.directions.push(direction);
                else
                  merged.push({
                    name: gateway.name,
                    coordinate: {
                      lat: gateway.coord.lat,
                      lng: gateway.coord.lon,
                    },
                    directions: [direction],
                  });
              }
            }
            access = {
              source: "NAVITIME",
              fetchedAt: new Date().toISOString(),
              nodeId: source.id,
              lineId: candidate.id,
              selection: "UNSELECTED_CANDIDATES",
              gateways: merged,
            };
            accesses.set(lookup, access);
          }
          if (access.gateways.length) {
            stop.stationAccess = structuredClone(access);
            matched++;
          } else missing++;
        }
      } catch (error) {
        missing++;
        stopped ??=
          error instanceof NavError && error.code === "QUOTA_EXCEEDED"
            ? "LIMIT_REACHED"
            : "UNAVAILABLE";
      }
    }
    route.navitime!.exits = matched
      ? missing
        ? "PARTIAL"
        : "AVAILABLE"
      : (stopped ?? "NO_MATCH");
    if (matched) route.attribution.push("NAVITIME JAPAN");
    selectStationAccessForRoute(route);
  }
  return output;
}
