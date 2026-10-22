import { isCoordinate, type RouteLeg } from "../../contracts/src/index";
import { distanceMeters, geometryLength, matchGeometry } from "./geometry";
import type { LocationFix, NavigationState, TransitAction } from "./navigation";

// Corroborating GPS/timetable evidence is an inference, not proof of vehicle identity.
const MAX_ACCURACY = 20;
function coherentWindow(fixes: LocationFix[]): boolean {
  if (fixes.length < 4 || fixes.at(-1)!.timestamp - fixes[0].timestamp < 12000)
    return false;
  return fixes.every((fix, index) => {
    if (
      fix.accuracyMeters === undefined ||
      !Number.isFinite(fix.accuracyMeters) ||
      fix.accuracyMeters > MAX_ACCURACY ||
      fix.accuracyMeters < 0
    )
      return false;
    if (!index) return true;
    const previous = fixes[index - 1];
    const seconds = (fix.timestamp - previous.timestamp) / 1000;
    if (seconds <= 0 || seconds > 15) return false;
    const speed = distanceMeters(previous.coordinate, fix.coordinate) / seconds;
    return (
      fix.speedMps === undefined ||
      (Number.isFinite(fix.speedMps) &&
        fix.speedMps >= 0 &&
        Math.abs(fix.speedMps - speed) <= Math.max(2, speed * 0.5))
    );
  });
}
function schedulePlausible(leg: RouteLeg, now: number): boolean {
  const start = Date.parse(leg.startTime ?? "");
  const end = Date.parse(leg.endTime ?? "");
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    now >= start - 60000 &&
    now <= end + 300000
  );
}
function forwardMovement(
  fixes: LocationFix[],
  leg: RouteLeg,
  minimum: number,
  minSpeed: number,
  maxSpeed: number,
): boolean {
  if (leg.geometry.length < 2) return false;
  const matches = fixes.map((fix) =>
    matchGeometry(fix.coordinate, leg.geometry),
  );
  if (matches.some((match) => !match || match.distanceMeters > 25))
    return false;
  const first = matches[0]!,
    last = matches.at(-1)!;
  if (last.alongMeters - first.alongMeters < minimum) return false;
  return matches.slice(1).every((match, index) => {
    const seconds =
      (fixes[index + 1].timestamp - fixes[index].timestamp) / 1000;
    const alongSpeed =
      (match!.alongMeters - matches[index]!.alongMeters) / seconds;
    const physicalSpeed =
      distanceMeters(fixes[index].coordinate, fixes[index + 1].coordinate) /
      seconds;
    return (
      alongSpeed >= minSpeed &&
      alongSpeed <= maxSpeed &&
      physicalSpeed >= minSpeed &&
      physicalSpeed <= maxSpeed
    );
  });
}
function nearStart(fix: LocationFix, leg: RouteLeg, meters: number): boolean {
  const start = isCoordinate(leg.fromStop?.coordinate)
    ? leg.fromStop.coordinate
    : leg.geometry[0];
  return !!start && distanceMeters(fix.coordinate, start) <= meters;
}

/** A proposal only; NavigationSession owns state mutation and action validity. */
export function inferTransitAction(
  state: NavigationState,
  samples: LocationFix[],
  now: number,
): TransitAction | undefined {
  if (state.phase !== "NAVIGATING" || state.paused || state.locationStale)
    return undefined;
  const legs = state.route?.legs;
  if (!legs) return undefined;
  const current = legs[state.legIndex],
    next = legs[state.legIndex + 1];
  // Look for a continuous recent window, never bridge a GPS outage or a rejected fix.
  for (let start = 0; start <= samples.length - 4; start++) {
    const fixes = samples.slice(start);
    if (
      !coherentWindow(fixes) ||
      fixes.some((fix) => fix.timestamp > now) ||
      now - fixes.at(-1)!.timestamp > 5000
    )
      continue;
    const first = fixes[0],
      last = fixes.at(-1)!;
    const boardingRide =
      current.mode === "WAIT"
        ? next
        : current.mode === "RIDE" && !state.boarded
          ? current
          : undefined;
    if (
      boardingRide?.mode === "RIDE" &&
      schedulePlausible(boardingRide, now) &&
      nearStart(first, boardingRide, 60) &&
      forwardMovement(fixes, boardingRide, 100, 4, 70)
    )
      return "BOARDED";
    if (
      current.mode === "RIDE" &&
      state.boarded &&
      next?.mode === "RIDE" &&
      next.staySeated &&
      schedulePlausible(next, now) &&
      nearStart(first, next, 60) &&
      forwardMovement(fixes, next, 100, 4, 70)
    )
      return "STAY_SEATED";
    if (
      current.mode === "RIDE" &&
      state.boarded &&
      (next?.mode === "WALK" || next?.mode === "TRANSFER")
    ) {
      const terminal = isCoordinate(current.toStop?.coordinate)
        ? current.toStop.coordinate
        : current.geometry.at(-1);
      const endTime = Date.parse(current.endTime ?? "");
      if (
        terminal &&
        Number.isFinite(endTime) &&
        now >= endTime - 120000 &&
        now <= endTime + 1800000 &&
        distanceMeters(first.coordinate, terminal) <= 40 &&
        nearStart(first, next, 40) &&
        distanceMeters(last.coordinate, terminal) >= 35 &&
        forwardMovement(fixes, next, 35, 0.3, 3)
      )
        return "ALIGHTED";
    }
    if (current.mode === "TRANSFER") {
      const ride = next?.mode === "WAIT" ? legs[state.legIndex + 2] : next;
      const endpoint = current.geometry.at(-1);
      const match = matchGeometry(last.coordinate, current.geometry);
      if (
        ride?.mode === "RIDE" &&
        schedulePlausible(ride, now) &&
        endpoint &&
        match &&
        geometryLength(current.geometry) - match.alongMeters <= 20 &&
        distanceMeters(last.coordinate, endpoint) <= 20 &&
        nearStart(last, ride, 60) &&
        forwardMovement(fixes, current, 20, 0.3, 3)
      )
        return "TRANSFER_COMPLETED";
    }
  }
  return undefined;
}
