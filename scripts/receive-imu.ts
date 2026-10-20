import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Owner-only retrieval. Never print credentials or raw sensor samples.
const config = JSON.parse(readFileSync(".local/config.json", "utf8"));
if (!config.workerOrigin || !config.accessToken)
  throw new Error("Local Worker configuration missing");
const response = await fetch(
  new URL("/v1/diagnostics/imu", config.workerOrigin),
  {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(15000),
  },
);
if (response.status === 404) {
  console.log("No uploaded sample yet.");
} else if (!response.ok) {
  throw new Error(`Sample retrieval failed: HTTP ${response.status}`);
} else {
  const report = await response.json();
  mkdirSync(".local/imu", { recursive: true });
  writeFileSync(".local/imu/latest.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      status: "RECEIVED",
      id: report.id,
      sampleCount: report.sampleCount,
      savedTo: ".local/imu/latest.json",
    }),
  );
}
