import { it, expect, vi } from "vitest";
import { QuotaLedger, type Store } from "./quota";
class Memory implements Store {
  data = new Map<string, unknown>();
  async get<T>(key: string) {
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.data.set(key, structuredClone(value));
  }
  async transaction<T>(f: (store: Store) => Promise<T>): Promise<T> {
    return f(this);
  }
}
const reserve = (ledger: QuotaLedger) =>
  ledger.fetch(
    new Request("https://quota/reserve", {
      method: "POST",
      body: JSON.stringify({ sku: "NAVITIME_TRANSPORT" }),
    }),
  );
it("keeps free allowance across calendar month rollover and object restart", async () => {
  vi.useFakeTimers();
  try {
    const storage = new Memory();
    const make = () =>
      new QuotaLedger(
        { storage },
        { MONTHLY_CAPS: '{"NAVITIME_TRANSPORT":2}' },
      );
    vi.setSystemTime(new Date("2026-10-31T23:58:00Z"));
    expect((await reserve(make())).status).toBe(200);
    expect((await reserve(make())).status).toBe(200);
    vi.setSystemTime(new Date("2026-11-01T00:01:00Z"));
    expect((await reserve(make())).status).toBe(429);
    vi.setSystemTime(new Date("2026-12-03T00:01:00Z"));
    expect((await reserve(make())).status).toBe(200);
  } finally {
    vi.useRealTimers();
  }
});
it("uses a rolling minute cap rather than permitting 90 calls across minute boundary", async () => {
  vi.useFakeTimers();
  try {
    const ledger = new QuotaLedger({ storage: new Memory() });
    vi.setSystemTime(new Date("2026-10-21T00:00:59Z"));
    for (let i = 0; i < 45; i++)
      expect((await reserve(ledger)).status).toBe(200);
    vi.setSystemTime(new Date("2026-10-21T00:01:01Z"));
    expect((await reserve(ledger)).status).toBe(429);
    vi.setSystemTime(new Date("2026-10-21T00:02:00Z"));
    expect((await reserve(ledger)).status).toBe(200);
  } finally {
    vi.useRealTimers();
  }
});
