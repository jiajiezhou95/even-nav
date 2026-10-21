import type { Route } from "../../../packages/contracts/src/index";
import type {
  NavigationState,
  LocationFix,
} from "../../../packages/core/src/navigation";
import { distanceMeters } from "../../../packages/core/src/geometry";

export function nextDeparture(state: NavigationState) {
  if (state.phase !== "NAVIGATING" || !state.route) return;
  const index = state.route.legs.findIndex(
    (leg, index) =>
      index >= state.legIndex &&
      leg.mode === "RIDE" &&
      !(index === state.legIndex && state.boarded),
  );
  if (index < 0) return;
  const leg = state.route.legs[index];
  const at = Date.parse(
    leg.fromStop?.departureTime ||
      leg.startTime ||
      leg.fromStop?.scheduledDepartureTime ||
      "",
  );
  if (!Number.isFinite(at)) return;
  return { index, leg, at, key: `${state.version}/${index}/${at}` };
}

export function departureText(
  state: NavigationState,
  now = Date.now(),
): string {
  const departure = nextDeparture(state);
  if (!departure) return "";
  const clock = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(departure.at);
  const seconds = Math.max(0, Math.ceil((departure.at - now) / 1000));
  return `${departure.leg.realtime ? "发车" : "计划发车"} ${clock} · ${seconds ? `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒` : "已到发车时间"}`;
}

function outsideStation(state: NavigationState, now: number) {
  const departure = nextDeparture(state),
    fix = state.location;
  if (
    !departure ||
    departure.at > now ||
    state.paused ||
    state.boarded ||
    state.locationStale ||
    !fix ||
    !Number.isFinite(fix.accuracyMeters) ||
    fix.accuracyMeters! > 25 ||
    fix.accuracyMeters! < 0 ||
    fix.timestamp > now ||
    now - fix.timestamp > 5000 ||
    (fix.speedMps !== undefined && fix.speedMps > 3)
  )
    return;
  const station =
    departure.leg.fromStop?.coordinate || departure.leg.geometry[0];
  if (
    !station ||
    distanceMeters(fix.coordinate, station) <= 120 + fix.accuracyMeters!
  )
    return;
  return { departure, station, fix };
}

/** One request per missed service, even on failure; never retry on every GPS/clock tick. */
export class MissedDepartureRefresh {
  private attempted = new Set<string>();
  private lastStarted = -Infinity;
  private pending = false;
  private samples: LocationFix[] = [];
  private sampleKey = "";
  private reachedStation = false;

  observe(state: NavigationState, now = Date.now()) {
    const departure = nextDeparture(state),
      fix = state.location;
    if (departure?.key !== this.sampleKey) {
      this.samples = [];
      this.sampleKey = departure?.key || "";
      this.reachedStation = false;
    }
    const station =
      departure?.leg.fromStop?.coordinate || departure?.leg.geometry[0];
    if (
      fix &&
      station &&
      fix.timestamp <= now &&
      now - fix.timestamp <= 5000 &&
      Number.isFinite(fix.accuracyMeters) &&
      fix.accuracyMeters! <= 25 &&
      distanceMeters(fix.coordinate, station) <= 120 + fix.accuracyMeters!
    )
      this.reachedStation = true;
    if (fix && this.samples.at(-1)?.timestamp !== fix.timestamp)
      this.samples = [...this.samples, structuredClone(fix)]
        .filter((sample) => now - sample.timestamp <= 15000)
        .slice(-15);
  }

  begin(state: NavigationState, now = Date.now()) {
    this.observe(state, now);
    const candidate = outsideStation(state, now);
    if (
      !candidate ||
      this.reachedStation ||
      this.pending ||
      this.attempted.has(candidate.departure.key) ||
      now - this.lastStarted < 60000
    )
      return;
    const reliable = this.samples.filter(
      (fix) =>
        fix.timestamp <= now &&
        now - fix.timestamp <= 10000 &&
        Number.isFinite(fix.accuracyMeters) &&
        fix.accuracyMeters! >= 0 &&
        fix.accuracyMeters! <= 25 &&
        (fix.speedMps === undefined || fix.speedMps <= 3) &&
        distanceMeters(fix.coordinate, candidate.station) >
          120 + fix.accuracyMeters!,
    );
    if (
      reliable.length < 3 ||
      reliable.at(-1)!.timestamp - reliable[0].timestamp < 4000
    )
      return;
    const elapsed = (reliable.at(-1)!.timestamp - reliable[0].timestamp) / 1000;
    if (
      distanceMeters(reliable[0].coordinate, reliable.at(-1)!.coordinate) /
        elapsed >
      3
    )
      return;
    this.attempted.add(candidate.departure.key);
    this.lastStarted = now;
    this.pending = true;
    return {
      key: candidate.departure.key,
      version: state.version,
      legIndex: state.legIndex,
      origin: candidate.fix.coordinate,
    };
  }

  applicable(
    ticket: { key: string; version: number; legIndex: number },
    state: NavigationState,
    now = Date.now(),
  ) {
    const candidate = outsideStation(state, now);
    return Boolean(
      candidate &&
      !this.reachedStation &&
      candidate.departure.key === ticket.key &&
      state.version === ticket.version &&
      state.legIndex === ticket.legIndex,
    );
  }

  finish() {
    this.pending = false;
  }
}

function rideSequence(route: Route, from = 0) {
  return route.legs
    .slice(from)
    .filter((leg) => leg.mode === "RIDE")
    .map((leg) =>
      [
        leg.line,
        leg.agency,
        leg.fromStop?.name || leg.from,
        leg.toStop?.name || leg.to,
      ]
        .map((value) => value?.normalize("NFKC").trim() || "")
        .join("|"),
    );
}

/** Only auto-resume the same remaining stations/lines; other real options require confirmation. */
export function sameRemainingRides(state: NavigationState, route: Route) {
  return Boolean(
    state.route &&
    JSON.stringify(rideSequence(state.route, state.legIndex)) ===
      JSON.stringify(rideSequence(route)),
  );
}

export function futureTransitRoutes(routes: Route[], now = Date.now()) {
  return routes
    .filter((route) => {
      const leg = route.legs.find((leg) => leg.mode === "RIDE");
      const departure = Date.parse(
        leg?.fromStop?.departureTime ||
          leg?.startTime ||
          leg?.fromStop?.scheduledDepartureTime ||
          "",
      );
      return (
        departure > now &&
        Date.parse(route.expiresAt) > now &&
        now - Date.parse(route.fetchedAt) <= 120000
      );
    })
    .slice(0, 3);
}
