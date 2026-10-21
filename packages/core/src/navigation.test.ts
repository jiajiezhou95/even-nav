import { describe, expect, it } from "vitest";
import {
  NavigationSession,
  availableTransitAction,
  replayLocations,
  type LocationFix,
} from "./navigation";
import {
  distanceMeters,
  fromGeoJSON,
  toGeoJSON,
  worldPixel,
  matchGeometry,
} from "./geometry";
import { parseSharedInput } from "./import";
import type { Route, RouteLeg } from "../../contracts/src/index";
const now = Date.parse("2026-10-20T12:00:00Z");
const origin = { lat: 10, lng: 20 };
const fix = (seconds = 0, lat = 10, lng = 20): LocationFix => ({
  coordinate: { lat, lng },
  timestamp: now + seconds * 1000,
  accuracyMeters: 5,
});
function leg(mode: RouteLeg["mode"] = "WALK"): RouteLeg {
  return {
    mode,
    geometry: [origin, { lat: 10.001, lng: 20 }],
    steps: [
      {
        instruction: "前へ",
        geometry: [origin, { lat: 10.001, lng: 20 }],
        distanceMeters: 111,
        durationSeconds: 80,
      },
    ],
    distanceMeters: 111,
    durationSeconds: 80,
  };
}
function route(legs: RouteLeg[] = [leg()]): Route {
  return {
    id: "synthetic",
    provider: "TRANSITOUS",
    basemapProvider: "OPEN_MAP",
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(),
    legs,
    distanceMeters: legs.length * 111,
    durationSeconds: legs.length * 80,
    warnings: [],
    attribution: ["Synthetic"],
  };
}
function ready(r = route(), config = {}) {
  const s = new NavigationSession(config);
  const request = s.beginRequest("PLANNING");
  s.acceptRoutes(request.version, [r], origin);
  return s;
}
function running(r = route(), config = {}) {
  const s = ready(r, config);
  s.start(r.id, fix(), now);
  return s;
}
describe("request and navigation lifecycle", () => {
  it("aborts previous request and ignores late import", () => {
    const s = new NavigationSession();
    const a = s.beginRequest("IMPORTING"),
      b = s.beginRequest("IMPORTING");
    expect(a.signal.aborted).toBe(true);
    expect(s.acceptImport(a.version, parseSharedInput("10,20"))).toBe(false);
    expect(s.acceptImport(b.version, parseSharedInput("30,40"))).toBe(true);
  });
  it("cancel prevents late route replacement", () => {
    const s = new NavigationSession();
    const a = s.beginRequest("PLANNING");
    s.cancel();
    expect(s.acceptRoutes(a.version, [route()], origin)).toBe(false);
  });
  it("requires explicit selection", () =>
    expect(() =>
      new NavigationSession().start("synthetic", fix(), now),
    ).toThrow());
  it("rejects expired preview", () =>
    expect(() => ready().start("synthetic", fix(121), now + 121000)).toThrow(
      /预览/,
    ));
  it("rejects changed start location", () =>
    expect(() => ready().start("synthetic", fix(0, 10.01), now)).toThrow(
      /起点/,
    ));
  it("rejects stale GPS", () =>
    expect(() => ready().start("synthetic", fix(), now + 16000)).toThrow(
      /定位/,
    ));
  it("rejects invalid coordinates", () =>
    expect(() => ready().start("synthetic", fix(0, NaN), now)).toThrow());
  it("rejects already departed train", () => {
    const ride = {
      ...leg("RIDE"),
      startTime: new Date(now - 1000).toISOString(),
    };
    expect(() => ready(route([ride])).start("synthetic", fix(), now)).toThrow(
      /列车/,
    );
  });
  it("defensively owns accepted routes and snapshot", () => {
    const r = route(),
      s = ready(r);
    r.legs = [];
    const snapshot = s.snapshot;
    snapshot.routes = [];
    expect(s.snapshot.routes[0].legs.length).toBe(1);
  });
  it("atomically replaces route and bumps version", () => {
    const s = running();
    const old = s.snapshot.version;
    const req = s.beginRequest("PLANNING");
    s.acceptRoutes(req.version, [route([leg("DRIVE")])], origin);
    s.start("synthetic", fix(1), now + 1000);
    expect(s.snapshot.route?.legs[0].mode).toBe("DRIVE");
    expect(s.snapshot.version).toBeGreaterThan(old);
  });
  it("end invalidates pending request and stops updates", () => {
    const s = running();
    const r = s.beginRequest("PLANNING");
    s.end();
    expect(r.signal.aborted).toBe(true);
    expect(s.acceptRoutes(r.version, [route()], origin)).toBe(false);
    expect(s.updateLocation(fix(5), now + 5000)).toBe(false);
  });
  it("pause does not advance and resume exposes stale location", () => {
    const s = running();
    s.pause();
    expect(s.updateLocation(fix(5, 10.001), now + 5000)).toBe(false);
    s.resume(now + 20000);
    expect(s.snapshot.locationStale).toBe(true);
  });
});
describe("progress and location reliability", () => {
  it("progress advances with reliable GPS and arrives", () => {
    const s = running();
    s.updateLocation(fix(10, 10.0004), now + 10000);
    expect(s.snapshot.progressMeters).toBeGreaterThan(40);
    s.updateLocation(fix(20, 10.001), now + 20000);
    expect(s.snapshot.phase).toBe("ARRIVED");
  });
  it("rejects out-of-order fixes", () => {
    const s = running();
    expect(s.updateLocation(fix(-1), now)).toBe(false);
  });
  it("rejects implausible jump", () => {
    const s = running();
    expect(s.updateLocation(fix(1, 11), now + 1000)).toBe(false);
    expect(s.snapshot.location?.coordinate).toEqual(origin);
  });
  it("rejects poor accuracy without offroute trigger", () => {
    const s = running();
    for (let i = 1; i < 5; i++)
      s.updateLocation(
        { ...fix(i, 10.0007, 20.0007), accuracyMeters: 500 },
        now + i * 1000,
      );
    expect(s.snapshot.offRoute).toBe(false);
  });
  it("requires multiple credible offroute samples", () => {
    const s = running();
    for (let i = 1; i <= 2; i++)
      s.updateLocation(fix(i * 10, 10, 20.001), now + i * 10000);
    expect(s.snapshot.offRoute).toBe(false);
    s.updateLocation(fix(30, 10, 20.001), now + 30000);
    expect(s.snapshot.replanNeeded).toBe(true);
  });
  it("marks GPS stale but preserves last reliable fix", () => {
    const s = running();
    s.refreshHealth(now + 20000);
    expect(s.snapshot.locationStale).toBe(true);
    expect(s.snapshot.location?.timestamp).toBe(now);
  });
  it("does not rewind progress on modest backward jitter", () => {
    const s = running();
    s.updateLocation(fix(10, 10.0005), now + 10000);
    const progress = s.snapshot.progressMeters;
    s.updateLocation(fix(11, 10.0004), now + 11000);
    expect(s.snapshot.progressMeters).toBe(progress);
  });
  it("replay calls exact navigation core", () => {
    const s = running();
    const frames = replayLocations(s, [fix(10, 10.0005), fix(20, 10.001)]);
    expect(frames[1].phase).toBe("ARRIVED");
  });
});
describe("arbitrary transit legs and manual confirmations", () => {
  it.each([0, 1, 3])("retains %i transfer topology", (transfers) => {
    const legs: RouteLeg[] = [];
    for (let i = 0; i <= transfers; i++) {
      legs.push(leg("WAIT"), leg("RIDE"));
      if (i < transfers) legs.push(leg("TRANSFER"));
    }
    const s = running(route(legs));
    for (let i = 0; i <= transfers; i++) {
      s.confirmTransit("BOARDED");
      s.confirmTransit("ALIGHTED");
      if (i < transfers) s.confirmTransit("TRANSFER_COMPLETED");
    }
    expect(s.snapshot.phase).toBe("ARRIVED");
    expect(s.snapshot.route?.legs.length).toBe(legs.length);
  });
  it("GPS and timetable never automatically alight", () => {
    const s = running(route([leg("RIDE"), leg("WALK")]));
    s.updateLocation(fix(10, 10.001), now + 10000);
    s.refreshHealth(now + 120000);
    expect(s.snapshot.legIndex).toBe(0);
  });
  it("rejects mismatched confirmation", () =>
    expect(() =>
      running(route([leg("WAIT")])).confirmTransit("ALIGHTED"),
    ).toThrow());
  it("missed WAIT departure requests replan", () => {
    const s = running(
      route([
        { ...leg("WAIT"), endTime: new Date(now + 1000).toISOString() },
        leg("RIDE"),
      ]),
    );
    s.refreshHealth(now + 2000);
    expect(s.snapshot.replanNeeded).toBe(true);
  });
});
describe("geometry semantics", () => {
  it("GeoJSON uses lng before lat", () => {
    expect(fromGeoJSON([20, 10])).toEqual(origin);
    expect(toGeoJSON(origin)).toEqual([20, 10]);
  });
  it("rejects invalid GeoJSON", () =>
    expect(() => fromGeoJSON([10, 100])).toThrow());
  it("projects origin world center", () =>
    expect(worldPixel({ lat: 0, lng: 0 }, 0)).toEqual({ x: 128, y: 128 }));
  it("clamps polar projection to finite values", () =>
    expect(Number.isFinite(worldPixel({ lat: 90, lng: 0 }, 2).y)).toBe(true));
  it("meters are geographic not degree distance", () =>
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(
      111195.08,
      0,
    ));
  it("match restricts progress window at repeated coordinates", () => {
    const match = matchGeometry(
      origin,
      [origin, { lat: 10.001, lng: 20 }, origin],
      0,
      50,
    );
    expect(match?.alongMeters).toBe(0);
  });
});

describe("boarding evidence", () => {
  it("does not allow alighting before boarding confirmation", () =>
    expect(() =>
      running(route([leg("RIDE")])).confirmTransit("ALIGHTED"),
    ).toThrow(/上车/));
  it("direct ride requires explicit boarded then alighted", () => {
    const s = running(route([leg("RIDE")]));
    s.confirmTransit("BOARDED");
    expect(s.snapshot.boarded).toBe(true);
    s.confirmTransit("ALIGHTED");
    expect(s.snapshot.phase).toBe("ARRIVED");
  });
});

describe("current step remaining distance", () => {
  it("initializes, decreases and resets on leg transition, arrival and end", () => {
    const first = leg(),
      second = {
        ...leg(),
        geometry: [
          { lat: 10.001, lng: 20 },
          { lat: 10.002, lng: 20 },
        ],
        steps: [
          {
            ...leg().steps[0],
            geometry: [
              { lat: 10.001, lng: 20 },
              { lat: 10.002, lng: 20 },
            ],
          },
        ],
      };
    const s = running(route([first, second]));
    expect(s.snapshot.stepRemainingMeters).toBeCloseTo(111.195, 2);
    s.updateLocation(fix(20, 10.0005), now + 20000);
    expect(s.snapshot.stepRemainingMeters).toBeCloseTo(55.5975, 2);
    s.updateLocation(fix(40, 10.001), now + 40000);
    expect(s.snapshot.legIndex).toBe(1);
    expect(s.snapshot.stepRemainingMeters).toBeCloseTo(111.195, 2);
    s.updateLocation(fix(60, 10.002), now + 60000);
    expect(s.snapshot.phase).toBe("ARRIVED");
    expect(s.snapshot.stepRemainingMeters).toBe(0);
    const stopped = running();
    stopped.end();
    expect(stopped.snapshot.stepRemainingMeters).toBe(0);
  });
  it("preserves last measured distance for stale/paused fixes and clears on new import", () => {
    const s = running(),
      before = s.snapshot.stepRemainingMeters;
    s.updateLocation(fix(1, 10.0005), now + 20000);
    expect(s.snapshot.stepRemainingMeters).toBe(before);
    s.pause();
    s.updateLocation(fix(21, 10.0005), now + 21000);
    expect(s.snapshot.stepRemainingMeters).toBe(before);
    s.beginRequest("IMPORTING");
    expect(s.snapshot.stepRemainingMeters).toBe(0);
  });
});

describe("door-to-door transit replay", () => {
  it("clearing a missed departure preserves an earlier off-route replan request", () => {
    const s = running(
      route([
        leg("WALK"),
        { ...leg("RIDE"), startTime: new Date(now + 35000).toISOString() },
      ]),
    );
    for (let seconds = 10; seconds <= 30; seconds += 10)
      s.updateLocation(fix(seconds, 10, 20.001), now + seconds * 1000);
    expect(s.snapshot.offRoute).toBe(true);
    s.updateLocation(fix(40, 10.001), now + 40000);
    expect(s.snapshot.offRoute).toBe(false);
    expect(s.snapshot.replanNeeded).toBe(true);
    s.refreshHealth(now + 41000);
    s.confirmTransit("BOARDED");
    expect(s.snapshot.replanNeeded).toBe(true);
    s.refreshHealth(now + 42000);
    expect(s.snapshot.replanNeeded).toBe(true);
  });
  it("rejects missing runtime confirmation without advancing a walking leg", () => {
    const s = running();
    // External event input must not match the absence of an available action.
    // @ts-expect-error exercise malformed runtime input
    expect(() => s.confirmTransit(undefined)).toThrow();
    expect(s.snapshot.legIndex).toBe(0);
    expect(s.snapshot.phase).toBe("NAVIGATING");
  });
  it.each([0, 1, 2, 4])(
    "completes access, %i changes and final walk",
    (changes) => {
      const legs: RouteLeg[] = [leg("WALK")];
      for (let i = 0; i <= changes; i++) {
        legs.push(
          { ...leg("WAIT"), distanceMeters: 0, geometry: [], steps: [] },
          leg("RIDE"),
        );
        if (i < changes) legs.push(leg("TRANSFER"));
      }
      legs.push(leg("WALK"));
      const s = running(route(legs));
      s.updateLocation(fix(20, 10.001), now + 20000);
      expect(availableTransitAction(s.snapshot)).toBe("BOARDED");
      for (let i = 0; i <= changes; i++) {
        s.confirmTransit("BOARDED");
        expect(() => s.confirmTransit("BOARDED")).toThrow();
        s.refreshHealth(now + 200000 + i * 1000);
        expect(s.snapshot.locationStale).toBe(true);
        expect(s.snapshot.boarded).toBe(true);
        s.confirmTransit("ALIGHTED");
        expect(s.snapshot.remainingMeters).toBe(
          legs
            .slice(s.snapshot.legIndex)
            .reduce((n, l) => n + l.distanceMeters, 0),
        );
        if (i < changes) {
          expect(availableTransitAction(s.snapshot)).toBe("TRANSFER_COMPLETED");
          s.confirmTransit("TRANSFER_COMPLETED");
          expect(() => s.confirmTransit("TRANSFER_COMPLETED")).toThrow();
        }
      }
      expect(s.snapshot.route?.legs[s.snapshot.legIndex].mode).toBe("WALK");
      expect(s.snapshot.phase).toBe("NAVIGATING");
      expect(s.updateLocation(fix(21, 10.001), now + 300000)).toBe(false);
      expect(s.snapshot.phase).toBe("NAVIGATING");
      s.updateLocation(fix(301, 10.001), now + 301000);
      expect(s.snapshot.phase).toBe("ARRIVED");
      expect(s.snapshot.remainingMeters).toBe(0);
    },
  );
  it("requires explicit through-service continuation without alighting or reboarding", () => {
    const s = running(
      route([
        leg("RIDE"),
        { ...leg("RIDE"), staySeated: true },
        { ...leg("RIDE"), staySeated: true },
        leg("WALK"),
      ]),
    );
    s.confirmTransit("BOARDED");
    for (let index = 0; index < 2; index++) {
      expect(availableTransitAction(s.snapshot)).toBe("STAY_SEATED");
      expect(() => s.confirmTransit("ALIGHTED")).toThrow();
      s.refreshHealth(now + 500000);
      expect(s.snapshot.legIndex).toBe(index);
      s.confirmTransit("STAY_SEATED");
      expect(s.snapshot.boarded).toBe(true);
    }
    expect(availableTransitAction(s.snapshot)).toBe("ALIGHTED");
    s.confirmTransit("ALIGHTED");
    expect(s.snapshot.boarded).toBe(false);
    expect(s.snapshot.remainingMeters).toBe(111);
  });
  it("consecutive different trains still require alighting and new boarding", () => {
    const s = running(route([leg("RIDE"), leg("RIDE")]));
    s.confirmTransit("BOARDED");
    s.confirmTransit("ALIGHTED");
    expect(availableTransitAction(s.snapshot)).toBe("BOARDED");
    expect(() => s.confirmTransit("ALIGHTED")).toThrow();
    s.confirmTransit("BOARDED");
    s.confirmTransit("ALIGHTED");
    expect(s.snapshot.phase).toBe("ARRIVED");
  });
  it.each(["WALK", "TRANSFER", "RIDE"] as const)(
    "detects an unboarded missed train from %s",
    (mode) => {
      const ride = {
        ...leg("RIDE"),
        startTime: new Date(now + 1000).toISOString(),
      };
      const s = running(route(mode === "RIDE" ? [ride] : [leg(mode), ride]));
      s.refreshHealth(now + 2000);
      expect(s.snapshot.replanNeeded).toBe(true);
      expect(s.snapshot.boarded).toBe(false);
    },
  );
  it("preview TTL does not expire an active ride and explicit boarding resolves missed departure", () => {
    const r = route([
      { ...leg("WAIT"), endTime: new Date(now + 1000).toISOString() },
      { ...leg("RIDE"), startTime: new Date(now + 1000).toISOString() },
    ]);
    r.expiresAt = new Date(now + 60000).toISOString();
    const s = running(r);
    s.refreshHealth(now + 2000);
    expect(s.snapshot.replanNeeded).toBe(true);
    s.confirmTransit("BOARDED");
    expect(s.snapshot.replanNeeded).toBe(false);
    s.refreshHealth(now + 120000);
    expect(s.snapshot.replanNeeded).toBe(false);
    expect(s.snapshot.legIndex).toBe(1);
    s.pause();
    expect(availableTransitAction(s.snapshot)).toBeUndefined();
    expect(() => s.confirmTransit("ALIGHTED")).toThrow();
  });
  it("GPS never completes a transfer, even at its end", () => {
    const s = running(route([leg("TRANSFER"), leg("RIDE")]));
    s.updateLocation(fix(20, 10.001), now + 20000);
    expect(s.snapshot.legIndex).toBe(0);
    expect(s.snapshot.progressMeters).toBeGreaterThan(100);
    s.confirmTransit("TRANSFER_COMPLETED");
    expect(s.snapshot.progressMeters).toBe(0);
    expect(s.snapshot.remainingMeters).toBe(111);
  });
});
