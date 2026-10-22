import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  imuIdSchema,
  imuLabelSchema,
  imuUploadSchema,
} from "../apps/worker/src/imu-upload";

// Owner-only retrieval. Never print credentials or raw sensor samples.
const metadataSchema = z
  .object({
    id: imuIdSchema,
    receivedAt: z.string().datetime(),
    sampleCount: z.number().int().min(1).max(6000),
    label: imuLabelSchema.optional(),
  })
  .strict();
const reportSchema = imuUploadSchema
  .merge(metadataSchema)
  .refine((report) => report.sampleCount === report.samples.length);
function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid IMU response or saved report");
  return parsed.data;
}
const config = JSON.parse(readFileSync(".local/config.json", "utf8"));
if (!config.workerOrigin || !config.accessToken)
  throw new Error("Local Worker configuration missing");
async function retrieve(path: string) {
  const response = await fetch(new URL(path, config.workerOrigin), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Sample retrieval failed: HTTP ${response.status}`);
  return response.json();
}
const { reports } = validated(
  z.object({ reports: z.array(metadataSchema).max(20) }).strict(),
  await retrieve("/v1/diagnostics/imu/list"),
);
if (new Set(reports.map((report) => report.id)).size !== reports.length)
  throw new Error("Duplicate IMU report IDs");
if (!reports.length) {
  console.log("No uploaded sample yet.");
} else {
  mkdirSync(".local/imu/reports", { recursive: true });
  for (const metadata of reports) {
    const savedTo = `.local/imu/reports/${metadata.id}.json`;
    const cached = existsSync(savedTo);
    const report = validated(
      reportSchema,
      cached
        ? JSON.parse(readFileSync(savedTo, "utf8"))
        : await retrieve(`/v1/diagnostics/imu/${metadata.id}`),
    );
    if (
      report.id !== metadata.id ||
      report.receivedAt !== metadata.receivedAt ||
      report.sampleCount !== metadata.sampleCount ||
      report.label !== metadata.label
    )
      throw new Error("IMU report metadata mismatch");
    if (!cached)
      writeFileSync(savedTo, JSON.stringify(report, null, 2), { flag: "wx" });
    if (metadata.id === reports[0].id)
      writeFileSync(".local/imu/latest.json", JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        status: cached ? "ALREADY_SAVED" : "RECEIVED",
        ...metadata,
        savedTo,
      }),
    );
  }
}
