import { expect, it, vi } from "vitest";
import { createWorker, type Env } from "./index";
import type { ConfirmedTripRequest } from "../../../packages/contracts/src/index";
import { NAVITIME_HOST } from "../../../packages/providers/src/navitime";

// Same synthetic polyline and MOTIS leg shape used by provider tests.
const geometry = "??o}@o}@";
const fixture = {
  itineraries: [
    {
      duration: 120,
      legs: [
        {
          mode: "SUBWAY",
          startTime: "2026-10-20T01:00:00Z",
          endTime: "2026-10-20T01:02:00Z",
          duration: 120,
          distance: 1000,
          routeLongName: "Synthetic line",
          agencyName: "Synthetic agency",
          from: { name: "Synthetic A", lat: 0, lon: 0, track: "4" },
          to: { name: "Synthetic B", lat: 0.01, lon: 0.01 },
          legGeometry: { points: geometry, precision: 5 },
          realTime: false,
        },
      ],
    },
  ],
};
const trip: ConfirmedTripRequest = {
  requestVersion: 7,
  origin: { lat: 0, lng: 0 },
  originPolicy: "CURRENT_DEVICE_LOCATION",
  destination: {
    coordinate: { lat: 0.01, lng: 0.01 },
    evidence: "USER_INPUT",
    source: "USER_INDEPENDENT_INPUT",
    coordinateRole: "ENDPOINT",
    extractedFrom: "synthetic",
  },
  mode: "TRANSIT",
  departureTime: "2026-10-20T01:00:00Z",
  waypoints: [],
  routeProvider: "TRANSITOUS",
  basemapProvider: "OPEN_MAP",
  userConfirmed: true,
};
it("wires authenticated transit enrichment only with a server key and preserves routes when NAVITIME denies", async () => {
  const token = "synthetic-worker-test-token";
  const reserved: string[] = [];
  const env: Env = {
    ACCESS_TOKEN: token,
    TRANSITOUS_ENABLED: "true",
    TRANSITOUS_CONTACT: "synthetic.invalid",
    QUOTA: {
      idFromName: () => 1,
      get: () => ({
        fetch: async (_input, init) => {
          reserved.push(
            (JSON.parse(String(init?.body)) as { sku: string }).sku,
          );
          return Response.json({ reserved: true });
        },
      }),
    },
  };
  const fetcher = vi.fn(
    async (raw: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(raw));
      if (url.hostname === "api.transitous.org") return Response.json(fixture);
      expect(url.hostname).toBe(NAVITIME_HOST);
      expect(url.pathname).toBe("/transport_link");
      expect(new Headers(init?.headers).get("X-RapidAPI-Key")).toBe(
        "synthetic-navitime-key",
      );
      return new Response(null, { status: 403 });
    },
  );
  const request = () =>
    new Request("https://worker.test/v1/routes/transit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(trip),
    });
  const worker = createWorker(fetcher);
  const baseline = await worker.fetch(request(), env);
  expect(baseline.status).toBe(200);
  const withoutKey = await baseline.json();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(reserved).toEqual(["TRANSIT"]);
  expect(withoutKey.routes[0].navitime.exits).toBe("NOT_CONFIGURED");
  const enriched = await worker.fetch(request(), {
    ...env,
    NAVITIME_RAPIDAPI_KEY: "synthetic-navitime-key",
  });
  expect(enriched.status).toBe(200);
  const denied = await enriched.json();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(reserved).toEqual(["TRANSIT", "TRANSIT", "NAVITIME_TRANSPORT"]);
  expect(denied.requestVersion).toBe(7);
  expect(denied.routes[0].navitime.exits).toBe("UNAVAILABLE");
  expect(denied.routes[0].legs).toEqual(withoutKey.routes[0].legs);
  expect(denied.routes[0].distanceMeters).toBe(
    withoutKey.routes[0].distanceMeters,
  );
  expect(denied.routes[0].durationSeconds).toBe(
    withoutKey.routes[0].durationSeconds,
  );
  expect(JSON.stringify(denied)).not.toContain("synthetic-navitime-key");
});
