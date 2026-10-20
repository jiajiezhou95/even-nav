import { readFileSync, writeFileSync } from "node:fs";
const mapsOnly = process.argv.includes("--maps-only");
const fromEnrichment = process.argv.includes("--from-enrichment");
console.log(
  `Plan: ${mapsOnly ? "tile session/tile/viewport (3)" : fromEnrichment ? "geocoding + tile session/tile/viewport (4)" : "WALK + DRIVE + geocoding + tile session/tile/viewport (6)"}; no retry; public Tokyo inputs only.`,
);
if (!process.argv.includes("--execute")) process.exit(0);
const config = JSON.parse(readFileSync(".local/config.json", "utf8"));
const results: unknown[] = [];
async function call(name: string, path: string, body?: unknown) {
  const r = await fetch(config.workerOrigin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(18000),
  });
  const image = r.headers.get("content-type")?.startsWith("image/");
  const value = image
    ? { bytes: (await r.arrayBuffer()).byteLength }
    : await r.json();
  results.push({
    name,
    http: r.status,
    status: r.ok ? "PASS" : "FAIL",
    error: value.error?.code,
    diagnostic: value.error?.diagnostic,
    routeCount: value.routes?.length,
    geometryPoints: value.routes?.map((route: any) =>
      route.legs.reduce((n: number, leg: any) => n + leg.geometry.length, 0),
    ),
    candidateCount: value.candidates?.length,
    imageBytes: value.bytes,
    copyrightPresent: value.copyright ? true : undefined,
  });
  writeFileSync(
    mapsOnly
      ? "docs/GOOGLE_MAP_LIVE_RESULT.json"
      : "docs/GOOGLE_LIVE_RESULT.json",
    JSON.stringify(
      {
        evidence: "LIVE_PROVIDER_DEPLOYED_WORKER",
        at: new Date().toISOString(),
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(results.at(-1)));
  if (!r.ok)
    throw new Error("Google probe stopped at failed boundary; no retry");
  return value;
}
if (!mapsOnly) {
  if (!fromEnrichment) {
    for (const mode of ["WALK", "DRIVE"])
      await call(mode, "/v1/routes/road", {
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
        mode,
        departureTime: new Date().toISOString(),
        waypoints: [],
        routeProvider: "GOOGLE_ROUTES",
        basemapProvider: "GOOGLE_TILES",
        userConfirmed: true,
      });
  }
  await call("GEOCODING", "/v1/destinations/resolve", {
    candidate: {
      address: "Tokyo Station, Tokyo, Japan",
      evidence: "USER_INPUT",
      source: "USER_INDEPENDENT_INPUT",
      extractedFrom: "public-probe",
      coordinateRole: "UNKNOWN",
    },
  });
}
const session = await call("SESSION", "/v1/maps/google/session", {});
const params = new URLSearchParams({ session: session.session });
const zoom = 15,
  lat = 35.681236,
  lng = 139.767125;
const x = Math.floor(((lng + 180) / 360) * 2 ** zoom);
const y = Math.floor(
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** zoom,
);
await call("TILE", `/v1/maps/google/tiles/${zoom}/${x}/${y}?${params}`);
for (const [k, v] of Object.entries({
  zoom: "15",
  north: "35.69",
  south: "35.67",
  east: "139.78",
  west: "139.75",
}))
  params.set(k, v);
await call("VIEWPORT", `/v1/maps/google/viewport?${params}`);
