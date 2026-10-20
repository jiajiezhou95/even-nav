import { z } from "zod";
import { NavError } from "../../../packages/contracts/src/index";
import type { Identity } from "./auth";
import type { QuotaNamespace, Store } from "./quota";

export const imuLabelSchema = z.enum([
  "still",
  "left",
  "right",
  "nod",
  "tilt",
  "phone",
]);
export const imuIdSchema = z.string().uuid();
export const imuUploadSchema = z
  .object({
    schemaVersion: z.literal(1),
    label: imuLabelSchema.optional(),
    samples: z
      .array(
        z
          .object({
            receivedAt: z.number().finite().min(0).max(61_000),
            phase: imuLabelSchema,
            x: z.number().finite().min(-1_000_000).max(1_000_000),
            y: z.number().finite().min(-1_000_000).max(1_000_000),
            z: z.number().finite().min(-1_000_000).max(1_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(6000)
      .refine((samples) =>
        samples.every(
          (s, i) => i === 0 || s.receivedAt >= samples[i - 1].receivedAt,
        ),
      ),
  })
  .strict();
type Upload = z.infer<typeof imuUploadSchema>;
interface Metadata {
  id: string;
  receivedAt: string;
  sampleCount: number;
  ownerHash: string;
  label?: z.infer<typeof imuLabelSchema>;
}
const latestKey = "imu:latest";
const historyKey = "imu:history";
const chunkKey = (slot: number, index: number) =>
  slot === 0 ? `imu:latest:${index}` : `imu:slot:${slot}:${index}`;
const chunkSize = 250;
const chunkCount = 24;
const reportLimit = 20;
interface History {
  nextSlot: number;
  reports: (Metadata & { slot: number })[];
}
function publicMetadata(metadata: Metadata) {
  return {
    id: metadata.id,
    receivedAt: metadata.receivedAt,
    sampleCount: metadata.sampleCount,
    ...(metadata.label ? { label: metadata.label } : {}),
  };
}
const internalSchema = z
  .object({
    ownerHash: z.string().regex(/^[a-f0-9]{64}$/),
    data: imuUploadSchema.optional(),
    id: imuIdSchema.optional(),
  })
  .strict();

/** Internal DO endpoint, reached only after Worker authentication. */
export async function imuStorage(request: Request, storage: Store) {
  const body = internalSchema.safeParse(await request.json());
  const path = new URL(request.url).pathname;
  if (
    request.method !== "POST" ||
    !body.success ||
    !["/imu/read", "/imu/write", "/imu/list"].includes(path) ||
    (path === "/imu/write" && !body.data.data)
  )
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const { ownerHash, data, id } = body.data;
  return storage.transaction(async (tx) => {
    let history = await tx.get<History>(historyKey);
    if (!history) {
      // Existing 0.1.7 records already occupy slot zero. Keep their bytes and ID.
      const legacy = await tx.get<Metadata>(latestKey);
      history = {
        nextSlot: legacy ? 1 : 0,
        reports: legacy ? [{ ...legacy, slot: 0 }] : [],
      };
    }
    if (path === "/imu/write" && data) {
      const metadata: Metadata = {
        id: crypto.randomUUID(),
        receivedAt: new Date().toISOString(),
        sampleCount: data.samples.length,
        ownerHash,
        ...(data.label ? { label: data.label } : {}),
      };
      const slot = history.nextSlot;
      // Fixed chunks keep each value below the DO 128 KiB value limit.
      // Overwrite every slot so a shorter upload leaves no old samples behind.
      for (let i = 0; i < chunkCount; i++)
        await tx.put(
          chunkKey(slot, i),
          data.samples.slice(i * chunkSize, (i + 1) * chunkSize),
        );
      // Keep the legacy metadata consistent when its fixed slot is reused.
      if (slot === 0) await tx.put(latestKey, metadata);
      await tx.put<History>(historyKey, {
        nextSlot: (slot + 1) % reportLimit,
        reports: [
          { ...metadata, slot },
          ...history.reports.filter((report) => report.slot !== slot),
        ].slice(0, reportLimit),
      });
      return Response.json(publicMetadata(metadata));
    }
    const owned = history.reports.filter(
      (report) => report.ownerHash === ownerHash,
    );
    if (path === "/imu/list")
      return Response.json({ reports: owned.map(publicMetadata) });
    const metadata = id ? owned.find((report) => report.id === id) : owned[0];
    if (!metadata)
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    const samples: Upload["samples"] = [];
    for (let i = 0; i < Math.ceil(metadata.sampleCount / chunkSize); i++) {
      const chunk = await tx.get<Upload["samples"]>(chunkKey(metadata.slot, i));
      if (!chunk) throw new Error("Missing IMU chunk");
      samples.push(...chunk);
    }
    if (samples.length !== metadata.sampleCount)
      throw new Error("Incomplete IMU record");
    return Response.json({
      ...publicMetadata(metadata),
      schemaVersion: 1,
      samples,
    });
  });
}

export async function imuUploadCall(
  identity: Identity,
  ns: QuotaNamespace | undefined,
  data?: Upload,
  selection?: "list" | string,
) {
  if (!data && identity.kind !== "owner")
    throw new NavError("AUTH_FAILED", "读取采样需要所有者凭据");
  if (!ns) throw new NavError("CONFIG_MISSING", "采样存储未配置");
  let result: Response;
  try {
    result = await ns
      .get(ns.idFromName("personal"))
      .fetch(
        `https://quota/imu/${data ? "write" : selection === "list" ? "list" : "read"}`,
        {
          method: "POST",
          body: JSON.stringify({
            ownerHash: identity.ownerHash,
            ...(data ? { data } : {}),
            ...(selection && selection !== "list" ? { id: selection } : {}),
          }),
        },
      );
  } catch {
    throw new NavError("PROVIDER_UNAVAILABLE", "采样存储不可用");
  }
  if (!result.ok && result.status !== 404)
    throw new NavError("PROVIDER_UNAVAILABLE", "采样存储不可用");
  return result;
}
