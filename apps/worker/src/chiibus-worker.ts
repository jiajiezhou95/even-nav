import {
  NavError,
  type ConfirmedTripRequest,
  type Route,
} from "../../../packages/contracts/src/index";
import {
  googleRoutes,
  type Fetcher,
} from "../../../packages/providers/src/index";
import {
  chiibusEligible,
  loadChiibusFeed,
  planChiibusRoutes,
} from "../../../packages/providers/src/chiibus";
import { reserve, type QuotaNamespace } from "./quota";

// Keep two distinct community bus lines visible without losing the best existing
// itinerary. Different departure times of the same line are not new choices.
export function mergeChiibusRoutes(baseline: Route[], supplement: Route[]) {
  if (!supplement.length) return baseline;
  const arrival = (route: Route) => {
    const end = Date.parse(route.legs.at(-1)?.endTime ?? "");
    return Number.isFinite(end) ? end : Infinity;
  };
  const compare = (a: Route, b: Route) =>
    arrival(a) - arrival(b) || a.durationSeconds - b.durationSeconds;
  const signature = (route: Route) =>
    route.legs
      .filter((leg) => leg.mode === "RIDE")
      .map((leg) => `${leg.agency ?? ""}/${leg.line ?? ""}`)
      .join("|");
  const selected: Route[] = [];
  const seen = new Set<string>();
  for (const route of [...supplement].sort(compare)) {
    const key = signature(route);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(route);
    if (selected.length === 2) break;
  }
  if (!selected.length) return baseline;
  for (const existing of [...baseline].sort(compare)) {
    const key = signature(existing);
    if (seen.has(key)) continue;
    selected.push(existing);
    seen.add(key);
    if (selected.length === 3) break;
  }
  return selected.sort(compare).slice(0, 3);
}

export async function supplementChiibus(
  trip: ConfirmedTripRequest,
  baseline: Route[],
  env: { GOOGLE_API_KEY?: string; QUOTA?: QuotaNamespace },
  fetcher: Fetcher,
  deadline: number,
): Promise<Route[]> {
  const budget = Math.min(8000, deadline - Date.now());
  if (
    budget < 250 ||
    trip.basemapProvider !== "GOOGLE_TILES" ||
    !env.GOOGLE_API_KEY ||
    !chiibusEligible(trip)
  )
    return baseline;
  const controller = new AbortController();
  const boundedFetch: Fetcher = (input, init) =>
    fetcher(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal,
    });
  let walks = 0;
  let terminal: NavError | undefined;
  const check = () => {
    if (terminal) throw terminal;
    if (controller.signal.aborted)
      throw new NavError("PROVIDER_UNAVAILABLE", "公交补充查询超时");
  };
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<Route[]>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve([]);
    }, budget);
  });
  try {
    const work = (async () => {
      const feed = await loadChiibusFeed(boundedFetch, fetcher);
      check();
      return planChiibusRoutes(trip, feed, async (origin, destination) => {
        check();
        if (walks >= 4)
          throw new NavError("PROVIDER_UNAVAILABLE", "步行接驳查询上限");
        walks++;
        try {
          await reserve(env.QUOTA, "ROUTES_ESSENTIALS");
          check();
          const routes = await googleRoutes(
            {
              ...trip,
              origin,
              destination: {
                coordinate: destination,
                coordinateRole: "ENDPOINT",
                evidence: "DOCUMENTED_FIELD",
                source: trip.destination.source.startsWith("GOOGLE")
                  ? trip.destination.source
                  : "OPEN_DATA",
                extractedFrom: "chiibus-and-confirmed-trip-walking-connection",
              },
              mode: "WALK",
              routeProvider: "GOOGLE_ROUTES",
              waypoints: [],
              trafficAware: false,
            },
            env.GOOGLE_API_KEY!,
            boundedFetch,
          );
          check();
          return routes[0];
        } catch (error) {
          if (
            error instanceof NavError &&
            ["QUOTA_EXCEEDED", "AUTH_FAILED", "CONFIG_MISSING"].includes(
              error.code,
            )
          )
            terminal = error;
          throw error;
        }
      });
    })();
    const routes = await Promise.race([work, timeout]);
    if (terminal) throw terminal;
    return mergeChiibusRoutes(baseline, routes);
  } catch (error) {
    // A supplement cannot remove a valid baseline. With no baseline, preserve
    // quota/auth/config errors rather than pretending there are simply no buses.
    if (!baseline.length && terminal) throw terminal;
    if (
      !baseline.length &&
      error instanceof NavError &&
      ["QUOTA_EXCEEDED", "AUTH_FAILED", "CONFIG_MISSING"].includes(error.code)
    )
      throw error;
    return baseline;
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}
