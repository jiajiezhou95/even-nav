import { describe, expect, it } from "vitest";
import { OffRouteRefresh } from "./route-refresh";
import type { NavigationState } from "../../../packages/core/src/navigation";
const now = 1800000000000;
function state(): NavigationState {
  return {
    phase: "NAVIGATING",
    version: 2,
    routes: [],
    route: {
      id: "route",
      legs: [{ mode: "WALK" }],
    } as NavigationState["route"],
    legIndex: 0,
    stepIndex: 0,
    progressMeters: 0,
    remainingMeters: 100,
    stepRemainingMeters: 100,
    location: {
      coordinate: { lat: 35, lng: 139 },
      timestamp: now,
      accuracyMeters: 5,
    },
    locationStale: false,
    offRoute: true,
    replanNeeded: true,
    paused: false,
    boarded: false,
  };
}
describe("off-route request budget", () => {
  it("a new confirmed episode can query immediately", () => {
    const guard = new OffRouteRefresh(),
      s = state();
    expect(guard.begin(s, now)).toBeDefined();
    guard.observe({ ...s, offRoute: false }, now + 1);
    expect(guard.begin(s, now + 2)).toBeDefined();
    expect(guard.begin({ ...s, version: 3 }, now + 3)).toBeDefined();
  });
  it("uses the accepted fix, no repeat ticks; requires moved fresh fix after cooldown and stops at three", () => {
    const guard = new OffRouteRefresh(),
      s = state();
    expect(guard.begin(s, now)?.origin).toEqual(s.location!.coordinate);
    expect(guard.begin(s, now + 1)).toBeUndefined();
    s.location!.timestamp = now + 60000;
    expect(guard.begin(s, now + 60000)).toBeUndefined();
    for (let i = 1; i <= 3; i++) {
      s.location!.timestamp = now + 60000 * i;
      s.location!.coordinate.lng += 0.001;
      expect(Boolean(guard.begin(s, now + 60000 * i))).toBe(i < 3);
    }
  });
  it("rejects uncertain fixes, paused/transit states and stale/moved/version/leg changed replies", () => {
    const guard = new OffRouteRefresh(),
      s = state();
    for (const patch of [
      { paused: true },
      { offRoute: false },
      { locationStale: true },
    ])
      expect(guard.begin({ ...s, ...patch }, now)).toBeUndefined();
    s.location!.accuracyMeters = 26;
    expect(guard.begin(s, now)).toBeUndefined();
    s.location!.accuracyMeters = 5;
    const ticket = guard.begin(s, now)!;
    expect(guard.applicable(ticket, s, now)).toBe(true);
    for (const patch of [
      { paused: true },
      { offRoute: false },
      { version: 3 },
      { legIndex: 1 },
      { phase: "ENDED" as const },
    ])
      expect(guard.applicable(ticket, { ...s, ...patch }, now)).toBe(false);
    expect(guard.applicable(ticket, s, now + 5001)).toBe(false);
    s.location!.coordinate.lng += 0.001;
    expect(guard.applicable(ticket, s, now)).toBe(false);
  });
  it("terminal failure exhausts the episode, a reliable return resets it", () => {
    const guard = new OffRouteRefresh(),
      s = state();
    guard.begin(s, now);
    guard.stopRetries();
    s.location!.timestamp += 60000;
    s.location!.coordinate.lng += 0.001;
    expect(guard.begin(s, now + 60000)).toBeUndefined();
    guard.observe({ ...s, offRoute: false }, now + 60000);
    expect(guard.begin(s, now + 60000)).toBeDefined();
  });
});
