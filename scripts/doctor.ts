import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const check = (name: string, ok: boolean, detail: string) => ({
  name,
  status: ok ? "PASS" : "BLOCKED",
  detail,
});
const sdk = JSON.parse(
  readFileSync("node_modules/@evenrealities/even_hub_sdk/package.json", "utf8"),
);
let ignored = false;
try {
  ignored = !!execFileSync("git", ["check-ignore", ".local/config.json"], {
    encoding: "utf8",
  }).trim();
} catch {}
const results = [
  check(
    "Node runtime",
    Number(process.versions.node.split(".")[0]) >= 22,
    process.versions.node,
  ),
  check("Official SDK", !!sdk.version, sdk.version),
  check(
    "Private config excluded",
    ignored,
    "Only presence and non-secret metadata checked",
  ),
  check(
    "Local configuration",
    existsSync(".local/config.json"),
    "Use .local/config.json; never put keys in VITE_*",
  ),
  check("Frontend build", existsSync("dist/index.html"), "npm run build"),
  check("Package", existsSync("artifacts/even-nav.ehpk"), "npm run pack"),
];
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => r.status === "BLOCKED")) process.exitCode = 2;
