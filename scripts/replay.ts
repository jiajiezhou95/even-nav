import { NavigationSession, replayLocations } from "../packages/core/src/index";
import type { Route } from "../packages/contracts/src/index";
const now = Date.parse("2026-10-20T00:00:00Z");
const geometry = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.001 },
];
const route: Route = {
  id: "synthetic-road",
  provider: "GOOGLE_ROUTES",
  basemapProvider: "GOOGLE_TILES",
  fetchedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 300000).toISOString(),
  legs: [
    {
      mode: "WALK",
      geometry,
      steps: [
        {
          instruction: "合成回放：沿路线前进",
          geometry,
          distanceMeters: 111,
          durationSeconds: 90,
        },
      ],
      distanceMeters: 111,
      durationSeconds: 90,
    },
  ],
  distanceMeters: 111,
  durationSeconds: 90,
  warnings: ["SYNTHETIC, not a real route"],
  attribution: [],
};
const session = new NavigationSession();
const request = session.beginRequest("PLANNING");
session.acceptRoutes(request.version, [route], geometry[0]);
session.start(route.id, { coordinate: geometry[0], timestamp: now }, now);
const states = replayLocations(
  session,
  Array.from({ length: 11 }, (_, i) => ({
    coordinate: { lat: 0, lng: i * 0.0001 },
    timestamp: now + (i + 1) * 10000,
    accuracyMeters: 5,
  })),
);
const passed = states.at(-1)?.phase === "ARRIVED";
console.log(
  JSON.stringify({
    evidence: "REPLAY_SYNTHETIC",
    status: passed ? "PASS" : "FAIL",
    frames: states.length,
    terminal: states.at(-1)?.phase,
    providerCalls: 0,
  }),
);
if (!passed) process.exitCode = 1;
