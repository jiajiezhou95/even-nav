import { readFileSync, writeFileSync } from "node:fs";
import type { ConfirmedTripRequest } from "../packages/contracts/src/index";
console.log(
  "Plan: 1 Transitous public Tokyo Station–Ueno route request through deployed personal Worker; 0 Google units. Distinguishes local-host network failure from Cloudflare egress.",
);
if (!process.argv.includes("--execute")) process.exit(0);
const config = JSON.parse(readFileSync(".local/config.json", "utf8"));
const request: ConfirmedTripRequest = {
  requestVersion: 1,
  origin: { lat: 35.681236, lng: 139.767125 },
  originPolicy: "MANUAL",
  destination: {
    coordinate: { lat: 35.713768, lng: 139.777254 },
    evidence: "USER_INPUT",
    source: "USER_INDEPENDENT_INPUT",
    extractedFrom: "public-probe",
    coordinateRole: "ENDPOINT",
  },
  mode: "TRANSIT",
  departureTime: new Date().toISOString(),
  waypoints: [],
  routeProvider: "TRANSITOUS",
  basemapProvider: "OPEN_MAP",
  userConfirmed: true,
};
let receipt: Record<string, unknown>;
try {
  const response = await fetch(`${config.workerOrigin}/v1/routes/transit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(18000),
  });
  const value = (await response.json()) as {
    routes?: { legs: { mode: string }[] }[];
    error?: { code: string; diagnostic?: unknown };
  };
  receipt = {
    evidence: "LIVE_PROVIDER_DEPLOYED_WORKER",
    at: new Date().toISOString(),
    status: response.ok ? "PASS" : "FAIL",
    http: response.status,
    error: value.error?.code,
    diagnostic: value.error?.diagnostic,
    routeCount: value.routes?.length,
    legModes: value.routes?.map((r) => r.legs.map((l) => l.mode)),
    calls: 1,
  };
} catch {
  receipt = {
    evidence: "LIVE_PROVIDER_DEPLOYED_WORKER",
    at: new Date().toISOString(),
    status: "FAIL",
    error: "NETWORK_OR_TIMEOUT",
    calls: 1,
  };
}
writeFileSync(
  "docs/TRANSIT_LIVE_RESULT.json",
  JSON.stringify(receipt, null, 2),
);
console.log(JSON.stringify(receipt));
