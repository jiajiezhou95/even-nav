import { describe, expect, it } from "vitest";
import type { Route, RouteLeg } from "../../contracts/src/index";
import { NavigationSession, type LocationFix } from "./navigation";
const now = Date.parse("2026-10-21T00:00:00Z");
const point = (north: number, east = 0) => ({
  lat: north / 111195.08,
  lng: east / 111195.08,
});
const time = (seconds: number) => new Date(now + seconds * 1000).toISOString();
const location = (
  seconds: number,
  north: number,
  east = 0,
  extra: Partial<LocationFix> = {},
): LocationFix => ({
  coordinate: point(north, east),
  timestamp: now + seconds * 1000,
  accuracyMeters: 5,
  ...extra,
});
function segment(
  mode: RouteLeg["mode"],
  north: number,
  east: number,
  endNorth: number,
  endEast: number,
  start: number,
  end: number,
): RouteLeg {
  const geometry = [point(north, east), point(endNorth, endEast)];
  const distanceMeters = Math.hypot(endNorth - north, endEast - east);
  return {
    mode,
    geometry,
    distanceMeters,
    durationSeconds: end - start,
    startTime: time(start),
    endTime: time(end),
    steps:
      mode === "WALK" || mode === "TRANSFER"
        ? [
            {
              geometry,
              distanceMeters,
              durationSeconds: end - start,
              instruction: "Walk",
            },
          ]
        : [],
  };
}
const rail = (start = 30, north = 0, east = 0) =>
  segment("RIDE", north, east, north + 1000, east, start, start + 100);
const waiting = (start = 0, end = 30): RouteLeg => ({
  mode: "WAIT",
  geometry: [],
  steps: [],
  distanceMeters: 0,
  durationSeconds: end - start,
  startTime: time(start),
  endTime: time(end),
});
function start(legs: RouteLeg[], initial = location(0, 0)): NavigationSession {
  const route: Route = {
    id: "auto",
    provider: "TRANSITOUS",
    basemapProvider: "OPEN_MAP",
    fetchedAt: time(0),
    expiresAt: time(60),
    legs,
    distanceMeters: legs.reduce((n, leg) => n + leg.distanceMeters, 0),
    durationSeconds: 500,
    warnings: [],
    attribution: [],
  };
  const session = new NavigationSession();
  const request = session.beginRequest("PLANNING");
  session.acceptRoutes(request.version, [route], initial.coordinate);
  session.start(route.id, initial, now);
  return session;
}
function feed(
  session: NavigationSession,
  seconds: number,
  north: number,
  east = 0,
  extra: Partial<LocationFix> = {},
) {
  return session.updateLocation(
    location(seconds, north, east, extra),
    now + seconds * 1000,
  );
}
function board(session: NavigationSession, offset = 0, north = 0, east = 0) {
  for (const seconds of [30, 35, 40, 45])
    feed(session, seconds + offset, north + (seconds - 30) * 10, east);
}
describe("evidence-driven automatic transit", () => {
  it("boards with normal one-hertz GPS after enough sustained movement", () => {
    const s = start([waiting(), rail()]);
    for (let second = 30; second <= 56; second++)
      feed(s, second, (second - 30) * 4.5);
    expect(s.snapshot.boarded).toBe(true);
    expect(s.snapshot.legIndex).toBe(1);
  });
  it("completes one-hertz boarding, rail, alighting and final walking", () => {
    const s = start([
      waiting(),
      rail(),
      segment("WALK", 1000, 0, 1000, 200, 130, 270),
    ]);
    for (let second = 30; second <= 130; second++)
      feed(s, second, (second - 30) * 10);
    expect(s.snapshot.boarded).toBe(true);
    for (let second = 131; second <= 154; second++)
      feed(s, second, 1000, (second - 130) * 1.5);
    expect(s.snapshot.boarded).toBe(false);
    expect(s.snapshot.legIndex).toBe(2);
    for (
      let second = 155;
      second <= 264 && s.snapshot.phase !== "ARRIVED";
      second++
    )
      feed(s, second, 1000, (second - 130) * 1.5);
    expect(s.snapshot.phase).toBe("ARRIVED");
  });
  it("uses actual boarding stop coordinates rather than a conflicting geometry start", () => {
    const ride = { ...rail(), fromStop: { coordinate: point(0, 200) } };
    const s = start([waiting(), ride]);
    board(s);
    expect(s.snapshot.boarded).toBe(false);
  });
  it("future and fast corridor outliers never advance a confirmed ride", () => {
    const s = start([waiting(), rail()]);
    board(s);
    const before = s.snapshot.progressMeters;
    expect(s.updateLocation(location(50, 200), now + 46000)).toBe(true);
    expect(s.snapshot.progressMeters).toBe(before);
    feed(s, 51, 350);
    expect(s.snapshot.progressMeters).toBe(before);
  });
  it.each([0, 1, 2, 3])(
    "replays door-to-door with %i transfers without confirmation",
    (transfers) => {
      const legs: RouteLeg[] = [
        segment("WALK", -60, 0, 0, 0, 0, 20),
        waiting(20, 30),
      ];
      for (let i = 0; i <= transfers; i++) {
        legs.push(rail(30 + i * 200, i * 1000, i * 80));
        legs.push(
          segment(
            i === transfers ? "WALK" : "TRANSFER",
            (i + 1) * 1000,
            i * 80,
            (i + 1) * 1000,
            i * 80 + (i === transfers ? 200 : 80),
            130 + i * 200,
            210 + i * 200,
          ),
        );
        if (i < transfers) legs.push(waiting(210 + i * 200, 230 + i * 200));
      }
      const s = start(legs, location(0, -60));
      feed(s, 20, 0);
      for (let i = 0; i <= transfers; i++) {
        const offset = i * 200,
          north = i * 1000,
          east = i * 80;
        board(s, offset, north, east);
        expect(s.snapshot.boarded).toBe(true);
        for (const second of [60, 75, 90, 105, 120, 130])
          feed(s, offset + second, north + (second - 30) * 10, east);
        expect(s.snapshot.boarded).toBe(true);
        feed(s, offset + 140, north + 1000, east + 10);
        feed(s, offset + 150, north + 1000, east + 20);
        feed(s, offset + 160, north + 1000, east + 40);
        expect(s.snapshot.boarded).toBe(false);
        expect(s.snapshot.progressMeters).toBeCloseTo(40, 0);
        if (i < transfers) {
          for (const [second, walk] of [
            [170, 50],
            [180, 60],
            [190, 70],
            [200, 80],
          ])
            feed(s, offset + second, north + 1000, east + walk);
          expect(s.snapshot.route!.legs[s.snapshot.legIndex].mode).toBe("WAIT");
        } else {
          for (
            let walk = 50;
            walk <= 200 && s.snapshot.phase !== "ARRIVED";
            walk += 10
          )
            feed(s, offset + 160 + walk - 40, north + 1000, east + walk);
        }
      }
      expect(s.snapshot.phase).toBe("ARRIVED");
      expect(s.snapshot.remainingMeters).toBe(0);
    },
  );
  it("continues through service without a fake alighting", () => {
    const s = start([
      waiting(),
      rail(),
      { ...rail(130, 1000), staySeated: true },
    ]);
    board(s);
    for (const second of [60, 75, 90, 105, 120, 130, 135, 140, 145])
      feed(s, second, (second - 30) * 10);
    expect(s.snapshot.legIndex).toBe(2);
    expect(s.snapshot.boarded).toBe(true);
    expect(s.snapshot.progressMeters).toBeCloseTo(150, 0);
  });
  it("does not alight at an intermediate stop or merely on schedule", () => {
    const s = start([
      waiting(),
      rail(),
      segment("WALK", 1000, 0, 1000, 200, 130, 230),
    ]);
    board(s);
    for (const [second, north, east] of [
      [60, 300, 0],
      [75, 450, 0],
      [90, 500, 0],
      [100, 500, 10],
      [110, 500, 20],
      [120, 500, 40],
      [130, 500, 40],
    ])
      feed(s, second, north, east);
    s.refreshHealth(now + 150000);
    expect(s.snapshot.legIndex).toBe(1);
    expect(s.snapshot.boarded).toBe(true);
  });
  it.each([
    "wrong direction",
    "parallel road",
    "reported speed only",
    "poor accuracy",
    "reported speed contradiction",
    "too early",
  ])("refuses boarding from %s", (kind) => {
    const s = start([waiting(), rail(kind === "too early" ? 300 : 30)]);
    for (const second of [30, 35, 40, 45]) {
      const north =
        kind === "reported speed only"
          ? 0
          : (second - 30) * (kind === "wrong direction" ? -10 : 10);
      feed(
        s,
        second,
        north,
        kind === "parallel road" ? 80 : 0,
        kind === "poor accuracy"
          ? { accuracyMeters: 40 }
          : kind === "reported speed only"
            ? { speedMps: 20 }
            : kind === "reported speed contradiction"
              ? { speedMps: 0 }
              : {},
      );
    }
    expect(s.snapshot.boarded).toBe(false);
    expect(s.snapshot.legIndex).toBe(0);
  });
  it("stale gaps, rejected outliers and pause cannot bridge evidence", () => {
    for (const interruption of ["stale", "outlier", "pause"] as const) {
      const s = start([waiting(), rail()]);
      feed(s, 30, 0);
      feed(s, 35, 50);
      if (interruption === "stale") s.refreshHealth(now + 51000);
      else if (interruption === "outlier") feed(s, 36, 100000);
      else {
        s.pause();
        s.resume(now + 36000);
      }
      feed(s, interruption === "stale" ? 52 : 40, 100);
      feed(s, interruption === "stale" ? 57 : 45, 150);
      expect(s.snapshot.boarded).toBe(false);
    }
  });
  it("duplicate location events do not count as multiple evidence samples", () => {
    const s = start([waiting(), rail()]);
    feed(s, 30, 0);
    for (let i = 0; i < 6; i++) feed(s, 35, 150);
    expect(s.snapshot.boarded).toBe(false);
  });
  it("unknown accuracy, missing geometry or timetable remain uncertain", () => {
    for (const mode of ["accuracy", "geometry", "time"]) {
      const ride = rail();
      if (mode === "geometry") ride.geometry = [];
      if (mode === "time") {
        delete ride.startTime;
        delete ride.endTime;
      }
      const s = start([waiting(), ride]);
      for (const second of [30, 35, 40, 45])
        feed(
          s,
          second,
          (second - 30) * 10,
          0,
          mode === "accuracy" ? { accuracyMeters: undefined } : {},
        );
      expect(s.snapshot.boarded).toBe(false);
    }
  });
  it("bounds underground prompts, defers without changing the trip and clears on confirmation", () => {
    const s = start([waiting(), rail()]);
    s.refreshHealth(now + 59000);
    expect(s.snapshot.transitPrompt).toBeUndefined();
    s.refreshHealth(now + 60000);
    const prompt = s.snapshot.transitPrompt;
    expect(prompt?.action).toBe("BOARDED");
    s.refreshHealth(now + 70000);
    expect(s.snapshot.transitPrompt?.id).toBe(prompt?.id);
    s.deferTransitPrompt(now + 70000);
    s.refreshHealth(now + 189000);
    expect(s.snapshot.transitPrompt).toBeUndefined();
    s.refreshHealth(now + 190000);
    expect(s.snapshot.transitPrompt?.id).not.toBe(prompt?.id);
    s.deferTransitPrompt(now + 190000);
    s.refreshHealth(now + 900000);
    expect(s.snapshot.transitPrompt).toBeUndefined();
    expect(s.snapshot.legIndex).toBe(0);
    s.confirmTransit("BOARDED");
    expect(s.snapshot.transitPrompt).toBeUndefined();
    expect(s.snapshot.boarded).toBe(true);
  });
});
