import type { LocationFix } from "../../../packages/core/src/navigation";
import type { Mode } from "../../../packages/contracts/src/index";
import { isCoordinate } from "../../../packages/contracts/src/index";
import { distanceMeters } from "../../../packages/core/src/geometry";
import { staleThreshold } from "./freshness";

/** Direction of measured displacement, never head/device facing or route tangent. */
export function movementBearing(
  previous: LocationFix | undefined,
  current: LocationFix | undefined,
  mode: Mode,
  now = Date.now(),
): number | undefined {
  if (!previous || !current) return;
  if (
    !isCoordinate(previous.coordinate) ||
    !isCoordinate(current.coordinate) ||
    !Number.isFinite(previous.timestamp) ||
    !Number.isFinite(current.timestamp) ||
    !Number.isFinite(now)
  )
    return;
  const elapsed = (current.timestamp - previous.timestamp) / 1000;
  if (
    elapsed <= 0 ||
    elapsed > 30 ||
    now < current.timestamp ||
    now - current.timestamp > staleThreshold(mode)
  )
    return;
  const a = previous.accuracyMeters,
    b = current.accuracyMeters;
  if (
    a === undefined ||
    b === undefined ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a < 0 ||
    b < 0 ||
    a > 25 ||
    b > 25
  )
    return;
  const distance = distanceMeters(previous.coordinate, current.coordinate);
  if (
    distance <= Math.max(8, a + b) ||
    distance / elapsed > (mode === "DRIVE" ? 60 : 8)
  )
    return;
  const radians = Math.PI / 180;
  const lat1 = previous.coordinate.lat * radians,
    lat2 = current.coordinate.lat * radians;
  const delta = (current.coordinate.lng - previous.coordinate.lng) * radians;
  return (
    (Math.atan2(
      Math.sin(delta) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta),
    ) /
      radians +
      360) %
    360
  );
}
/** Use the shortest recent segment that clears GPS uncertainty, with immediate stop suppression. */
export function movementBearingFromHistory(
  history: readonly LocationFix[],
  mode: Mode,
  now = Date.now(),
): number | undefined {
  const current = history.at(-1),
    previous = history.at(-2);
  if (
    !current ||
    !previous ||
    !isCoordinate(current.coordinate) ||
    !isCoordinate(previous.coordinate) ||
    !Number.isFinite(previous.timestamp) ||
    !Number.isFinite(current.timestamp) ||
    current.timestamp <= previous.timestamp ||
    previous.accuracyMeters === undefined ||
    previous.accuracyMeters > 25 ||
    !Number.isFinite(previous.accuracyMeters) ||
    previous.accuracyMeters < 0 ||
    distanceMeters(previous.coordinate, current.coordinate) <= 0.5 ||
    (current.speedMps !== undefined &&
      (!Number.isFinite(current.speedMps) || current.speedMps < 0.3))
  )
    return;
  for (let i = history.length - 2; i >= 0; i--) {
    if (current.timestamp - history[i].timestamp > 30000) break;
    const bearing = movementBearing(history[i], current, mode, now);
    if (bearing !== undefined) return bearing;
  }
}
