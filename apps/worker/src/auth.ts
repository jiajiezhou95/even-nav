import { NavError } from "../../../packages/contracts/src/index";
import type { Store, QuotaNamespace } from "./quota";
const DEVICE_RE = /^even_device_[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
interface DeviceRecord {
  hash: string;
  ownerHash: string;
  expiresAt: number;
}
export async function secretHash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function deviceStorage(
  request: Request,
  storage: Store,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (
    request.method !== "POST" ||
    !["/auth/pair", "/auth/check", "/auth/revoke"].includes(path)
  )
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const body = (await request.json()) as {
    hash?: unknown;
    ownerHash?: unknown;
  };
  if (
    typeof body.ownerHash !== "string" ||
    !HASH_RE.test(body.ownerHash) ||
    typeof body.hash !== "string" ||
    !HASH_RE.test(body.hash)
  )
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const hash = body.hash,
    ownerHash = body.ownerHash,
    now = Date.now();
  return storage.transaction(async (tx) => {
    const stored = (await tx.get<DeviceRecord[]>("auth:devices")) ?? [];
    const active = stored.filter(
      (d) =>
        d.ownerHash === ownerHash &&
        Number.isSafeInteger(d.expiresAt) &&
        d.expiresAt > now &&
        HASH_RE.test(d.hash),
    );
    if (path === "/auth/pair") {
      if (active.length >= 8)
        return Response.json({ error: "DEVICE_LIMIT" }, { status: 429 });
      const expiresAt = now + 365 * 86400000;
      active.push({ hash, ownerHash, expiresAt });
      await tx.put("auth:devices", active);
      return Response.json({ expiresAt: new Date(expiresAt).toISOString() });
    }
    const valid = active.some((d) => d.hash === hash);
    if (!valid) return Response.json({ error: "AUTH_FAILED" }, { status: 401 });
    if (path === "/auth/revoke")
      await tx.put(
        "auth:devices",
        active.filter((d) => d.hash !== hash),
      );
    return Response.json(
      path === "/auth/revoke" ? { revoked: true } : { valid: true },
    );
  });
}
async function storageCall(
  ns: QuotaNamespace | undefined,
  path: string,
  body: unknown,
): Promise<Response> {
  if (!ns) throw new NavError("CONFIG_MISSING", "设备凭据存储未配置");
  try {
    return await ns
      .get(ns.idFromName("personal"))
      .fetch(`https://quota/auth/${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
  } catch {
    throw new NavError("PROVIDER_UNAVAILABLE", "设备凭据存储不可用");
  }
}
export interface Identity {
  kind: "owner" | "device";
  hash: string;
  ownerHash: string;
}
export async function authenticate(
  request: Request,
  owner: string | undefined,
  ns: QuotaNamespace | undefined,
): Promise<Identity> {
  if (!owner || owner.length < 24)
    throw new NavError("CONFIG_MISSING", "后端访问凭据未配置");
  const header = request.headers.get("Authorization") ?? "";
  if (header.length > 2048 || !header.startsWith("Bearer "))
    throw new NavError("AUTH_FAILED", "后端认证失败");
  const token = header.slice(7);
  const [hash, ownerHash] = await Promise.all([
    secretHash(token),
    secretHash(owner),
  ]);
  let delta = 0;
  for (let i = 0; i < hash.length; i++)
    delta |= hash.charCodeAt(i) ^ ownerHash.charCodeAt(i);
  if (delta === 0) return { kind: "owner", hash, ownerHash };
  if (!DEVICE_RE.test(token)) throw new NavError("AUTH_FAILED", "后端认证失败");
  const r = await storageCall(ns, "check", { hash, ownerHash });
  if (!r.ok)
    throw new NavError(
      r.status === 401 ? "AUTH_FAILED" : "PROVIDER_UNAVAILABLE",
      "设备凭据已失效或存储不可用",
    );
  return { kind: "device", hash, ownerHash };
}
export async function pairDevice(
  identity: Identity,
  ns: QuotaNamespace | undefined,
) {
  if (identity.kind !== "owner")
    throw new NavError("AUTH_FAILED", "配对需要所有者凭据");
  const deviceToken =
    "even_device_" +
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const r = await storageCall(ns, "pair", {
    hash: await secretHash(deviceToken),
    ownerHash: identity.ownerHash,
  });
  if (!r.ok)
    throw new NavError(
      r.status === 429 ? "QUOTA_EXCEEDED" : "PROVIDER_UNAVAILABLE",
      r.status === 429
        ? "已达到 8 个设备限额，请先撤销旧设备"
        : "设备凭据存储不可用",
    );
  const { expiresAt } = (await r.json()) as { expiresAt: string };
  return { deviceToken, expiresAt };
}
export async function revokeDevice(
  identity: Identity,
  ns: QuotaNamespace | undefined,
) {
  if (identity.kind !== "device")
    throw new NavError("AUTH_FAILED", "只能撤销当前设备凭据");
  const r = await storageCall(ns, "revoke", {
    hash: identity.hash,
    ownerHash: identity.ownerHash,
  });
  if (!r.ok)
    throw new NavError(
      r.status === 401 ? "AUTH_FAILED" : "PROVIDER_UNAVAILABLE",
      "设备撤销失败",
    );
  return { revoked: true };
}
