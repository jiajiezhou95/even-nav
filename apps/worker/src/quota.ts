import { deviceStorage } from "./auth";
import { imuStorage } from "./imu-upload";
import { NavError } from "../../../packages/contracts/src/index";
export const CAPS = {
  ROUTES_ESSENTIALS: 1000,
  ROUTES_PRO: 300,
  TILES: 80000,
  DETAILS: 500,
  GEOCODING: 500,
  TEXT_SEARCH: 100,
  STATIC: 0,
  SESSION: 100,
  VIEWPORT: 3000,
  TRANSIT: 500,
  NAVITIME_TRANSPORT: 450,
  IMPORT: 3000,
} as const;
export type Sku = keyof typeof CAPS;
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(f: (txn: Store) => Promise<T>): Promise<T>;
}
interface Usage {
  month: string;
  counts: Record<string, number>;
  minute: number;
  requests: number;
  reservedOperations: number;
}
export class QuotaLedger {
  constructor(
    private state: { storage: Store },
    private env: { MONTHLY_CAPS?: string } = {},
  ) {}
  private caps() {
    const limits: { [K in Sku]: number } = { ...CAPS };
    if (this.env.MONTHLY_CAPS) {
      const supplied = JSON.parse(this.env.MONTHLY_CAPS) as Record<
        string,
        unknown
      >;
      for (const [k, v] of Object.entries(supplied)) {
        if (
          !(k in limits) ||
          typeof v !== "number" ||
          !Number.isSafeInteger(v) ||
          v < 0 ||
          v > CAPS[k as Sku]
        )
          throw new Error("Invalid caps");
        limits[k as Sku] = v;
      }
    }
    return limits;
  }
  async fetch(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname.startsWith("/auth/"))
        return await deviceStorage(request, this.state.storage);
      if (new URL(request.url).pathname.startsWith("/imu/"))
        return await imuStorage(request, this.state.storage);
      const caps = this.caps();
      const now = new Date(),
        month = now.toISOString().slice(0, 7);
      if (request.method === "GET") {
        const usage = await this.state.storage.get<Usage>(`usage:${month}`);
        const navitime = await this.state.storage.get<{
          days: Record<string, number>;
        }>("navitime:usage");
        const day = Math.floor(now.getTime() / 86400000);
        const navitimeRollingUsed = Object.entries(navitime?.days ?? {}).reduce(
          (sum, [date, count]) =>
            Number(date) >= day - 31 ? sum + count : sum,
          0,
        );
        return Response.json({
          month,
          counts: usage?.counts ?? {},
          navitimeRollingUsed,
          reservedOperations: usage?.reservedOperations ?? 0,
          warnings: Object.fromEntries(
            Object.entries(caps).map(([sku, cap]) => {
              const used =
                sku === "NAVITIME_TRANSPORT"
                  ? Math.max(usage?.counts[sku] ?? 0, navitimeRollingUsed)
                  : (usage?.counts[sku] ?? 0);
              return [
                sku,
                {
                  remaining: Math.max(0, cap - used),
                  level:
                    cap === 0
                      ? "DISABLED"
                      : used >= cap
                        ? "HARD_LIMIT"
                        : used >= cap * 0.95
                          ? "95_PERCENT"
                          : used >= cap * 0.8
                            ? "80_PERCENT"
                            : "OK",
                },
              ];
            }),
          ),
          caps,
          thresholds: [0.8, 0.95],
          billableUnitsAreEstimates: true,
          providerInvoice: null,
        });
      }
      const { sku } = (await request.json()) as { sku: Sku };
      if (!(sku in caps))
        return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
      const result = await this.state.storage.transaction(async (tx) => {
        const minute = Math.floor(now.getTime() / 60000);
        const u = (await tx.get<Usage>(`usage:${month}`)) ?? {
          month,
          counts: {},
          minute,
          requests: 0,
          reservedOperations: 0,
        };
        if (u.minute !== minute) {
          u.minute = minute;
          u.requests = 0;
        }
        if (u.requests >= 120 || (u.counts[sku] ?? 0) >= caps[sku])
          return false;
        // Rolling 31-day cap avoids resetting the free allowance on a calendar
        // month boundary when the provider subscription renews on another day.
        if (sku === "NAVITIME_TRANSPORT") {
          const day = Math.floor(now.getTime() / 86400000);
          const usage = (await tx.get<{
            days: Record<string, number>;
            recent: number[];
          }>("navitime:usage")) ?? { days: {}, recent: [] };
          usage.days = Object.fromEntries(
            Object.entries(usage.days).filter(([d]) => Number(d) >= day - 31),
          );
          usage.recent = usage.recent.filter((t) => t > now.getTime() - 60000);
          if (
            usage.recent.length >= 45 ||
            Object.values(usage.days).reduce((sum, n) => sum + n, 0) >=
              caps.NAVITIME_TRANSPORT
          )
            return false;
          usage.days[day] = (usage.days[day] ?? 0) + 1;
          usage.recent.push(now.getTime());
          await tx.put("navitime:usage", usage);
        }
        u.requests++;
        u.reservedOperations++;
        u.counts[sku] = (u.counts[sku] ?? 0) + 1;
        await tx.put(`usage:${month}`, u);
        return true;
      });
      return Response.json(
        { reserved: result },
        { status: result ? 200 : 429 },
      );
    } catch {
      return Response.json(
        { error: "QUOTA_STORAGE_UNAVAILABLE" },
        { status: 503 },
      );
    }
  }
}
export interface QuotaNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  };
}
export async function reserve(ns: QuotaNamespace | undefined, sku: Sku) {
  if (!ns) throw new NavError("CONFIG_MISSING", "持久化配额未配置");
  let r: Response;
  try {
    r = await ns.get(ns.idFromName("personal")).fetch("https://quota/reserve", {
      method: "POST",
      body: JSON.stringify({ sku }),
    });
  } catch {
    throw new NavError("PROVIDER_UNAVAILABLE", "配额存储不可用，已停止新请求");
  }
  if (!r.ok)
    throw new NavError(
      r.status === 429 ? "QUOTA_EXCEEDED" : "PROVIDER_UNAVAILABLE",
      "达到限额或配额存储不可用",
    );
}
