import { readFileSync } from "node:fs";
import type { Route } from "../packages/contracts/src/index";

console.log(
  "Plan: check deployed NAVITIME capability; if configured, 1 public Omotesando–Shibuya Transitous route query with at most 15 NAVITIME Transport requests; 0 Google requests; no retries.",
);
if (!process.argv.includes("--execute")) process.exit(0);
const config = JSON.parse(readFileSync(".local/config.json", "utf8"));
const origin = new URL(config.workerOrigin);
if (origin.protocol !== "https:" || origin.origin !== config.workerOrigin)
  throw new Error("Expected exact HTTPS Worker origin");
const headers = {
  Authorization: `Bearer ${config.accessToken}`,
  "Content-Type": "application/json",
};
try {
  const capability = await fetch(`${origin.origin}/v1/providers`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!capability.ok) throw new Error("CAPABILITY_FAILED");
  const providers = (await capability.json()) as {
    navitime?: { configured?: boolean };
  };
  if (!providers.navitime?.configured) {
    console.log(
      JSON.stringify({
        status: "BLOCKED",
        reason: "NAVITIME_KEY_NOT_CONFIGURED",
        navitimeCalls: 0,
      }),
    );
    process.exitCode = 2;
  } else {
    const response = await fetch(`${origin.origin}/v1/routes/transit`, {
      method: "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        requestVersion: 1,
        origin: { lat: 35.6653, lng: 139.7126 },
        originPolicy: "CURRENT_DEVICE_LOCATION",
        destination: {
          coordinate: { lat: 35.658, lng: 139.7016 },
          evidence: "USER_INPUT",
          source: "USER_INDEPENDENT_INPUT",
          extractedFrom: "public-navitime-probe",
          coordinateRole: "ENDPOINT",
        },
        mode: "TRANSIT",
        departureTime: new Date().toISOString(),
        waypoints: [],
        routeProvider: "TRANSITOUS",
        basemapProvider: "OPEN_MAP",
        userConfirmed: true,
      }),
    });
    if (!response.ok) throw new Error("ROUTE_QUERY_FAILED");
    const data = (await response.json()) as { routes?: Route[] };
    const statuses =
      data.routes?.map((route) => ({
        exits: route.navitime?.exits,
        platforms: route.navitime?.platforms,
        stopsWithExits: route.legs
          .flatMap((leg) => [leg.fromStop, leg.toStop])
          .filter((stop) => stop?.stationAccess?.gateways.length).length,
        stopsWithSelectedExit: route.legs
          .flatMap((leg) => [leg.fromStop, leg.toStop])
          .filter((stop) => stop?.stationAccess?.selectedGateway).length,
      })) ?? [];
    const found = statuses.some((status) => status.stopsWithExits > 0);
    console.log(
      JSON.stringify({
        evidence: "LIVE_DEPLOYED_WORKER",
        status: found ? "PASS" : "PARTIAL",
        statuses,
        hardware: "NOT_RUN",
      }),
    );
    if (!found) process.exitCode = 2;
  }
} catch {
  console.log(
    JSON.stringify({
      status: "FAIL",
      reason: "AUTH_NETWORK_OR_PROVIDER_FAILURE",
      retry: false,
    }),
  );
  process.exitCode = 1;
}
