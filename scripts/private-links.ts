import { readFileSync, writeFileSync } from "node:fs";
import { resolveImport } from "../apps/worker/src/resolver";
import { NavError } from "../packages/contracts/src/index";
if (!process.argv.includes("--execute")) {
  console.log(
    "PLAN_ONLY: at most two private share expansions; no paid API; results stay in .local",
  );
  process.exit(0);
}
const data = JSON.parse(
  readFileSync(".local/fixtures/google-maps-share-links.json", "utf8"),
) as { samples: { input: string }[] };
const rows = [];
for (const [index, sample] of data.samples.slice(0, 2).entries()) {
  const started = Date.now();
  try {
    const result = await resolveImport(sample.input);
    const hasCoordinate = result.destinationCandidates.some(
      (c) => !!c.coordinate,
    );
    rows.push({
      sample: index + 1,
      status: hasCoordinate ? "PASS" : "BLOCKED",
      expansion: "PASS",
      elapsedMs: Date.now() - started,
      candidates: result.destinationCandidates.length,
      hasCoordinate,
      evidence: "LIVE_LINK_EXPANSION",
      gap: hasCoordinate ? undefined : "DESTINATION_ENRICHMENT_REQUIRED",
    });
  } catch (e) {
    rows.push({
      sample: index + 1,
      status: "FAIL",
      elapsedMs: Date.now() - started,
      code: e instanceof NavError ? e.code : "UNEXPECTED",
      evidence: "LIVE_LINK_EXPANSION",
    });
  }
}
writeFileSync(
  ".local/private-link-results.json",
  JSON.stringify(rows, null, 2),
);
console.log(
  JSON.stringify({
    total: rows.length,
    passed: rows.filter((r) => r.status === "PASS").length,
    failures: rows
      .filter((r) => r.status === "FAIL")
      .map((r) => ({ sample: r.sample, code: r.code })),
    privateDetails: "Not printed or published",
  }),
);
