import { readFileSync, writeFileSync } from "node:fs";
import type {
  ConfirmedTripRequest,
  Route,
} from "../packages/contracts/src/index";

// Public station-area coordinates are explicit test inputs, not user locations.
const cases: [string, [number, number], [number, number]][] = [
  ["Asakusa–Shibuya", [35.7107, 139.7974], [35.658, 139.7016]],
  ["Tochomae–Daimon", [35.6906, 139.6926], [35.6568, 139.7547]],
  ["Tokyo–Mitaka", [35.6812, 139.7671], [35.7027, 139.5608]],
  ["Shinjuku–Chofu", [35.6909, 139.7003], [35.6518, 139.5446]],
  ["Ikebukuro–Nerima", [35.7295, 139.7109], [35.7377, 139.6549]],
  ["Ueno–Oshiage", [35.7138, 139.7773], [35.7103, 139.8133]],
  ["Meguro–Sengakuji", [35.6339, 139.7158], [35.6387, 139.74]],
  ["Shimokitazawa–Oshiage", [35.6615, 139.6663], [35.7103, 139.8133]],
  ["Jiyugaoka–ShinKiba", [35.6073, 139.6685], [35.6461, 139.8269]],
  ["Toshimaen–HanedaTerminal3", [35.742, 139.6494], [35.5445, 139.7683]],
];
const tomorrow = new Date(Date.now() + 9 * 3600_000 + 86400_000)
  .toISOString()
  .slice(0, 10);
const departureTime = `${tomorrow}T09:00:00+09:00`;
const selected = process.argv
  .find((arg) => arg.startsWith("--case="))
  ?.slice(7);
const activeCases = selected
  ? cases.filter(([name]) => name === selected)
  : process.argv.includes("--transit-metadata")
    ? ["Shinjuku–Chofu", "Tochomae–Daimon"].map((name) =>
        cases.find(([candidate]) => candidate === name)!,
      )
    : process.argv.includes("--transit-beta")
      ? ["Shinjuku–Chofu", "Tochomae–Daimon", "Shimokitazawa–Oshiage"].map(
          (name) => cases.find(([candidate]) => candidate === name)!,
        )
      : cases;
if (!activeCases.length) throw new Error("Unknown public test case");
console.log(
  JSON.stringify({
    plan: `${activeCases.length} sequential public Tokyo OD requests; no retry; no Google calls`,
    departureTime,
    execute: process.argv.includes("--execute"),
  }),
);
if (!process.argv.includes("--execute")) process.exit(0);
const config = JSON.parse(readFileSync(".local/config.json", "utf8"));
const results: unknown[] = [];
for (const [name, origin, destination] of activeCases) {
  const request: ConfirmedTripRequest = {
    requestVersion: 1,
    origin: { lat: origin[0], lng: origin[1] },
    originPolicy: "MANUAL",
    destination: {
      coordinate: { lat: destination[0], lng: destination[1] },
      evidence: "USER_INPUT",
      source: "USER_INDEPENDENT_INPUT",
      extractedFrom: "public-coverage-probe",
      coordinateRole: "ENDPOINT",
    },
    mode: "TRANSIT",
    departureTime,
    waypoints: [],
    routeProvider: "TRANSITOUS",
    basemapProvider: "OPEN_MAP",
    userConfirmed: true,
  };
  let result: Record<string, unknown>;
  let stop = false;
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
    const body = (await response.json()) as {
      routes?: Route[];
      error?: { code: string; diagnostic?: unknown };
    };
    result = {
      name,
      at: new Date().toISOString(),
      http: response.status,
      status: response.ok && body.routes?.length ? "ROUTES_RETURNED" : "FAIL",
      error: body.error?.code,
      diagnostic: body.error?.diagnostic,
      routes: body.routes?.map((route) => {
        const rides = route.legs.filter((leg) => leg.mode === "RIDE");
        let previous = Date.parse(departureTime);
        const chronology = route.legs.every((leg) => {
          const start = Date.parse(leg.startTime ?? "");
          const end = Date.parse(leg.endTime ?? "");
          const valid = start >= previous && end >= start;
          previous = end;
          return valid;
        });
        return {
          modes: route.legs.map((leg) => leg.mode),
          lines: rides.map((leg) => leg.line ?? "UNAVAILABLE"),
          agencies: rides.map((leg) => leg.agency ?? "UNAVAILABLE"),
          stopMetadata: rides.map((leg) => ({
            boardingCoordinate: Boolean(leg.fromStop?.coordinate),
            alightingCoordinate: Boolean(leg.toStop?.coordinate),
            boardingPlatform: Boolean(leg.fromStop?.platform),
            alightingPlatform: Boolean(leg.toStop?.platform),
            intermediateStops: leg.intermediateStops?.length ?? 0,
            namedIntermediateStops:
              leg.intermediateStops?.filter((stop) => Boolean(stop.name))
                .length ?? 0,
            timedIntermediateStops:
              leg.intermediateStops?.filter((stop) =>
                Boolean(stop.arrivalTime || stop.departureTime),
              ).length ?? 0,
          })),
          transfers: Math.max(
            0,
            rides.filter((leg) => !leg.staySeated).length - 1,
          ),
          chronology,
          positiveWalksHaveStepsAndGeometry: route.legs
            .filter(
              (leg) =>
                ["WALK", "TRANSFER"].includes(leg.mode) &&
                leg.durationSeconds > 0,
            )
            .every(
              (leg) =>
                leg.steps.length > 0 &&
                leg.geometry.length >= 2 &&
                leg.steps.every(
                  (step) =>
                    step.distanceMeters <= 0 || step.geometry.length >= 2,
                ),
            ),
          elapsedDurationMatches:
            Math.abs(
              route.durationSeconds -
                (Date.parse(route.legs.at(-1)?.endTime ?? "") -
                  Date.parse(departureTime)) /
                  1000,
            ) <= 1,
          waitsOnlyBeforeTrain: route.legs.every(
            (leg, index) =>
              leg.mode !== "WAIT" || route.legs[index + 1]?.mode === "RIDE",
          ),
          durationSeconds: route.durationSeconds,
        };
      }),
    };
    stop =
      [401, 403, 429].includes(response.status) ||
      body.error?.code === "PROVIDER_UNAVAILABLE";
  } catch {
    result = {
      name,
      at: new Date().toISOString(),
      status: "NETWORK_OR_TIMEOUT",
    };
    stop = true;
  }
  results.push(result);
  writeFileSync(
    process.argv.includes("--transit-metadata")
      ? "docs/TRANSIT_BETA_0_1_21_RESULT.json"
      : process.argv.includes("--transit-beta")
        ? "docs/TRANSIT_BETA_0_1_20_RESULT.json"
        : selected
          ? "docs/TRANSIT_IDENTITY_RESULT.json"
          : "docs/TRANSIT_COVERAGE_RESULT.json",
    JSON.stringify(
      {
        evidence: "LIVE_PROVIDER_DEPLOYED_WORKER",
        departureTime,
        calls: results.length,
        plannedCalls: activeCases.length,
        stoppedEarly: stop,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(result));
  if (stop) break;
}
