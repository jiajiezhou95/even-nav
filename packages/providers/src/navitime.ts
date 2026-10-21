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
const detailedNode = node.extend({
  details: z
    .array(
      z.object({
        company: company.nullish(),
        companies: z.array(company).nullish(),
        link: z.object({ id, name, type: z.string().nullish() }),
      }),
    )
    .max(100)
    .nullish(),
});
const stationSearch = z.object({
  count: z.object({
    total: z.number().int().nonnegative(),
    offset: z.literal(0),
  }),
  items: z.array(detailedNode).max(100),
  unit: z.object({
    datum: z.literal("wgs84"),
    coord_unit: z.literal("degree"),
  }),
});
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
  if (text === "東京地下鉄(メトロ)") return "東京メトロ";
  if (text === "都営地下鉄") return "東京都交通局";
  return text;
};
const equal = (a: string, b: string) => normalized(a) === normalized(b);
const stationName = (value: string) => {
  const text = normalized(value);
  // Exact reviewed former-name alias, not generic bracket/suffix stripping.
  if (text === "とうきょうスカイツリー[業平橋]")
    return "とうきょうスカイツリー";
  if (text === "田原町(東京都)") return "田原町";
  if (text === "市ケ谷") return "市ヶ谷";
  if (text === "菊川(東京都)") return "菊川";
  if (text === "神田(東京都)") return "神田";
  return text;
};
const lineName = (value: string, agency: string) => {
  const text = normalized(value);
  return text === "新宿線" && operatorName(agency) === "東京都交通局"
    ? "都営新宿線"
    : text;
};
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
      stationName(n.name) === stationName(stop.name) &&
      distance(stop.coordinate, n.coord) <= 500,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
function eligible(leg: RouteLeg) {
  return (
    leg.mode === "RIDE" &&
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
  const stations = new Map<string, z.infer<typeof stationSearch>>();
  // Only populated after independent full physical-line stop-order verification.
  const verifiedPhysicalLegs = new WeakSet<RouteLeg>();
  const accesses = new Map<string, StationAccess>();
  async function get(path: string, params: Record<string, string>) {
    if (stopped || requests >= 20 || signal.aborted) {
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
  async function unidentifiedLine(
    leg: RouteLeg,
  ): Promise<z.infer<typeof links>> {
    const endpoints: z.infer<typeof detailedNode>[] = [];
    for (const stop of [leg.fromStop!, leg.toStop!]) {
      const query = normalized(stop.name!);
      let result = stations.get(query);
      if (!result) {
        result = stationSearch.parse(
          await get("/transport_node", {
            word: query,
            type: "station",
            options: "detail",
          }),
        );
        stations.set(query, result);
      }
      if (result.count.total !== result.items.length)
        return { count: { total: 0, offset: 0 }, items: [] };
      const matched = matchStop(result.items, stop);
      if (!matched) return { count: { total: 0, offset: 0 }, items: [] };
      endpoints.push(result.items.find((n) => n === matched)!);
    }
    const [from, to] = endpoints;
    if (!from || !to || from.id === to.id)
      return { count: { total: 0, offset: 0 }, items: [] };
    const operatorLinks = (n: z.infer<typeof detailedNode>) =>
      (n.details ?? []).filter(
        (d) =>
          (!d.link.type || d.link.type === "train") &&
          [d.company, ...(d.companies ?? [])].some(
            (c) => c && operatorName(c.name) === operatorName(leg.agency!),
          ),
      );
    const fromLinks = operatorLinks(from),
      toLinks = operatorLinks(to);
    const candidates = new Map<string, z.infer<typeof link>>();
    for (const detail of fromLinks) {
      if (
        toLinks.some(
          (d) =>
            d.link.id === detail.link.id &&
            equal(d.link.name, detail.link.name),
        )
      )
        candidates.set(detail.link.id, {
          ...detail.link,
          company: detail.company,
          companies: detail.companies,
          nodes: [from, to],
        });
    }
    if (candidates.size !== 1) {
      const physical = new Map<string, z.infer<typeof link>>();
      for (const detail of from.details ?? []) {
        if (detail.link.type && detail.link.type !== "train") continue;
        if (
          (to.details ?? []).some(
            (d) =>
              (!d.link.type || d.link.type === "train") &&
              d.link.id === detail.link.id &&
              equal(d.link.name, detail.link.name),
          )
        )
          physical.set(detail.link.id, {
            ...detail.link,
            company: detail.company,
            companies: detail.companies,
            nodes: [from, to],
          });
      }
      const unresolved =
        candidates.size > 1 ? [...candidates.values()] : [...physical.values()];
      candidates.clear();
      if (unresolved.length > 3)
        return { count: { total: 0, offset: 0 }, items: [] };
      const passing: z.infer<typeof link>[] = [];
      for (const expected of unresolved) {
        const query = normalized(expected.name);
        let full = searches.get(query);
        if (!full) {
          full = links.parse(
            await get("/transport_link", {
              word: query,
              type: "train",
              options: "node",
              sort: "down",
            }),
          );
          searches.set(query, full);
        }
        const matches = full.items.filter(
          (candidate) =>
            candidate.id === expected.id &&
            equal(candidate.name, expected.name),
        );
        if (full.count.total !== full.items.length || matches.length !== 1)
          return { count: { total: 0, offset: 0 }, items: [] };
        if (full.count.total === full.items.length && matches.length === 1) {
          const candidate = matches[0]!,
            nodes = candidate.nodes ?? [];
          const stops = [
            leg.fromStop!,
            ...(leg.intermediateStops ?? []),
            leg.toStop!,
          ];
          const indices = stops.map((stop) => {
            const matched = matchStop(nodes, stop);
            return matched ? nodes.indexOf(matched) : -1;
          });
          const direction = Math.sign(indices.at(-1)! - indices[0]!);
          if (
            direction &&
            (stops.length > 2 ||
              Math.abs(indices.at(-1)! - indices[0]!) === 1) &&
            indices.every(
              (index, i) =>
                index >= 0 &&
                (i === 0 || Math.sign(index - indices[i - 1]!) === direction),
            )
          ) {
            passing.push(candidate);
          }
        }
      }
      const selected =
        passing.length > 1 && leg.headsign
          ? passing.filter((candidate) =>
              (candidate.nodes ?? []).some(
                (n) => stationName(n.name) === stationName(leg.headsign!),
              ),
            )
          : passing;
      if (selected.length === 1) {
        candidates.set(selected[0]!.id, selected[0]!);
        verifiedPhysicalLegs.add(leg);
      }
    }
    return {
      count: { total: candidates.size, offset: 0 },
      items: [...candidates.values()],
    };
  }
  for (const route of output) {
    let matched = 0;
    let missing = 0;
    let resolvedLine = false;
    for (const leg of route.legs) {
      if (leg.mode !== "RIDE") continue;
      if (!eligible(leg) || stopped) {
        missing++;
        continue;
      }
      try {
        const unknownLine =
          !leg.line?.trim() || /^\d+$/.test(normalized(leg.line));
        const query = lineName(leg.line ?? "", leg.agency!);
        let result: z.infer<typeof links> | undefined;
        if (unknownLine) {
          // Never use another provider's opaque identifier as a NAVITIME line ID.
          const discovered = await unidentifiedLine(leg);
          if (discovered.items.length !== 1) {
            missing++;
            continue;
          }
          const verified = discovered.items[0]!;
          leg.lineOriginal = leg.line;
          leg.line = verified.name;
          leg.lineNameSource = "NAVITIME";
          resolvedLine = true;
          result = discovered;
        }
        result ??= searches.get(query);
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
            !equal(candidate.name, lineName(leg.line!, leg.agency!)) ||
            (!verifiedPhysicalLegs.has(leg) &&
              ![candidate.company, ...(candidate.companies ?? [])].some(
                (c) => c && operatorName(c.name) === operatorName(leg.agency!),
              ))
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
    if (matched || resolvedLine) route.attribution.push("NAVITIME JAPAN");
    selectStationAccessForRoute(route);
  }
  return output;
}
