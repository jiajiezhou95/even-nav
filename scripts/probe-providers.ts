import { readFileSync, existsSync } from "node:fs";
const enabled = process.argv.includes("--execute");
const config = existsSync(".local/config.json")
  ? JSON.parse(readFileSync(".local/config.json", "utf8"))
  : {};
console.log(
  JSON.stringify({
    mode: enabled ? "EXECUTE_NONBILLABLE_CAPABILITIES" : "PLAN_ONLY",
    calls: enabled ? 2 : 0,
    services: ["personal Worker /health", "personal Worker /v1/providers"],
    googleBillableUnits: 0,
    transitousRouteCalls: 0,
  }),
);
if (!enabled) process.exit(0);
if (!config.workerOrigin || !config.accessToken) {
  console.log("BLOCKED: configure local workerOrigin/accessToken");
  process.exit(2);
}
for (const path of ["/health", "/v1/providers"]) {
  const r = await fetch(new URL(path, config.workerOrigin), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) {
    console.log(JSON.stringify({ path, status: "BLOCKED", http: r.status }));
    process.exitCode = 2;
    continue;
  }
  const data = (await r.json()) as { google?: { configured: boolean } };
  console.log(JSON.stringify({ path, status: "PASS", data }));
  if (path === "/v1/providers" && !data.google?.configured) {
    console.log("Google LIVE_PROVIDER: BLOCKED (BYOK missing)");
    process.exitCode = 2;
  }
}
