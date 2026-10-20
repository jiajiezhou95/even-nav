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
let tracked = false;
try {
  ignored = !!execFileSync("git", ["check-ignore", ".local/config.json"], {
    encoding: "utf8",
  }).trim();
} catch {}
try {
  tracked = !!execFileSync("git", ["ls-files", "--", ".local/config.json"], {
    encoding: "utf8",
  }).trim();
} catch {
  tracked = true;
}
let config: Record<string, unknown> = {};
let configValid = false;
try {
  const parsed: unknown = JSON.parse(
    readFileSync(".local/config.json", "utf8"),
  );
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    config = parsed as Record<string, unknown>;
    configValid = true;
  }
} catch {}
const configured = (field: string) =>
  typeof config[field] === "string" &&
  (config[field] as string).trim().length > 0;
let originValid = false;
try {
  const value = config.workerOrigin;
  if (typeof value === "string") {
    const url = new URL(value);
    originValid = url.protocol === "https:" && url.origin === value;
  }
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
    ignored && !tracked,
    "Must be Git-ignored and absent from tracked files; no values displayed",
  ),
  check(
    "Local configuration",
    configValid,
    "Valid local JSON object required; never put keys in VITE_*",
  ),
  check(
    "Worker origin format",
    originValid,
    "Exact HTTPS origin required; connectivity is not checked",
  ),
  check(
    "Worker access token present",
    configured("accessToken"),
    "Presence only; authenticated connectivity is not checked",
  ),
  check(
    "Google key present",
    configured("googleApiKey"),
    "Presence only; API enablement, restrictions and billing are not checked",
  ),
  check("Frontend build", existsSync("dist/index.html"), "npm run build"),
  check("Package", existsSync("artifacts/even-nav.ehpk"), "npm run pack"),
];
console.log(JSON.stringify(results, null, 2));
console.log(
  "Local preflight only. Even login, live APIs, Beta installation, G2 and lockscreen acceptance are NOT VERIFIED by this command.",
);
if (results.some((r) => r.status === "BLOCKED")) process.exitCode = 2;
