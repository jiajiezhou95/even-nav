import { describe, it, expect } from "vitest";
import type { Route } from "../../../packages/contracts/src/index";
import { NavigationSession } from "../../../packages/core/src/navigation";
import {
  departureText,
  nextDeparture,
  MissedDepartureRefresh,
  sameRemainingRides,
  futureTransitRoutes,
} from "./transit-departure";
const now = Date.parse("2026-10-21T00:00:00Z");
const origin = { lat: 35, lng: 139 },
  station = { lat: 35.01, lng: 139 };
function state() {
  const route: Route = {
    id: "synthetic",
    provider: "TRANSITOUS",
    basemapProvider: "GOOGLE_TILES",
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(),
    distanceMeters: 2000,
    durationSeconds: 900,
    warnings: [],
    attribution: ["Synthetic"],
    legs: [
      {
        mode: "WALK",
        geometry: [origin, station],
        distanceMeters: 1000,
        durationSeconds: 30,
        steps: [],
      },
      {
        mode: "RIDE",
        line: "合成蓝线",
        from: "甲站",
        to: "乙站",
        fromStop: { name: "甲站", coordinate: station },
        geometry: [station, { lat: 35.02, lng: 139 }],
        distanceMeters: 1000,
        durationSeconds: 600,
        startTime: new Date(now + 30000).toISOString(),
        steps: [],
      },
    ],
  };
  const session = new NavigationSession();
  const request = session.beginRequest("PLANNING");
  session.acceptRoutes(request.version, [route], origin);
  session.start(
    route.id,
    { coordinate: origin, timestamp: now, accuracyMeters: 5 },
    now,
  );
  return session.snapshot;
}
function observed(guard: MissedDepartureRefresh, s = state()) {
  for (const delta of [30000, 32000]) {
    s.location!.timestamp = now + delta;
    guard.observe(s, now + delta);
  }
  s.location!.timestamp = now + 34000;
  return s;
}
describe("real transit departure countdown and rollover", () => {
  it("ticks from actual timestamp, never invents a later train at zero", () => {
    const s = state();
    expect(departureText(s, now)).toContain("09:00 · 0分30秒");
    expect(departureText(s, now + 15000)).toContain("0分15秒");
    expect(departureText(s, now + 30000)).toContain("已到发车时间");
    s.route!.legs[1].fromStop!.departureTime = new Date(
      now + 90000,
    ).toISOString();
    expect(departureText(s, now)).toContain("09:01 · 1分30秒");
  });
  it("starts only once per service after reliable outside-station evidence, even after failure", () => {
    const guard = new MissedDepartureRefresh(),
      s = observed(guard);
    expect(guard.begin(s, now + 34000)).toBeDefined();
    expect(guard.begin(s, now + 35000)).toBeUndefined();
    guard.finish();
    s.location!.timestamp = now + 100000;
    expect(guard.begin(s, now + 100000)).toBeUndefined();
  });
  it.each(["stale", "poor", "boarded", "paused", "near", "fast"])(
    "does not roll over on %s evidence",
    (kind) => {
      const guard = new MissedDepartureRefresh(),
        s = observed(guard);
      if (kind === "stale") s.locationStale = true;
      if (kind === "poor") s.location!.accuracyMeters = 80;
      if (kind === "boarded") s.boarded = true;
      if (kind === "paused") s.paused = true;
      if (kind === "near") s.location!.coordinate = station;
      if (kind === "fast") s.location!.speedMps = 10;
      expect(guard.begin(s, now + 34000)).toBeUndefined();
    },
  );
  it("remembers station arrival to avoid replacing a possibly boarded underground journey", () => {
    const guard = new MissedDepartureRefresh(),
      s = state();
    s.location!.coordinate = station;
    guard.observe(s, now);
    s.location!.coordinate = origin;
    observed(guard, s);
    expect(guard.begin(s, now + 34000)).toBeUndefined();
  });
  it("rejects fast movement inferred from fixes even when phone speed is absent", () => {
    const guard = new MissedDepartureRefresh(),
      s = state();
    for (const delta of [30000, 32000, 34000]) {
      s.location!.timestamp = now + delta;
      s.location!.coordinate = {
        lat: 35 - (delta - 30000) / 1000000,
        lng: 139,
      };
      guard.observe(s, now + delta);
    }
    expect(guard.begin(s, now + 34000)).toBeUndefined();
  });
  it("rejects response after boarding, route change or stale location", () => {
    const guard = new MissedDepartureRefresh(),
      s = observed(guard),
      ticket = guard.begin(s, now + 34000)!;
    expect(guard.applicable(ticket, s, now + 34000)).toBe(true);
    s.boarded = true;
    expect(guard.applicable(ticket, s, now + 34000)).toBe(false);
    s.boarded = false;
    expect(guard.applicable(ticket, s, now + 40000)).toBe(false);
    s.version++;
    expect(guard.applicable(ticket, s, now + 34000)).toBe(false);
  });
  it("auto-resumes only identical remaining line/station sequence and still-future actual routes", () => {
    const s = state(),
      route = structuredClone(s.route!);
    expect(sameRemainingRides(s, route)).toBe(true);
    route.legs[1].line = "另一条线";
    expect(sameRemainingRides(s, route)).toBe(false);
    expect(futureTransitRoutes([route], now + 30000)).toEqual([]);
    route.legs[1].startTime = new Date(now + 60000).toISOString();
    expect(futureTransitRoutes([route], now + 30000)).toEqual([route]);
    s.legIndex = 1;
    s.boarded = true;
    expect(nextDeparture(s)).toBeUndefined();
  });
});
