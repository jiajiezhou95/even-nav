import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const config = existsSync(".local/config.json")
  ? JSON.parse(readFileSync(".local/config.json", "utf8"))
  : {};
const origin = config.workerOrigin ?? "";
if (
  origin &&
  (new URL(origin).protocol !== "https:" || new URL(origin).origin !== origin)
)
  throw new Error("workerOrigin must be an exact HTTPS origin");
const sdk = JSON.parse(
  readFileSync("node_modules/@evenrealities/even_hub_sdk/package.json", "utf8"),
);
const manifest = {
  package_id: "io.github.jiajiezhou95.evennav",
  edition: "202601",
  name: "Even Nav",
  version: "0.1.14",
  min_app_version: sdk.minAppVersion,
  min_sdk_version: sdk.version,
  entrypoint: "index.html",
  permissions: [
    ...(origin
      ? [
          {
            name: "network",
            desc: "访问本人后端以导入链接、查询路线和地图",
            whitelist: [origin],
          },
        ]
      : []),
    { name: "location", desc: "使用手机当前位置进行导航" },
  ],
  supported_languages: ["zh", "ja", "en"],
};
writeFileSync("app.json", JSON.stringify(manifest, null, 2) + "\n");
execFileSync(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "apps/even-nav",
    "--outDir",
    "../../dist",
    "--emptyOutDir",
  ],
  { stdio: "inherit", env: { ...process.env, VITE_WORKER_ORIGIN: origin } },
);
mkdirSync("dist/legal", { recursive: true });
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
  copyFileSync(file, `dist/legal/${file}`);
for (const file of ["PRIVACY.md", "TERMS.md"])
  copyFileSync(`docs/${file}`, `dist/legal/${file}`);
copyFileSync(
  "node_modules/@evenrealities/even_hub_sdk/LICENSE",
  "dist/legal/even-hub-sdk-LICENSE",
);
copyFileSync("node_modules/zod/LICENSE", "dist/legal/zod-LICENSE");
execFileSync(
  process.execPath,
  ["--import", "tsx", "scripts/privacy-check.ts"],
  { stdio: "inherit" },
);
mkdirSync("artifacts", { recursive: true });
execFileSync(
  process.execPath,
  [
    "node_modules/@evenrealities/evenhub-cli/main.js",
    "pack",
    "app.json",
    "dist",
    "--sdk-ver",
    sdk.version,
    "-o",
    "artifacts/even-nav.ehpk",
    "--json",
  ],
  { stdio: "inherit" },
);
const bytes = readFileSync("artifacts/even-nav.ehpk");
if (bytes.length < 100) throw new Error("Package empty or invalid");
const sha256 = createHash("sha256").update(bytes).digest("hex");
writeFileSync("artifacts/SHA256SUMS", `${sha256}  even-nav.ehpk\n`);
console.log(
  JSON.stringify({
    status: "PASS",
    bytes: bytes.length,
    sha256,
    backendBound: !!origin,
    installation: "NOT RUN",
  }),
);
