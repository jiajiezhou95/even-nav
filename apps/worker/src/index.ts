import { z } from "zod";
import { authenticate, pairDevice, revokeDevice } from "./auth";
import { NavError } from "../../../packages/contracts/src/index";
import {
  ProviderError,
  boundedJson,
  candidateSchema,
  enrichDestination,
  enrichmentSku,
  googleRoutes,
  policyGuard,
  roadSku,
  transitRoutes,
  tripSchema,
  upstream,
  type Fetcher,
} from "../../../packages/providers/src/index";
import { resolveImport } from "./resolver";
import { reserve, type QuotaNamespace } from "./quota";
export { QuotaLedger } from "./quota";
export interface Env {
  ACCESS_TOKEN?: string;
  GOOGLE_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  EVEN_APP_LOOPBACK?: string;
  TRANSITOUS_ENABLED?: string;
  TRANSITOUS_CONTACT?: string;
  QUOTA?: QuotaNamespace;
  MONTHLY_CAPS?: string;
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function configured(key: string | undefined) {
  if (!key) throw new NavError("CONFIG_MISSING", "Google BYOK 尚未配置");
  return key;
}
async function payload(r: Request) {
  if (!r.headers.get("Content-Type")?.startsWith("application/json"))
    throw new NavError("INVALID_INPUT", "需要 JSON 请求");
  if (Number(r.headers.get("Content-Length")) > 16384)
    throw new NavError("INVALID_INPUT", "请求过大");
  const reader = r.body?.getReader();
  if (!reader) throw new NavError("INVALID_INPUT", "缺少请求数据");
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 16384) throw new NavError("INVALID_INPUT", "请求过大");
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof NavError) throw e;
    throw new NavError("INVALID_INPUT", "请求格式无效");
  } finally {
    await reader.cancel();
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value);
  if (!p.success) throw new NavError("INVALID_INPUT", "请求字段或范围无效");
  return p.data;
}
const sessionSchema = z.string().regex(/^[A-Za-z0-9_-]{8,1024}$/);
export function createWorker(fetcher: Fetcher = fetch) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const origin = request.headers.get("Origin");
      const allowed = (env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // The installed iPhone Even App serves its package on a changing loopback
      // port (observed in a real preflight). This grants CORS, not authentication.
      const loopbackPort = origin?.match(
        /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/,
      )?.[1];
      const evenLoopback =
        env.EVEN_APP_LOOPBACK === "true" &&
        loopbackPort !== undefined &&
        Number(loopbackPort) <= 65535;
      const cors =
        origin && (allowed.includes(origin) || evenLoopback)
          ? origin
          : undefined;
      let result: Response;
      try {
        if (origin && !cors) throw new NavError("AUTH_FAILED", "来源未获授权");
        if (request.method === "OPTIONS") {
          if (!cors) throw new NavError("AUTH_FAILED", "来源未获授权");
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": cors,
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Authorization, Content-Type",
              "Access-Control-Max-Age": "600",
              Vary: "Origin",
            },
          });
        }
        const u = new URL(request.url);
        if (u.pathname === "/health" && request.method === "GET")
          result = json({ status: "ok", version: "0.1.1" });
        else {
          const identity = await authenticate(
            request,
            env.ACCESS_TOKEN,
            env.QUOTA,
          );
          if (u.pathname === "/v1/auth/pair" && request.method === "POST") {
            parse(z.object({}).strict(), await payload(request));
            result = json(await pairDevice(identity, env.QUOTA));
          } else if (
            u.pathname === "/v1/auth/revoke" &&
            request.method === "POST"
          ) {
            parse(z.object({}).strict(), await payload(request));
            result = json(await revokeDevice(identity, env.QUOTA));
          } else if (u.pathname === "/v1/providers" && request.method === "GET")
            result = json({
              google: {
                configured: !!env.GOOGLE_API_KEY,
                road: ["WALK", "DRIVE"],
                tiles: true,
              },
              transitous: {
                configured:
                  env.TRANSITOUS_ENABLED === "true" && !!env.TRANSITOUS_CONTACT,
                status:
                  env.TRANSITOUS_ENABLED === "true" && env.TRANSITOUS_CONTACT
                    ? "CONFIGURED_NOT_LIVE_VERIFIED"
                    : "BLOCKED_CONTACT_REQUIRED",
              },
              openMap: { configured: false },
              staticMaps: { enabled: false, cap: 0 },
              quotaConfigured: !!env.QUOTA,
            });
          else if (u.pathname === "/v1/usage" && request.method === "GET") {
            if (!env.QUOTA) throw new NavError("CONFIG_MISSING", "配额未配置");
            const r = await env.QUOTA.get(
              env.QUOTA.idFromName("personal"),
            ).fetch("https://quota/usage");
            if (!r.ok)
              throw new NavError("PROVIDER_UNAVAILABLE", "配额存储不可用");
            result = json(await r.json());
          } else if (
            u.pathname === "/v1/import/resolve" &&
            request.method === "POST"
          ) {
            const b = parse(
              z.object({ text: z.string().min(1).max(8192) }).strict(),
              await payload(request),
            );
            await reserve(env.QUOTA, "IMPORT");
            result = json(await resolveImport(b.text, fetcher));
          } else if (
            u.pathname === "/v1/destinations/resolve" &&
            request.method === "POST"
          ) {
            const b = parse(
              z.object({ candidate: candidateSchema }).strict(),
              await payload(request),
            );
            if (
              b.candidate.coordinate &&
              b.candidate.coordinateRole === "ENDPOINT"
            )
              result = json({ candidates: [b.candidate] });
            else {
              const key = configured(env.GOOGLE_API_KEY);
              await reserve(env.QUOTA, enrichmentSku(b.candidate));
              result = json({
                candidates: await enrichDestination(b.candidate, key, fetcher),
              });
            }
          } else if (
            ["/v1/routes/road", "/v1/routes/transit"].includes(u.pathname) &&
            request.method === "POST"
          ) {
            const t = parse(tripSchema, await payload(request));
            policyGuard(t);
            if (u.pathname.endsWith("transit") !== (t.mode === "TRANSIT"))
              throw new NavError("INVALID_INPUT", "模式与接口不一致");
            if (t.mode === "TRANSIT") {
              if (env.TRANSITOUS_ENABLED !== "true" || !env.TRANSITOUS_CONTACT)
                throw new NavError(
                  "CONFIG_MISSING",
                  "Transitous 接入沟通与联系信息尚未配置",
                );
              if (t.basemapProvider === "GOOGLE_TILES")
                configured(env.GOOGLE_API_KEY);
              await reserve(env.QUOTA, "TRANSIT");
              result = json({
                requestVersion: t.requestVersion,
                routes: await transitRoutes(
                  t,
                  `EvenNav/0.1.0 (${env.TRANSITOUS_CONTACT})`,
                  fetcher,
                ),
              });
            } else {
              const key = configured(env.GOOGLE_API_KEY);
              await reserve(env.QUOTA, roadSku(t));
              result = json({
                requestVersion: t.requestVersion,
                routes: await googleRoutes(t, key, fetcher),
              });
            }
          } else if (
            u.pathname === "/v1/maps/google/session" &&
            request.method === "POST"
          ) {
            parse(z.object({}).strict(), await payload(request));
            const key = configured(env.GOOGLE_API_KEY);
            await reserve(env.QUOTA, "SESSION");
            const url = new URL("https://tile.googleapis.com/v1/createSession");
            url.searchParams.set("key", key);
            const response = await boundedJson(
              await upstream(
                url,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    mapType: "roadmap",
                    language: "ja",
                    region: "JP",
                    imageFormat: "png",
                    styles: [{ stylers: [{ saturation: -100 }] }],
                  }),
                },
                fetcher,
              ),
            );
            result = json(
              parse(
                z.object({
                  session: sessionSchema,
                  expiry: z.string().regex(/^\d+$/),
                  tileWidth: z.number().int().positive(),
                  tileHeight: z.number().int().positive(),
                  imageFormat: z.enum(["png", "jpeg"]),
                }),
                response,
              ),
            );
          } else if (
            u.pathname.startsWith("/v1/maps/google/tiles/") &&
            request.method === "GET"
          ) {
            const parts = u.pathname.match(
              /^\/v1\/maps\/google\/tiles\/(\d+)\/(\d+)\/(\d+)$/,
            );
            if (!parts) throw new NavError("INVALID_INPUT", "瓦片地址无效");
            const [zoom, x, y] = parts.slice(1).map(Number);
            if (zoom > 22 || x >= 2 ** zoom || y >= 2 ** zoom)
              throw new NavError("INVALID_INPUT", "瓦片范围无效");
            const session = parse(sessionSchema, u.searchParams.get("session"));
            const key = configured(env.GOOGLE_API_KEY);
            await reserve(env.QUOTA, "TILES");
            const target = new URL(
              `https://tile.googleapis.com/v1/2dtiles/${zoom}/${x}/${y}`,
            );
            target.search = new URLSearchParams({ session, key }).toString();
            const r = await upstream(target, {}, fetcher);
            const contentType = r.headers.get("Content-Type") ?? "";
            if (
              !["image/png", "image/jpeg"].includes(contentType.split(";")[0])
            ) {
              await r.body?.cancel();
              throw new NavError("PROVIDER_UNAVAILABLE", "瓦片格式无效");
            }
            result = new Response(r.body, {
              headers: {
                "Content-Type": contentType,
                "Cache-Control": "private, no-store",
              },
            });
          } else if (
            u.pathname === "/v1/maps/google/viewport" &&
            request.method === "GET"
          ) {
            const b = parse(
              z
                .object({
                  session: sessionSchema,
                  zoom: z.coerce.number().int().min(0).max(22),
                  north: z.coerce.number().min(-90).max(90),
                  south: z.coerce.number().min(-90).max(90),
                  east: z.coerce.number().min(-180).max(180),
                  west: z.coerce.number().min(-180).max(180),
                })
                .strict(),
              Object.fromEntries(u.searchParams),
            );
            if (b.north <= b.south)
              throw new NavError("INVALID_INPUT", "视口范围无效");
            const key = configured(env.GOOGLE_API_KEY);
            await reserve(env.QUOTA, "VIEWPORT");
            const target = new URL(
              "https://tile.googleapis.com/tile/v1/viewport",
            );
            target.search = new URLSearchParams({
              ...Object.fromEntries(
                Object.entries(b).map(([k, v]) => [k, String(v)]),
              ),
              key,
            }).toString();
            const r = await boundedJson(await upstream(target, {}, fetcher));
            result = json(
              parse(
                z.object({
                  copyright: z.string(),
                  maxZoomRects: z.array(z.unknown()).optional(),
                }),
                r,
              ),
            );
          } else
            result = json(
              {
                error: {
                  code: "INVALID_INPUT",
                  message: "接口不存在或方法不支持",
                  retryable: false,
                },
              },
              404,
            );
        }
      } catch (e) {
        const error =
          e instanceof NavError
            ? e
            : new NavError(
                "PROVIDER_UNAVAILABLE",
                "请求失败，请检查配置后重试",
              );
        const status =
          error.code === "AUTH_FAILED"
            ? 401
            : error.code === "QUOTA_EXCEEDED"
              ? 429
              : error.code === "CONFIG_MISSING"
                ? 503
                : ["PROVIDER_UNAVAILABLE", "LINK_TIMEOUT"].includes(error.code)
                  ? 502
                  : 400;
        result = json(
          {
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              fallback: error.fallback,
              ...(error instanceof ProviderError
                ? { diagnostic: error.diagnostic }
                : {}),
            },
          },
          status,
        );
      }
      if (cors) {
        result.headers.set("Access-Control-Allow-Origin", cors);
        result.headers.set("Vary", "Origin");
      }
      result.headers.set("X-Content-Type-Options", "nosniff");
      return result;
    },
  };
}
export default createWorker();
