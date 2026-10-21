import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const problems: string[] = [];
const examined: string[] = [];
const secrets: string[] = [];
if (existsSync(".local/config.json")) {
  const local = JSON.parse(readFileSync(".local/config.json", "utf8"));
  for (const field of ["accessToken", "googleApiKey", "navitimeRapidApiKey"])
    if (typeof local[field] === "string" && local[field].length >= 12)
      secrets.push(local[field]);
}
const fixture = ".local/fixtures/google-maps-share-links.json";
if (existsSync(fixture)) {
  const local = JSON.parse(readFileSync(fixture, "utf8"));
  for (const sample of local.samples ?? [])
    if (typeof sample.input === "string")
      secrets.push(...(sample.input.match(/https?:\/\/[^"\s\\]+/g) ?? []));
}
const forbiddenPath =
  /(^|\/)(\.local|node_modules|test-results|playwright-report)(\/|$)|(^|\/)\.env(?!\.example$)|\.local\.json$|\.log$/;
const secretPatterns = [
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /even_device_[a-f0-9]{64}/,
];
const inspect = (file: string) => {
  if (!statSync(file).isFile()) {
    problems.push(`Unexpected nested directory in publication: ${file}`);
    return;
  }
  if (forbiddenPath.test(file.replaceAll("\\", "/")))
    problems.push(`Forbidden publication path: ${file}`);
  const data = readFileSync(file, "utf8");
  examined.push(file);
  if (secretPatterns.some((p) => p.test(data)))
    problems.push(`Credential-shaped content: ${file}`);
  if (secrets.some((secret) => data.includes(secret)))
    problems.push(`Private configuration or fixture content: ${file}`);
};
files.forEach(inspect);
function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else inspect(p);
  }
}
if (existsSync("dist")) walk("dist");
console.log(
  JSON.stringify(
    {
      status: problems.length ? "FAIL" : "PASS",
      scannedFiles: examined.length,
      problems,
    },
    null,
    2,
  ),
);
if (problems.length) process.exitCode = 1;
