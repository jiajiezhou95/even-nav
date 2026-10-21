import { describe, expect, it } from "vitest";
import type { Route, RouteLeg, StationAccess } from "../../contracts/src/index";
import { selectStationAccessForRoute } from "./station-access";

const point = (lng: number) => ({ lat: 35, lng });
function access(): StationAccess {
  return {
    source: "NAVITIME",
    fetchedAt: "2026-10-21T00:00:00Z",
    nodeId: "station",
    lineId: "line",
    selection: "UNSELECTED_CANDIDATES",
    gateways: [
      { name: "西口", coordinate: point(138.999), directions: ["up", "down"] },
      { name: "東口", coordinate: point(139.001), directions: ["up", "down"] },
    ],
  };
}
function leg(mode: RouteLeg["mode"], from = 139, to = 139): RouteLeg {
  return {
    mode,
    geometry: [point(from), point(to)],
    distanceMeters: 100,
    durationSeconds: 60,
    steps: [],
    ...(mode === "RIDE"
      ? {
          fromStop: { coordinate: point(139), stationAccess: access() },
          toStop: { coordinate: point(139), stationAccess: access() },
        }
      : {}),
  };
}
function route(legs: RouteLeg[]): Route {
  return {
    id: "test",
    provider: "TRANSITOUS",
    basemapProvider: "OPEN_MAP",
    fetchedAt: "",
    expiresAt: "",
    legs,
    distanceMeters: 100,
    durationSeconds: 60,
    warnings: [],
    attribution: [],
  };
}
describe("station access geometric selection", () => {
  it("selects boarding near walking origin and alighting near walking destination, preserving candidates and route", () => {
    const value = route([
      leg("WALK", 138.99, 139),
      leg("WAIT"),
      leg("RIDE"),
      leg("WALK", 139, 139.01),
    ]);
    const ride = value.legs[2]!;
    const before = structuredClone(ride);
    selectStationAccessForRoute(value);
    expect(ride.fromStop?.stationAccess).toMatchObject({
      selection: "NEAREST_STRAIGHT_LINE",
      selectedGateway: { name: "西口", reference: "WALK_ORIGIN" },
    });
    expect(ride.toStop?.stationAccess?.selectedGateway).toMatchObject({
      name: "東口",
      reference: "WALK_DESTINATION",
    });
    expect(
      ride.fromStop?.stationAccess?.selectedGateway?.distanceMeters,
    ).toBeGreaterThan(800);
    expect(ride.fromStop?.stationAccess?.gateways).toEqual(
      before.fromStop?.stationAccess?.gateways,
    );
    expect(ride.geometry).toEqual(before.geometry);
    expect(ride.durationSeconds).toBe(before.durationSeconds);
  });
  it("uses transfer walk endpoints rather than remote trip origin/destination", () => {
    const value = route([
      leg("WALK", 138.99, 139),
      leg("RIDE"),
      leg("TRANSFER", 139.002, 138.998),
      leg("RIDE"),
      leg("WALK", 139, 139.01),
    ]);
    selectStationAccessForRoute(value);
    expect(value.legs[1]?.toStop?.stationAccess?.selectedGateway?.name).toBe(
      "西口",
    );
    expect(value.legs[3]?.fromStop?.stationAccess?.selectedGateway?.name).toBe(
      "東口",
    );
  });
  it("does not jump over another ride to find a walking anchor", () => {
    const value = route([
      leg("WALK", 138.99, 139),
      leg("RIDE"),
      leg("RIDE"),
      leg("WALK", 139, 139.01),
    ]);
    selectStationAccessForRoute(value);
    expect(
      value.legs[1]?.toStop?.stationAccess?.selectedGateway,
    ).toBeUndefined();
    expect(
      value.legs[2]?.fromStop?.stationAccess?.selectedGateway,
    ).toBeUndefined();
  });
  it.each([
    "missing geometry",
    "invalid anchor",
    "unrelated walk",
    "no candidates",
    "invalid candidates",
    "distant candidates",
    "tie",
    "stay seated",
  ])("leaves %s unselected and clears stale metadata", (kind) => {
    const value = route([leg("WALK", 138.99, 139), leg("RIDE")]);
    const walk = value.legs[0]!,
      ride = value.legs[1]!,
      station = ride.fromStop!.stationAccess!;
    selectStationAccessForRoute(value);
    expect(station.selectedGateway).toBeDefined();
    if (kind === "missing geometry") walk.geometry = [];
    if (kind === "invalid anchor") walk.geometry[0] = point(NaN);
    if (kind === "unrelated walk") walk.geometry[1] = point(140);
    if (kind === "no candidates") station.gateways = [];
    if (kind === "invalid candidates")
      station.gateways.forEach((g) => (g.coordinate = point(Infinity)));
    if (kind === "distant candidates")
      station.gateways.forEach((g) => (g.coordinate = point(140)));
    if (kind === "tie") walk.geometry[0] = point(139);
    if (kind === "stay seated") ride.staySeated = true;
    selectStationAccessForRoute(value);
    expect(station.selection).toBe("UNSELECTED_CANDIDATES");
    expect(station.selectedGateway).toBeUndefined();
  });
});
