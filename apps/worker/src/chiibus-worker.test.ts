import { beforeEach, expect, it, vi } from "vitest";
import {
  NavError,
  type ConfirmedTripRequest,
  type Route,
} from "../../../packages/contracts/src/index";
import {
  loadChiibusFeed,
  planChiibusRoutes,
} from "../../../packages/providers/src/chiibus";
import { mergeChiibusRoutes, supplementChiibus } from "./chiibus-worker";
import { createWorker, type Env } from "./index";

vi.mock("../../../packages/providers/src/chiibus", () => ({
  chiibusEligible: (t: ConfirmedTripRequest) =>
    t.origin.lat > 35 && t.origin.lat < 36,
  loadChiibusFeed: vi.fn(),
  planChiibusRoutes: vi.fn(),
}));
const trip: ConfirmedTripRequest = {
  requestVersion: 1,
  origin: { lat: 35.67, lng: 139.74 },
  originPolicy: "CURRENT_DEVICE_LOCATION",
  destination: {
    coordinate: { lat: 35.66, lng: 139.72 },
    coordinateRole: "ENDPOINT",
    evidence: "USER_INPUT",
    source: "USER_INDEPENDENT_INPUT",
    extractedFrom: "synthetic",
  },
  mode: "TRANSIT",
  departureTime: "2026-10-22T03:00:00Z",
  waypoints: [],
  routeProvider: "TRANSITOUS",
  basemapProvider: "GOOGLE_TILES",
  userConfirmed: true,
};
function route(line: string, seconds = 600): Route {
  return {
    id: line,
    provider: "TRANSITOUS",
    basemapProvider: "GOOGLE_TILES",
    fetchedAt: "2026-10-22T03:00:00Z",
    expiresAt: "2026-10-22T03:05:00Z",
    durationSeconds: seconds,
    distanceMeters: 1000,
    warnings: [],
    attribution: ["synthetic"],
    legs: [
      {
        mode: "RIDE",
        geometry: [],
        steps: [],
        line,
        durationSeconds: seconds,
        distanceMeters: 1000,
      },
    ],
  };
}
const baseline = [route("rail")];
let reserved: string[];
let env: Env;
const googleBody = {
  routes: [
    {
      distanceMeters: 100,
      duration: "60s",
      legs: [
        {
          distanceMeters: 100,
          duration: "60s",
          steps: [
            {
              distanceMeters: 100,
              staticDuration: "60s",
              polyline: { encodedPolyline: "??o}@o}@" },
            },
          ],
        },
      ],
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  reserved = [];
  env = {
    ACCESS_TOKEN: "synthetic-worker-test-token",
    GOOGLE_API_KEY: "synthetic-key",
    TRANSITOUS_ENABLED: "true",
    TRANSITOUS_CONTACT: "synthetic.invalid",
    QUOTA: {
      idFromName: () => 1,
      get: () => ({
        fetch: async (_input, init) => {
          reserved.push(JSON.parse(String(init?.body)).sku);
          return Response.json({ reserved: true });
        },
      }),
    },
  };
  vi.mocked(loadChiibusFeed).mockResolvedValue(
    {} as Awaited<ReturnType<typeof loadChiibusFeed>>,
  );
});
it("keeps two distinct community lines and best baseline, ordered by duration", () => {
  const buses = [route("A", 500), route("A", 510), route("B", 700)];
  expect(
    mergeChiibusRoutes([route("rail", 600), route("rail2", 800)], buses).map(
      (r) => r.id,
    ),
  ).toEqual(["A", "rail", "B"]);
  expect(mergeChiibusRoutes(baseline, [])).toBe(baseline);
});
it("does not supplement outside coverage, without key, with other tiles, or after deadline", async () => {
  const fetcher = vi.fn();
  await supplementChiibus(
    { ...trip, origin: { lat: 0, lng: 0 } },
    baseline,
    env,
    fetcher,
    Date.now() + 8000,
  );
  await supplementChiibus(trip, baseline, {}, fetcher, Date.now() + 8000);
  await supplementChiibus(
    { ...trip, basemapProvider: "OPEN_MAP" },
    baseline,
    env,
    fetcher,
    Date.now() + 8000,
  );
  await supplementChiibus(trip, baseline, env, fetcher, Date.now());
  expect(loadChiibusFeed).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(reserved).toEqual([]);
});
it("uses only Google WALK with exact connection endpoints, reserves each call and caps at four", async () => {
  const a = { lat: 35.671, lng: 139.741 },
    b = { lat: 35.661, lng: 139.721 };
  const bus = { ...route("A"), provider: "CHIIBUS_GTFS" as Route["provider"] };
  vi.mocked(planChiibusRoutes).mockImplementation(async (_t, _f, walk) => {
    for (let i = 0; i < 4; i++) await walk(a, b);
    await expect(walk(a, b)).rejects.toThrow("上限");
    return [bus];
  });
  const fetcher = vi.fn(async (_url, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.travelMode).toBe("WALK");
    expect(body.origin.location.latLng).toEqual({
      latitude: a.lat,
      longitude: a.lng,
    });
    expect(body.destination.location.latLng).toEqual({
      latitude: b.lat,
      longitude: b.lng,
    });
    expect(body.intermediates).toEqual([]);
    return Response.json(googleBody);
  });
  const result = await supplementChiibus(
    trip,
    baseline,
    env,
    fetcher,
    Date.now() + 8000,
  );
  expect(result.some((r) => r.provider === "CHIIBUS_GTFS")).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(reserved).toEqual(Array(4).fill("ROUTES_ESSENTIALS"));
});
it("preserves baseline on feed or walking failure", async () => {
  vi.mocked(loadChiibusFeed).mockRejectedValueOnce(
    new Error("feed unavailable"),
  );
  expect(
    await supplementChiibus(trip, baseline, env, vi.fn(), Date.now() + 8000),
  ).toBe(baseline);
  vi.mocked(planChiibusRoutes).mockImplementation(async (_t, _f, walk) => {
    await walk(trip.origin, trip.destination.coordinate!);
    return [];
  });
  expect(
    await supplementChiibus(
      trip,
      baseline,
      env,
      vi.fn(async () => new Response(null, { status: 500 })),
      Date.now() + 8000,
    ),
  ).toBe(baseline);
});
it("quota failure prevents subsequent paid calls even if planner catches it", async () => {
  env.QUOTA = {
    idFromName: () => 1,
    get: () => ({ fetch: async () => new Response(null, { status: 429 }) }),
  };
  const fetcher = vi.fn();
  vi.mocked(planChiibusRoutes).mockImplementation(async (_t, _f, walk) => {
    for (let i = 0; i < 2; i++)
      await expect(
        walk(trip.origin, trip.destination.coordinate!),
      ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    return [];
  });
  expect(
    await supplementChiibus(trip, baseline, env, fetcher, Date.now() + 8000),
  ).toBe(baseline);
  await expect(
    supplementChiibus(trip, [], env, fetcher, Date.now() + 8000),
  ).rejects.toBeInstanceOf(NavError);
  expect(fetcher).not.toHaveBeenCalled();
});
it("deadline cancels supplementation and late work cannot begin a paid request", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value: Awaited<ReturnType<typeof loadChiibusFeed>>) => void;
    vi.mocked(loadChiibusFeed).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = supplementChiibus(
      trip,
      baseline,
      env,
      vi.fn(),
      Date.now() + 500,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBe(baseline);
    finish({} as Awaited<ReturnType<typeof loadChiibusFeed>>);
    await Promise.resolve();
    expect(planChiibusRoutes).not.toHaveBeenCalled();
    expect(reserved).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
function request() {
  return new Request("https://worker.test/v1/routes/transit", {
    method: "POST",
    headers: {
      Authorization: "Bearer synthetic-worker-test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(trip),
  });
}
it("worker accepts supplement after Transitous NO_ROUTE without a second Transitous query", async () => {
  const bus = { ...route("A"), provider: "CHIIBUS_GTFS" as Route["provider"] };
  vi.mocked(planChiibusRoutes).mockResolvedValue([bus]);
  const fetcher = vi.fn(async () => Response.json({ itineraries: [] }));
  const response = await createWorker(fetcher).fetch(request(), env);
  expect(response.status).toBe(200);
  expect((await response.json()).routes[0].provider).toBe("CHIIBUS_GTFS");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(reserved).toEqual(["TRANSIT"]);
});
it("worker does not supplement a Transitous quota failure", async () => {
  const response = await createWorker(
    vi.fn(async () => new Response(null, { status: 429 })),
  ).fetch(request(), env);
  expect(response.status).toBe(429);
  expect(loadChiibusFeed).not.toHaveBeenCalled();
});
