import { describe, it, expect, vi } from "vitest";
import {
  decodePolyline,
  googleRoutes,
  transitRoutes,
  policyGuard,
  roadSku,
  enrichDestination,
  enrichmentSku,
  tripSchema,
  upstream,
  type Fetcher,
} from "./index";
import type { ConfirmedTripRequest } from "../../contracts/src/index";
const trip: ConfirmedTripRequest = {
  requestVersion: 1,
  origin: { lat: 0, lng: 0 },
  originPolicy: "CURRENT_DEVICE_LOCATION",
  destination: {
    coordinate: { lat: 0.01, lng: 0.01 },
    evidence: "USER_INPUT",
    source: "USER_INDEPENDENT_INPUT",
    coordinateRole: "ENDPOINT",
    extractedFrom: "manual",
  },
  mode: "WALK",
  departureTime: "2026-10-20T01:00:00Z",
  waypoints: [],
  routeProvider: "GOOGLE_ROUTES",
  basemapProvider: "GOOGLE_TILES",
  userConfirmed: true,
};
const geometry = "??o}@o}@";
const mock = (body: unknown) =>
  vi.fn(async () => Response.json(body)) as unknown as Fetcher;
describe("providers", () => {
  it.each([301, 302, 303, 307, 308])(
    "rejects HTTP %s without following redirects",
    async (status) => {
      const fetcher = vi.fn<Fetcher>(
        async () =>
          new Response(null, {
            status,
            headers: { Location: "https://untrusted.example/" },
          }),
      );
      await expect(
        upstream("https://provider.example/", {}, fetcher),
      ).rejects.toMatchObject({
        diagnostic: { stage: "HTTP", httpStatus: status },
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    },
  );
  it("decodes geometry with arbitrary provider precision", () => {
    expect(decodePolyline(geometry)).toEqual([
      { lat: 0, lng: 0 },
      { lat: 0.01, lng: 0.01 },
    ]);
    expect(decodePolyline(geometry, 6)[1].lat).toBe(0.001);
  });
  it.each(["~", "!", "~~~~~~~", "??~"])("rejects malformed polyline %s", (p) =>
    expect(() => decodePolyline(p)).toThrow(),
  );
  it.each(["GOOGLE_MAPS_SHARED_LINK", "GOOGLE_API_CONTENT"] as const)(
    "preserves Google source restriction %s",
    (source) =>
      expect(() =>
        policyGuard({
          ...trip,
          mode: "TRANSIT",
          routeProvider: "TRANSITOUS",
          basemapProvider: "OPEN_MAP",
          destination: { ...trip.destination, source },
        }),
      ).toThrow(),
  );
  it("does not allow Google road overlay on OSM", () =>
    expect(() =>
      policyGuard({ ...trip, basemapProvider: "OPEN_MAP" }),
    ).toThrow());
  it("allows independent Transitous input on open map", () =>
    expect(() =>
      policyGuard({
        ...trip,
        mode: "TRANSIT",
        routeProvider: "TRANSITOUS",
        basemapProvider: "OPEN_MAP",
      }),
    ).not.toThrow());
  it("keeps shared origin conservative", () =>
    expect(() =>
      policyGuard({
        ...trip,
        mode: "TRANSIT",
        routeProvider: "TRANSITOUS",
        basemapProvider: "OPEN_MAP",
        originPolicy: "EXPLICIT_SHARED_ORIGIN",
      }),
    ).toThrow());
  it("never treats viewport as destination", () =>
    expect(() =>
      policyGuard({
        ...trip,
        destination: { ...trip.destination, coordinateRole: "VIEWPORT_ONLY" },
      }),
    ).toThrow());
  it("rejects unknown fields and unconfirmed trip", () => {
    expect(tripSchema.safeParse({ ...trip, key: "secret" }).success).toBe(
      false,
    );
    expect(
      tripSchema.safeParse({ ...trip, userConfirmed: false }).success,
    ).toBe(false);
  });
  it("classifies traffic and >10 intermediate waypoints as Pro", () => {
    expect(roadSku(trip)).toBe("ROUTES_ESSENTIALS");
    expect(roadSku({ ...trip, trafficAware: true })).toBe("ROUTES_PRO");
    expect(
      roadSku({ ...trip, waypoints: Array(11).fill(trip.destination) }),
    ).toBe("ROUTES_PRO");
  });
  it.each(["WALK", "DRIVE"] as const)(
    "requests actual %s steps",
    async (mode) => {
      const f = mock({
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
                    polyline: { encodedPolyline: geometry },
                    navigationInstruction: {
                      instructions: "右折",
                      maneuver: "TURN_RIGHT",
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
      const r = await googleRoutes({ ...trip, mode }, "test-only", f);
      expect(r[0].legs[0].steps[0].instruction).toBe("右折");
      const args = vi.mocked(f).mock.calls[0];
      const body = JSON.parse(args[1]!.body as string);
      expect(body.travelMode).toBe(mode);
      expect(body.routingPreference).toBe(
        mode === "DRIVE" ? "TRAFFIC_UNAWARE" : undefined,
      );
    },
  );
  it("distinguishes safe HTTP and transport diagnostics without provider body", async () => {
    const denied = vi.fn(
      async () => new Response("private URL and location", { status: 400 }),
    ) as unknown as Fetcher;
    await expect(googleRoutes(trip, "test", denied)).rejects.toMatchObject({
      diagnostic: { stage: "HTTP", httpStatus: 400 },
    });
    const offline = vi.fn(async () => {
      throw new Error("private hostname");
    }) as unknown as Fetcher;
    await expect(googleRoutes(trip, "test", offline)).rejects.toMatchObject({
      diagnostic: { stage: "TRANSPORT" },
    });
  });
  it("exposes bounded schema paths only", async () => {
    try {
      await transitRoutes(
        { ...trip, mode: "TRANSIT", routeProvider: "TRANSITOUS" },
        "test",
        mock({ itineraries: [{ duration: "private", legs: [] }] }),
      );
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toMatchObject({
        diagnostic: {
          stage: "SCHEMA",
          issuePaths: ["itineraries.[].duration", "itineraries.[].legs"],
        },
      });
      expect(JSON.stringify(e)).not.toContain("private");
    }
  });
  it("returns no route distinctly", async () =>
    expect(
      googleRoutes(trip, "test", mock({ routes: [] })),
    ).rejects.toMatchObject({ code: "NO_ROUTE" }));
  it("rejects malformed upstream and hides errors", async () => {
    await expect(
      googleRoutes(trip, "test", mock({ routes: [{}] })),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const f = vi.fn(
      async () => new Response("private data", { status: 403 }),
    ) as unknown as Fetcher;
    await expect(googleRoutes(trip, "test", f)).rejects.not.toThrow(
      "private data",
    );
  });
  it("does not enrich known endpoints", async () => {
    const f = mock({});
    expect(await enrichDestination(trip.destination, "", f)).toEqual([
      trip.destination,
    ]);
    expect(f).not.toHaveBeenCalled();
  });
  it("routes names to bounded Text Search Pro and addresses to geocoding", async () => {
    expect(enrichmentSku({ ...trip.destination, label: "Synthetic" })).toBe(
      "TEXT_SEARCH",
    );
    expect(enrichmentSku({ ...trip.destination, address: "Synthetic" })).toBe(
      "GEOCODING",
    );
    const f = mock({
      places: [
        {
          id: "synthetic",
          displayName: { text: "Synthetic" },
          location: { latitude: 0, longitude: 0 },
        },
      ],
    });
    const result = await enrichDestination(
      { ...trip.destination, coordinate: undefined, label: "Synthetic" },
      "test",
      f,
    );
    expect(result[0].source).toBe("GOOGLE_API_CONTENT");
    expect(String(vi.mocked(f).mock.calls[0][0])).toContain(
      "places:searchText",
    );
    expect(
      JSON.parse(vi.mocked(f).mock.calls[0][1]!.body as string).pageSize,
    ).toBe(5);
  });
  it("marks all geocoding candidates Google content", async () => {
    const f = mock({
      status: "OK",
      results: [
        {
          formatted_address: "Synthetic",
          place_id: "synthetic",
          geometry: { location: { lat: 0, lng: 0 } },
        },
      ],
    });
    const result = await enrichDestination(
      { ...trip.destination, coordinate: undefined, address: "Synthetic" },
      "test",
      f,
    );
    expect(result[0].source).toBe("GOOGLE_API_CONTENT");
  });
  const leg = (mode: string, start: number, end: number) => ({
    mode,
    startTime: `2026-10-20T01:${String(start).padStart(2, "0")}:00Z`,
    endTime: `2026-10-20T01:${String(end).padStart(2, "0")}:00Z`,
    duration: (end - start) * 60,
    from: { name: "Synthetic A" },
    to: { name: "Synthetic B" },
    legGeometry: { points: geometry, precision: 5 },
    realTime: false,
    steps:
      mode === "WALK"
        ? [
            {
              relativeDirection: "CONTINUE",
              streetName: "Synthetic",
              distance: 100,
              polyline: { points: geometry, precision: 5 },
            },
          ]
        : undefined,
  });
  it.each([1, 2, 3])("retains %i rides, waiting and walking", async (n) => {
    const legs = [leg("WALK", 0, 1)];
    for (let i = 0; i < n; i++) {
      legs.push(leg("SUBWAY", 2 + i * 4, 4 + i * 4));
      legs.push(leg("WALK", 4 + i * 4, 5 + i * 4));
    }
    const f = mock({ itineraries: [{ duration: 1000, legs }] });
    const r = await transitRoutes(
      { ...trip, mode: "TRANSIT", routeProvider: "TRANSITOUS" },
      "EvenNav/0.1.0 (test.invalid)",
      f,
    );
    expect(r[0].legs.filter((l) => l.mode === "RIDE")).toHaveLength(n);
    expect(r[0].legs.some((l) => l.mode === "WAIT")).toBe(true);
    expect(r[0].legs.at(-1)?.mode).toBe("WALK");
    expect(new URL(String(vi.mocked(f).mock.calls[0][0])).pathname).toBe(
      "/api/v6/plan",
    );
  });
  it.each([
    ["Synthetic Line", "SL", "123456", "Synthetic Line"],
    ["", "SL", "123456", "SL"],
    [" ", "", "Express", "Express"],
  ])("keeps line identity separate from trip display name", async (long, short, display, expected) => {
    const routes = await transitRoutes(
      { ...trip, mode: "TRANSIT", routeProvider: "TRANSITOUS" },
      "test",
      mock({ itineraries: [{ duration: 240, legs: [
        leg("WALK", 0, 1),
        { ...leg("SUBWAY", 1, 3), routeLongName: long, routeShortName: short,
          displayName: display, agencyName: "Synthetic Operator" },
        leg("WALK", 3, 4),
      ] }] }),
    );
    expect(routes[0].legs.find((l) => l.mode === "RIDE")).toMatchObject({
      line: expected, agency: "Synthetic Operator",
    });
  });
  it("rejects inconsistent leg durations and overlapping rides", async () => {
    for (const legs of [
      [leg("WALK", 0, 1), { ...leg("SUBWAY", 2, 4), duration: 1 }],
      [leg("WALK", 0, 3), leg("SUBWAY", 2, 4)],
    ])
      await expect(
        transitRoutes(
          { ...trip, mode: "TRANSIT", routeProvider: "TRANSITOUS" },
          "test",
          mock({ itineraries: [{ duration: 240, legs }] }),
        ),
      ).rejects.toMatchObject({ code: "NO_ROUTE" });
  });
  it("rejects all-walk itinerary in transit", async () =>
    expect(
      transitRoutes(
        { ...trip, mode: "TRANSIT", routeProvider: "TRANSITOUS" },
        "test",
        mock({ itineraries: [{ duration: 60, legs: [leg("WALK", 0, 1)] }] }),
      ),
    ).rejects.toMatchObject({ code: "NO_ROUTE" }));
  it("rejects unwalkable access and cancelled or extended-calendar services", async () => {
    for (const mutation of [
      { steps: [] },
      { cancelled: true },
      { loopedCalendarSince: "2025-01-01T00:00:00Z" },
    ]) {
      const legs = [{ ...leg("WALK", 0, 1), ...mutation }, leg("SUBWAY", 2, 4)];
      await expect(
        transitRoutes(
          { ...trip, mode: "TRANSIT", routeProvider: "TRANSITOUS" },
          "test",
          mock({ itineraries: [{ duration: 240, legs }] }),
        ),
      ).rejects.toMatchObject({ code: "NO_ROUTE" });
    }
  });
});
