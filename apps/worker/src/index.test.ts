import { describe, it, expect, vi } from "vitest";
import { createWorker, type Env } from "./index";
import { QuotaLedger, type Store, type QuotaNamespace } from "./quota";
import { resolveImport } from "./resolver";
import type { Fetcher } from "../../../packages/providers/src/index";
class Memory implements Store {
  data = new Map<string, unknown>();
  tail: Promise<unknown> = Promise.resolve();
  async get<T>(k: string) {
    return structuredClone(this.data.get(k)) as T | undefined;
  }
  async put<T>(k: string, v: T) {
    this.data.set(k, structuredClone(v));
  }
  async transaction<T>(f: (s: Store) => Promise<T>): Promise<T> {
    const next = this.tail.then(() => f(this));
    this.tail = next.catch(() => {});
    return next;
  }
}
const token = "synthetic-test-token-not-a-secret";
const namespace = (ledger: QuotaLedger): QuotaNamespace => ({
  idFromName: () => 1,
  get: () => ({
    fetch: (r, i) => ledger.fetch(r instanceof Request ? r : new Request(r, i)),
  }),
});
const env = (): Env => ({
  ACCESS_TOKEN: token,
  QUOTA: namespace(new QuotaLedger({ storage: new Memory() })),
  ALLOWED_ORIGINS: "https://app.example",
});
const req = (path: string, body?: unknown, auth = token) =>
  new Request(`https://worker.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
describe("Google map session display options", () => {
  it.each([undefined, "G2"] as const)(
    "constructs the exact upstream session for display %s and preserves tile dimensions",
    async (display) => {
      const dimensions = display === "G2" ? 512 : 256;
      const session = {
        session: "synthetic_session_token",
        expiry: "1799999999",
        tileWidth: dimensions,
        tileHeight: dimensions,
        imageFormat: "png",
      };
      const fetcher = vi.fn(async () => Response.json(session));
      const worker = createWorker(fetcher);
      const e = { ...env(), GOOGLE_API_KEY: "synthetic-map-key" };
      const result = await worker.fetch(
        req("/v1/maps/google/session", display ? { display } : {}),
        e,
      );
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual(session);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, init] = fetcher.mock.calls[0] as unknown as [
        URL,
        RequestInit,
      ];
      expect(String(url)).toBe(
        "https://tile.googleapis.com/v1/createSession?key=synthetic-map-key",
      );
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init.body))).toEqual({
        mapType: "roadmap",
        language: "ja",
        region: "JP",
        imageFormat: "png",
        styles: [{ stylers: [{ saturation: -100 }] }],
        ...(display === "G2" ? { scale: "scaleFactor2x", highDpi: true } : {}),
      });
    },
  );
  it.each([
    { display: "G3" },
    { display: null },
    { display: 2 },
    { display: "G2", scale: "scaleFactor4x" },
  ])(
    "rejects invalid session options before quota or provider use: %j",
    async (body) => {
      const fetcher = vi.fn();
      const e = { ...env(), GOOGLE_API_KEY: "synthetic-map-key" };
      const result = await createWorker(fetcher).fetch(
        req("/v1/maps/google/session", body),
        e,
      );
      expect(result.status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
      const usage = await createWorker(fetcher).fetch(req("/v1/usage"), e);
      expect((await usage.json()).reservedOperations).toBe(0);
    },
  );
});
describe("quota durability and security", () => {
  it("atomically reserves cap across concurrent requests and object recreation", async () => {
    const storage = new Memory();
    const make = () =>
      new QuotaLedger(
        { storage },
        { MONTHLY_CAPS: JSON.stringify({ TILES: 3 }) },
      );
    const ask = (l: QuotaLedger) =>
      l.fetch(
        new Request("https://quota", {
          method: "POST",
          body: JSON.stringify({ sku: "TILES" }),
        }),
      );
    const r = await Promise.all(Array.from({ length: 10 }, () => ask(make())));
    expect(r.filter((x) => x.ok)).toHaveLength(3);
    expect((await ask(make())).status).toBe(429);
  });
  it("rolls over month independently", async () => {
    vi.useFakeTimers();
    try {
      const storage = new Memory();
      const l = new QuotaLedger({ storage }, { MONTHLY_CAPS: '{"TILES":1}' });
      const ask = () =>
        l.fetch(
          new Request("https://quota", {
            method: "POST",
            body: '{"sku":"TILES"}',
          }),
        );
      vi.setSystemTime(new Date("2026-01-31T23:59:00Z"));
      expect((await ask()).ok).toBe(true);
      expect((await ask()).status).toBe(429);
      vi.setSystemTime(new Date("2026-02-01T00:00:01Z"));
      expect((await ask()).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("reports actual warning state and reserved-operation terminology", async () => {
    const l = new QuotaLedger(
      { storage: new Memory() },
      { MONTHLY_CAPS: '{"TILES":5}' },
    );
    for (let i = 0; i < 4; i++)
      await l.fetch(
        new Request("https://quota", {
          method: "POST",
          body: '{"sku":"TILES"}',
        }),
      );
    const data = await (await l.fetch(new Request("https://quota"))).json();
    expect(data.warnings.TILES).toEqual({ remaining: 1, level: "80_PERCENT" });
    expect(data.reservedOperations).toBe(4);
    expect(data.httpRequests).toBeUndefined();
  });
  it("static cap cannot be enabled and storage failures close", async () => {
    const storage = new Memory();
    const l = new QuotaLedger({ storage });
    expect(
      (
        await l.fetch(
          new Request("https://quota", {
            method: "POST",
            body: '{"sku":"STATIC"}',
          }),
        )
      ).status,
    ).toBe(429);
    storage.transaction = async () => {
      throw Error("internal secret");
    };
    expect(
      (
        await l.fetch(
          new Request("https://quota", {
            method: "POST",
            body: '{"sku":"TILES"}',
          }),
        )
      ).status,
    ).toBe(503);
  });
  it("fails auth before provider and quota", async () => {
    const f = vi.fn() as unknown as Fetcher;
    const e = env();
    e.QUOTA = undefined;
    const r = await createWorker(f).fetch(
      req("/v1/maps/google/session", {}, "bad"),
      e,
    );
    expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });
  it("rejects revoked token", async () =>
    expect(
      (
        await createWorker().fetch(req("/v1/providers"), {
          ...env(),
          ACCESS_TOKEN: "new-synthetic-test-token-revoked",
        })
      ).status,
    ).toBe(401));
  it("rejects unauthorized CORS origin", async () => {
    const r = req("/v1/providers");
    r.headers.set("Origin", "https://evil.test");
    expect((await createWorker().fetch(r, env())).status).toBe(401);
  });
  it("allows opt-in Even App dynamic loopback preflight and authenticated requests", async () => {
    const e = { ...env(), EVEN_APP_LOOPBACK: "true" };
    const worker = createWorker();
    for (const origin of ["http://127.0.0.1:63639", "http://127.0.0.1:49152"]) {
      const preflight = await worker.fetch(
        new Request("https://worker.test/v1/auth/pair", {
          method: "OPTIONS",
          headers: { Origin: origin },
        }),
        e,
      );
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(preflight.headers.get("Vary")).toBe("Origin");
      expect(
        preflight.headers.get("Access-Control-Allow-Credentials"),
      ).toBeNull();
      const request = req("/v1/providers");
      request.headers.set("Origin", origin);
      const result = await worker.fetch(request, e);
      expect(result.status).toBe(200);
      expect(result.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
  });
  it("keeps dynamic loopback opt-in and requires credentials before any provider work", async () => {
    const f = vi.fn() as unknown as Fetcher;
    const worker = createWorker(f);
    const request = new Request("https://worker.test/v1/providers", {
      headers: { Origin: "http://127.0.0.1:63639" },
    });
    const disabled = await worker.fetch(request, env());
    expect(disabled.status).toBe(401);
    expect(disabled.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const enabled = await worker.fetch(request, {
      ...env(),
      QUOTA: undefined,
      EVEN_APP_LOOPBACK: "true",
    });
    expect(enabled.status).toBe(401);
    expect(enabled.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://127.0.0.1:63639",
    );
    expect(f).not.toHaveBeenCalled();
  });
  it.each([
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:063639",
    "http://127.0.0.1:63639/",
    "http://127.0.0.1:63639/path",
    "http://127.0.0.1:63639?query",
    "http://127.0.0.1.evil.test:63639",
    "http://127.0.0.1:63639@evil.test",
    "http://evil.test:63639",
    "https://127.0.0.1:63639",
    "http://192.168.1.1:63639",
    "http://localhost:63639",
  ])(
    "rejects origins outside the precise native loopback shape: %s",
    async (origin) => {
      const result = await createWorker().fetch(
        new Request("https://worker.test/v1/auth/pair", {
          method: "OPTIONS",
          headers: { Origin: origin },
        }),
        { ...env(), EVEN_APP_LOOPBACK: "true" },
      );
      expect(result.status).toBe(401);
      expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
    },
  );
  it("never exposes tokens in capabilities", async () => {
    const r = await createWorker().fetch(req("/v1/providers"), {
      ...env(),
      GOOGLE_API_KEY: "synthetic-key",
    });
    const s = await r.text();
    expect(s).not.toContain(token);
    expect(s).not.toContain("synthetic-key");
  });
  it("rejects invalid tiles before key/quota", async () =>
    expect(
      (
        await createWorker().fetch(
          req("/v1/maps/google/tiles/3/9/0?session=synthetic"),
          env(),
        )
      ).status,
    ).toBe(400));
  it("rejects oversized input without upstream", async () => {
    const f = vi.fn() as unknown as Fetcher;
    expect(
      (
        await createWorker(f).fetch(
          req("/v1/import/resolve", { text: "a".repeat(17000) }),
          env(),
        )
      ).status,
    ).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
describe("bounded resolver", () => {
  const full = "https://www.google.com/maps/search/?api=1&query=0,0";
  it("never fetches full links", async () => {
    const f = vi.fn() as unknown as Fetcher;
    expect(
      (await resolveImport(full, f)).destinationCandidates[0].coordinate,
    ).toEqual({ lat: 0, lng: 0 });
    expect(f).not.toHaveBeenCalled();
  });
  it("follows safe redirect without forwarding credentials", async () => {
    const f = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { Location: full } }),
    ) as unknown as Fetcher;
    expect(
      (await resolveImport("https://maps.app.goo.gl/Synthetic", f))
        .selectedGoogleItineraryImported,
    ).toBe(false);
    const init = vi.mocked(f).mock.calls[0][1]!;
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });
  it.each([
    "http://127.0.0.1/",
    "https://google.com.evil.test/maps",
    "https://user:pass@www.google.com/maps",
    "https://www.google.com/url?url=https://127.0.0.1",
    "https://[::1]/",
  ])("rejects unsafe redirect %s", async (location) => {
    const f = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { Location: location } }),
    ) as unknown as Fetcher;
    await expect(
      resolveImport("https://maps.app.goo.gl/Synthetic", f),
    ).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("detects loop", async () => {
    const f = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://maps.app.goo.gl/Synthetic" },
        }),
    ) as unknown as Fetcher;
    await expect(
      resolveImport("https://maps.app.goo.gl/Synthetic", f),
    ).rejects.toMatchObject({ code: "REDIRECT_LOOP" });
  });
  it("HEAD failure falls back to bounded GET", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: full } }),
      ) as unknown as Fetcher;
    await resolveImport("https://maps.app.goo.gl/Synthetic", f);
    expect(vi.mocked(f).mock.calls[1][1]?.method).toBe("GET");
  });
  it("refuses script-only link page", async () => {
    const f = vi.fn(
      async () => new Response("<script>private</script>"),
    ) as unknown as Fetcher;
    await expect(
      resolveImport("https://maps.app.goo.gl/Synthetic", f),
    ).rejects.toMatchObject({ code: "LINK_RESOLUTION_BLOCKED" });
  });
});

describe("durable device pairing", () => {
  it("pairs only owner and restores across Worker/Ledger restart without storing raw tokens", async () => {
    const storage = new Memory();
    const e = { ...env(), QUOTA: namespace(new QuotaLedger({ storage })) };
    const pair = await createWorker().fetch(req("/v1/auth/pair", {}), e);
    expect(pair.status).toBe(200);
    expect(pair.headers.get("Cache-Control")).toBe("no-store");
    const { deviceToken, expiresAt } = await pair.json();
    expect(deviceToken).toMatch(/^even_device_[a-f0-9]{64}$/);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    expect(JSON.stringify([...storage.data])).not.toContain(deviceToken);
    expect(JSON.stringify([...storage.data])).not.toContain(token);
    const restarted = { ...e, QUOTA: namespace(new QuotaLedger({ storage })) };
    expect(
      (
        await createWorker().fetch(
          req("/v1/providers", undefined, deviceToken),
          restarted,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await createWorker().fetch(
          req("/v1/auth/pair", {}, deviceToken),
          restarted,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await createWorker().fetch(
          req("/v1/auth/revoke", {}, deviceToken),
          restarted,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await createWorker().fetch(
          req("/v1/providers", undefined, deviceToken),
          e,
        )
      ).status,
    ).toBe(401);
    expect(
      (await createWorker().fetch(req("/v1/auth/revoke", {}), e)).status,
    ).toBe(401);
    expect((await createWorker().fetch(req("/v1/providers"), e)).status).toBe(
      200,
    );
  });
  it("rejects unknown, malformed, expired and owner-rotated device credentials", async () => {
    const e = env();
    expect(
      (
        await createWorker().fetch(
          req("/v1/providers", undefined, "even_device_" + "0".repeat(64)),
          e,
        )
      ).status,
    ).toBe(401);
    const { deviceToken } = await (
      await createWorker().fetch(req("/v1/auth/pair", {}), e)
    ).json();
    expect(
      (
        await createWorker().fetch(
          req("/v1/providers", undefined, deviceToken + "garbage"),
          e,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await createWorker().fetch(
          req("/v1/providers", undefined, deviceToken),
          { ...e, ACCESS_TOKEN: "rotated-synthetic-owner-token-12345" },
        )
      ).status,
    ).toBe(401);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 366 * 86400000);
      expect(
        (
          await createWorker().fetch(
            req("/v1/providers", undefined, deviceToken),
            e,
          )
        ).status,
      ).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });
  it("bounds concurrent pairing and does not charge provider quota", async () => {
    const storage = new Memory(),
      e = { ...env(), QUOTA: namespace(new QuotaLedger({ storage })) };
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        createWorker().fetch(req("/v1/auth/pair", {}), e),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(8);
    expect(results.filter((r) => r.status === 429)).toHaveLength(2);
    expect([...storage.data.keys()]).toEqual(["auth:devices"]);
  });
  it("fails closed on device storage outage and rejects unexpected pairing fields", async () => {
    const storage = new Memory(),
      e = { ...env(), QUOTA: namespace(new QuotaLedger({ storage })) };
    expect(
      (
        await createWorker().fetch(
          req("/v1/auth/pair", { expiresAt: "forever" }),
          e,
        )
      ).status,
    ).toBe(400);
    storage.transaction = async () => {
      throw new Error("secret internal detail");
    };
    const r = await createWorker().fetch(req("/v1/auth/pair", {}), e);
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("secret internal detail");
  });
});
