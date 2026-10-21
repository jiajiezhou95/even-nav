import {
  isCoordinate,
  type Coordinate,
  type Route,
  type RouteLeg,
  type RouteStop,
} from "../../contracts/src/index";

function meters(a: Coordinate, b: Coordinate): number {
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
              Math.sin(((a.lng - b.lng) * rad) / 2) ** 2,
        ),
      ),
    )
  );
}

function adjacentWalk(legs: RouteLeg[], index: number, direction: -1 | 1) {
  let i = index + direction;
  while (legs[i]?.mode === "WAIT") i += direction;
  const leg = legs[i];
  return leg && (leg.mode === "WALK" || leg.mode === "TRANSFER")
    ? leg
    : undefined;
}

function select(
  stop: RouteStop | undefined,
  walk: RouteLeg | undefined,
  boarding: boolean,
) {
  const access = stop?.stationAccess;
  if (!access) return;
  // Recompute per itinerary. Shared station candidates must not carry another
  // alternative's selection, and unavailable geometry must clear stale choices.
  delete access.selectedGateway;
  access.selection = "UNSELECTED_CANDIDATES";
  if (!walk || !isCoordinate(stop?.coordinate)) return;
  const anchor = boarding ? walk.geometry[0] : walk.geometry.at(-1);
  const stationEnd = boarding ? walk.geometry.at(-1) : walk.geometry[0];
  if (
    !isCoordinate(anchor) ||
    !isCoordinate(stationEnd) ||
    meters(stationEnd, stop.coordinate) > 1500
  )
    return;
  const ranked = access.gateways
    .filter(
      (g) =>
        g.name.trim() &&
        isCoordinate(g.coordinate) &&
        meters(g.coordinate, stop.coordinate!) <= 1500,
    )
    .map((gateway) => ({
      gateway,
      distance: meters(anchor, gateway.coordinate),
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        (a.gateway.name < b.gateway.name
          ? -1
          : a.gateway.name > b.gateway.name
            ? 1
            : 0) ||
        a.gateway.coordinate.lat - b.gateway.coordinate.lat ||
        a.gateway.coordinate.lng - b.gateway.coordinate.lng,
    );
  const nearest = ranked[0];
  // Station identity is already verified. Equal distances use a stable display
  // choice; sub-metre differences still select the geometrically nearer exit.
  if (!nearest) return;
  access.selection = "NEAREST_STRAIGHT_LINE";
  access.selectedGateway = {
    ...structuredClone(nearest.gateway),
    distanceMeters: Math.round(nearest.distance),
    reference: boarding ? "WALK_ORIGIN" : "WALK_DESTINATION",
  };
}

/** Mutates metadata only, never route geometry, times, steps or provider exits. */
export function selectStationAccessForRoute(route: Route): void {
  route.legs.forEach((leg, index) => {
    if (leg.mode !== "RIDE") return;
    select(
      leg.fromStop,
      leg.staySeated ? undefined : adjacentWalk(route.legs, index, -1),
      true,
    );
    select(leg.toStop, adjacentWalk(route.legs, index, 1), false);
  });
}
