import { readFileSync, writeFileSync } from "node:fs";
import { resolveImport } from "../apps/worker/src/resolver";
import { NavError } from "../packages/contracts/src/index";
if (!process.argv.includes("--execute")) {
  console.log(
    "PLAN_ONLY: 12 publicly published links, sequential bounded expansion; no paid API.",
  );
  process.exit(0);
}
const data = JSON.parse(
  readFileSync("fixtures/public/published-share-links.json", "utf8"),
) as { samples: { url: string; kind: string }[] };
const rows = [];
let consecutiveTimeouts = 0;
for (const [index, sample] of data.samples.entries()) {
  if (consecutiveTimeouts >= 2) {
    rows.push({
      sample: index + 1,
      status: "NOT RUN",
      reason: "Repeated network timeout stop",
    });
    continue;
  }
  try {
    const result = await resolveImport(sample.url);
    const coordinate = result.destinationCandidates.some((c) => !!c.coordinate);
    rows.push({
      sample: index + 1,
      kind: sample.kind,
      expansion: "PASS",
      endpoint: coordinate ? "PASS" : "BLOCKED_ENRICHMENT",
      status: coordinate ? "PASS" : "BLOCKED",
    });
    consecutiveTimeouts = 0;
  } catch (e) {
    const code = e instanceof NavError ? e.code : "UNEXPECTED";
    rows.push({ sample: index + 1, kind: sample.kind, status: "FAIL", code });
    consecutiveTimeouts = code === "LINK_TIMEOUT" ? consecutiveTimeouts + 1 : 0;
  }
}
writeFileSync(
  "docs/PUBLIC_LINK_RESULTS.json",
  JSON.stringify(
    { evidence: "LIVE_LINK_EXPANSION", time: new Date().toISOString(), rows },
    null,
    2,
  ),
);
console.log(JSON.stringify(rows, null, 2));
