import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const c = JSON.parse(readFileSync(".local/config.json", "utf8"));
const allowed = new Map([
  ["ACCESS_TOKEN", c.accessToken],
  ["GOOGLE_API_KEY", c.googleApiKey],
]);
for (const [name, value] of allowed) {
  if (!value) {
    console.log(`${name}: NOT CONFIGURED`);
    continue;
  }
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "secret",
      "put",
      name,
      "--config",
      "apps/worker/wrangler.toml",
    ],
    { input: value + "\n", encoding: "utf8" },
  );
  // Never echo CLI output that might contain secret input.
  console.log(`${name}: ${r.status === 0 ? "CONFIGURED" : "FAILED"}`);
  if (r.status !== 0) process.exitCode = 1;
}
