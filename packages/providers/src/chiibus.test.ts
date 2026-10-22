import { describe, it, expect, vi, afterEach } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  parseChiibusFeed,
  planChiibusRoutes,
  chiibusEligible,
  loadChiibusFeed,
} from "./chiibus";
import type {
  ConfirmedTripRequest,
  Route,
  Coordinate,
} from "../../contracts/src/index";
function fixture(overrides: Record<string, string> = {}) {
  const files = {
    "feed_info.txt": "feed_start_date,feed_end_date\n20260101,20261231",
    "agency.txt": "agency_name,agency_timezone\nTest operator,Asia/Tokyo",
    "routes.txt":
      "route_id,route_long_name,route_type\n00001,赤坂ルート,3\n00006,青山ルート,3",
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\na,甲,35.67,139.73\nb,乙,35.671,139.73\nc,丙,35.672,139.73",
    "shapes.txt":
      "shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon\ns,1,35.67,139.73\ns,2,35.6705,139.7301\ns,3,35.671,139.73\ns,4,35.6715,139.7301\ns,5,35.672,139.73\ns,6,35.671,139.73\ns,7,35.67,139.73",
    "trips.txt":
      "trip_id,route_id,service_id,shape_id,trip_headsign\nt,00001,d,s,丙方向\nu,00001,d,s,丙方向\nv,00006,d,s,丙方向",
    "stop_times.txt":
      "trip_id,stop_id,stop_sequence,arrival_time,departure_time,pickup_type,drop_off_type\nt,a,1,09:02:00,09:02:00,0,1\nt,b,2,09:04:00,09:04:00,0,0\nt,c,3,09:06:00,09:06:00,1,0\nu,a,1,09:12:00,09:12:00,0,1\nu,b,2,09:14:00,09:14:00,0,0\nu,c,3,09:16:00,09:16:00,1,0\nv,a,1,09:12:00,09:12:00,0,1\nv,b,2,09:14:00,09:14:00,0,0\nv,c,3,09:16:00,09:16:00,1,0",
    "calendar.txt":
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nd,1,1,1,1,1,0,0,20260101,20261231",
    "calendar_dates.txt": "service_id,date,exception_type\nd,20261024,1",
    ...overrides,
  };
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  );
}
const request = (): ConfirmedTripRequest => ({
  requestVersion: 1,
  origin: { lat: 35.67, lng: 139.73 },
  originPolicy: "CURRENT_DEVICE_LOCATION",
  destination: {
    coordinate: { lat: 35.672, lng: 139.73 },
    evidence: "USER_INPUT",
    source: "USER_INDEPENDENT_INPUT",
    extractedFrom: "test",
    coordinateRole: "ENDPOINT",
  },
  mode: "TRANSIT",
  departureTime: "2026-10-22T09:00:00+09:00",
  waypoints: [],
  routeProvider: "TRANSITOUS",
  basemapProvider: "GOOGLE_TILES",
  userConfirmed: true,
});
function walking(seconds = 180) {
  return vi.fn(async (a: Coordinate, b: Coordinate): Promise<Route> => ({
    id: "walk",
    provider: "GOOGLE_ROUTES",
    basemapProvider: "GOOGLE_TILES",
    fetchedAt: "2026-10-22T00:00:00Z",
    expiresAt: "2026-10-22T00:02:00Z",
    durationSeconds: seconds,
    distanceMeters: 100,
    legs: [
      {
        mode: "WALK",
        geometry: [a, b],
        steps: [
          {
            instruction: "直行",
            geometry: [a, b],
            distanceMeters: 100,
            durationSeconds: seconds,
          },
        ],
        durationSeconds: seconds,
        distanceMeters: 100,
      },
    ],
    warnings: [],
    attribution: ["Google"],
  }));
}
afterEach(() => vi.useRealTimers());
describe("Chiibus official GTFS supplement", () => {
  it("accepts Google's single-point steps and zero-distance empty steps but rejects missing positive-distance geometry", async () => {
    const base = walking(180);
    const walk = async (a: Coordinate, b: Coordinate) => {
      const route = await base(a, b);
      route.legs[0].steps.push(
        {
          instruction: "抵达",
          geometry: [b],
          distanceMeters: 1,
          durationSeconds: 1,
        },
        {
          instruction: "抵达",
          geometry: [],
          distanceMeters: 0,
          durationSeconds: 0,
        },
      );
      return route;
    };
    expect(
      await planChiibusRoutes(request(), parseChiibusFeed(fixture()), walk),
    ).toHaveLength(2);
    const invalid = async (a: Coordinate, b: Coordinate) => {
      const route = await base(a, b);
      route.legs[0].steps[0].geometry = [];
      return route;
    };
    expect(
      await planChiibusRoutes(request(), parseChiibusFeed(fixture()), invalid),
    ).toEqual([]);
  });
  it("uses the early shape occurrence when the exact nearest loop point is the final one", () => {
    const feed = parseChiibusFeed(
      fixture({
        "shapes.txt":
          "shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon\ns,1,35.67001,139.73\ns,2,35.671,139.73\ns,3,35.672,139.73\ns,4,35.67,139.73",
      }),
    );
    expect(feed.trips[0].calls.map((c) => c.shapeIndex)).toEqual([0, 1, 2]);
  });
  it("bounds decompression before inflating an oversized member", () => {
    const zip = zipSync({ "unneeded.txt": new Uint8Array(13 * 1024 * 1024) });
    expect(zip.length).toBeLessThan(1024 * 1024);
    expect(() => parseChiibusFeed(zip)).toThrow();
  });
  it("takes actual leg duration rather than inconsistent summary for departure reachability", async () => {
    const walk = walking(180);
    const inconsistent = async (a: Coordinate, b: Coordinate) => ({
      ...(await walk(a, b)),
      durationSeconds: 0,
    });
    const routes = await planChiibusRoutes(
      request(),
      parseChiibusFeed(fixture()),
      inconsistent,
    );
    expect(
      routes.every(
        (r) =>
          r.legs.find((l) => l.mode === "RIDE")?.startTime ===
          "2026-10-22T00:12:00.000Z",
      ),
    ).toBe(true);
    expect(
      routes.every((r) => r.legs.every((l) => l.durationSeconds >= 0)),
    ).toBe(true);
  });
  it("real walking duration skips missed trip, keeps shape/stops/times/wait and deduplicates callbacks", async () => {
    const walk = walking();
    const result = await planChiibusRoutes(
      request(),
      parseChiibusFeed(fixture()),
      walk,
    );
    expect(result).toHaveLength(2);
    expect(walk).toHaveBeenCalledTimes(2);
    for (const route of result) {
      expect(route.provider).toBe("CHIIBUS_GTFS");
      expect(route.attribution).toEqual(["Test operator", "Google"]);
      const ride = route.legs.find((l) => l.mode === "RIDE")!;
      expect(ride.startTime).toBe("2026-10-22T00:12:00.000Z");
      expect(ride.geometry.length).toBeGreaterThan(2);
      expect(ride.intermediateStops).toHaveLength(1);
      expect(ride.realtime).toBe(false);
      expect(route.legs.map((l) => l.mode)).toEqual([
        "WALK",
        "WAIT",
        "RIDE",
        "WALK",
      ]);
      expect(route.durationSeconds).toBe(19 * 60);
    }
  });
  it("calendar exceptions add Saturday and remove Thursday", async () => {
    const feed = parseChiibusFeed(
      fixture({
        "calendar_dates.txt":
          "service_id,date,exception_type\nd,20261024,1\nd,20261022,2",
      }),
    );
    expect(await planChiibusRoutes(request(), feed, walking())).toEqual([]);
    expect(
      await planChiibusRoutes(
        { ...request(), departureTime: "2026-10-24T09:00:00+09:00" },
        feed,
        walking(),
      ),
    ).toHaveLength(2);
    expect(
      await planChiibusRoutes(
        { ...request(), departureTime: "2026-10-25T09:00:00+09:00" },
        feed,
        walking(),
      ),
    ).toEqual([]);
  });
  it("rejects expired feed and unrelated area with no walking calls", async () => {
    const walk = walking();
    expect(
      await planChiibusRoutes(
        { ...request(), origin: { lat: 34, lng: 135 } },
        parseChiibusFeed(fixture()),
        walk,
      ),
    ).toEqual([]);
    expect(chiibusEligible({ ...request(), basemapProvider: "OPEN_MAP" })).toBe(
      false,
    );
    expect(
      await planChiibusRoutes(
        request(),
        parseChiibusFeed(
          fixture({
            "feed_info.txt": "feed_start_date,feed_end_date\n20260101,20261001",
          }),
        ),
        walk,
      ),
    ).toEqual([]);
    expect(walk).not.toHaveBeenCalled();
  });
  it("does not invent walking geometry after walking provider failure", async () => {
    const walk = vi.fn(async () => {
      throw Error("offline");
    });
    expect(
      await planChiibusRoutes(request(), parseChiibusFeed(fixture()), walk),
    ).toEqual([]);
    expect(walk.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it("rejects malformed ZIP, malformed CSV, absent stop, time inversion", () => {
    expect(() => parseChiibusFeed(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() =>
      parseChiibusFeed(
        fixture({ "agency.txt": 'agency_name,agency_timezone\n"unterminated' }),
      ),
    ).toThrow();
    expect(() =>
      parseChiibusFeed(
        fixture({
          "stop_times.txt":
            "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt,missing,1,09:00:00,09:00:00",
        }),
      ),
    ).toThrow();
    expect(() =>
      parseChiibusFeed(
        fixture({
          "stop_times.txt":
            "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nt,a,1,09:04:00,09:02:00",
        }),
      ),
    ).toThrow();
  });
  it("keeps repeated loop stop occurrences distinct and forbids backwards boarding", async () => {
    const feed = parseChiibusFeed(
      fixture({
        "trips.txt":
          "trip_id,route_id,service_id,shape_id,trip_headsign\nt,00001,d,s,甲方向",
        "stop_times.txt":
          "trip_id,stop_id,stop_sequence,arrival_time,departure_time,pickup_type,drop_off_type\nt,a,1,09:02:00,09:02:00,0,1\nt,b,2,09:04:00,09:04:00,0,0\nt,c,3,09:06:00,09:06:00,0,0\nt,b,4,09:08:00,09:08:00,0,0\nt,a,5,09:10:00,09:10:00,1,0",
      }),
    );
    expect(feed.trips[0].calls.map((c) => c.shapeIndex)).toEqual([
      0, 2, 4, 5, 6,
    ]);
    const routes = await planChiibusRoutes(
      {
        ...request(),
        origin: { lat: 35.672, lng: 139.73 },
        destination: {
          ...request().destination,
          coordinate: { lat: 35.67, lng: 139.73 },
        },
      },
      feed,
      walking(30),
    );
    expect(routes[0].legs.find((l) => l.mode === "RIDE")?.from).toBe("丙");
    expect(routes[0].legs.find((l) => l.mode === "RIDE")?.to).toBe("甲");
  });
  it("supports preceding service day times beyond 24h in JST", async () => {
    const feed = parseChiibusFeed(
      fixture({
        "trips.txt":
          "trip_id,route_id,service_id,shape_id,trip_headsign\nt,00001,d,s,丙方向",
        "stop_times.txt":
          "trip_id,stop_id,stop_sequence,arrival_time,departure_time,pickup_type,drop_off_type\nt,a,1,25:12:00,25:12:00,0,1\nt,c,2,25:16:00,25:16:00,1,0",
      }),
    );
    const routes = await planChiibusRoutes(
      { ...request(), departureTime: "2026-10-23T01:00:00+09:00" },
      feed,
      walking(),
    );
    expect(routes[0].legs.find((l) => l.mode === "RIDE")?.startTime).toBe(
      "2026-10-22T16:12:00.000Z",
    );
  });
  it("deduplicates concurrent downloads, requests no redirects, caches only valid feeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T00:00:00Z"));
    const fetcher = vi.fn(async () => new Response(fixture()));
    const [a, b] = await Promise.all([
      loadChiibusFeed(fetcher),
      loadChiibusFeed(fetcher),
    ]);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://gtfs-jp.buskita.com/fxc/gtfs.zip",
      expect.objectContaining({ redirect: "manual" }),
    );
    await loadChiibusFeed(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(86400001);
    await loadChiibusFeed(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("uses the edge-supported manual mode and refuses redirects without a follow-up request", async () => {
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      if (init?.redirect === "error")
        throw new TypeError("Invalid redirect value");
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://untrusted.invalid/feed.zip" },
      });
    });
    await expect(loadChiibusFeed(fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized response without caching invalid bytes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array(1024 * 1024 + 1)))
      .mockResolvedValueOnce(new Response(fixture()));
    await expect(loadChiibusFeed(fetcher)).rejects.toThrow();
    await expect(loadChiibusFeed(fetcher)).resolves.toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
