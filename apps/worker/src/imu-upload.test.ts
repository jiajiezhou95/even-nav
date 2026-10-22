import { expect, it, vi } from "vitest";
import { createWorker, type Env } from "./index";
import { imuUploadSchema } from "./imu-upload";
import { secretHash } from "./auth";
import { QuotaLedger, type Store, type QuotaNamespace } from "./quota";

class Memory implements Store {
  data = new Map<string, unknown>();
  async get<T>(key: string) {
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThan(
      128 * 1024,
    );
    this.data.set(key, structuredClone(value));
  }
  async transaction<T>(f: (store: Store) => Promise<T>): Promise<T> {
    return f(this);
  }
}
const token = "synthetic-imu-owner-not-a-secret";
const path = "/v1/diagnostics/imu";
const sample = { receivedAt: 0, phase: "still", x: 1, y: 2, z: 3 };
const upload = { schemaVersion: 1, samples: [sample] };
function setup() {
  const store = new Memory();
  const calls: string[] = [];
  const ns: QuotaNamespace = {
    idFromName: (name) => name,
    get: () => ({
      fetch: (input, init) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        calls.push(new URL(request.url).pathname);
        return new QuotaLedger({ storage: store }).fetch(request);
      },
    }),
  };
  const provider = vi
    .fn()
    .mockRejectedValue(new Error("Unexpected provider call"));
  const worker = createWorker(provider);
  const env: Env = {
    ACCESS_TOKEN: token,
    QUOTA: ns,
    ALLOWED_ORIGINS: "https://app.example",
  };
  const request = (body?: unknown, auth = token, endpoint = path) =>
    worker.fetch(
      new Request(`https://worker.test${endpoint}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${auth}`,
          "Content-Type": "application/json",
          Origin: "https://app.example",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  return { store, calls, provider, worker, env, request };
}

it("persists a device upload across ledger recreation; only owner reads, without quota or providers", async () => {
  const s = setup();
  expect((await s.request()).status).toBe(404);
  expect((await s.request(upload, "invalid")).status).toBe(401);
  const paired = await (await s.request({}, token, "/v1/auth/pair")).json();
  const posted = await s.request(upload, paired.deviceToken);
  expect(posted.status).toBe(200);
  expect(posted.headers.get("Cache-Control")).toBe("no-store");
  expect(posted.headers.get("Access-Control-Allow-Origin")).toBe(
    "https://app.example",
  );
  const receipt = await posted.json();
  expect(Object.keys(receipt).sort()).toEqual([
    "id",
    "receivedAt",
    "sampleCount",
  ]);
  expect(receipt.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(Number.isFinite(Date.parse(receipt.receivedAt))).toBe(true);
  expect(receipt.sampleCount).toBe(1);
  expect((await s.request(undefined, paired.deviceToken)).status).toBe(401);
  expect(await (await s.request()).json()).toEqual({ ...receipt, ...upload });
  s.env.ACCESS_TOKEN = "synthetic-other-owner-not-a-secret";
  expect((await s.request(undefined, s.env.ACCESS_TOKEN)).status).toBe(404);
  expect(s.provider).not.toHaveBeenCalled();
  expect(s.calls).not.toContain("/reserve");
  expect([...s.store.data.keys()].some((k) => k.startsWith("usage:"))).toBe(
    false,
  );
});

it("validates strict private-data-free shape, finite bounded axes/time, order and sample count", async () => {
  const s = setup();
  const invalid = [
    { ...upload, gps: { lat: 1, lon: 2 } },
    { ...upload, samples: [{ ...sample, token: "private" }] },
    { ...upload, schemaVersion: 2 },
    { ...upload, label: "private free text" },
    { ...upload, label: null },
    { ...upload, label: { phase: "still" } },
    { ...upload, samples: [] },
    { ...upload, samples: Array.from({ length: 6001 }, () => sample) },
    ...[
      { x: null },
      { x: "1" },
      { x: 1_000_001 },
      { y: -1_000_001 },
      { receivedAt: -1 },
      { receivedAt: 61_001 },
      { phase: "gps" },
    ].map((delta) => ({ ...upload, samples: [{ ...sample, ...delta }] })),
    { ...upload, samples: [{ ...sample, receivedAt: 5 }, sample] },
  ];
  for (const body of invalid) expect((await s.request(body)).status).toBe(400);
  expect(
    imuUploadSchema.safeParse({
      ...upload,
      samples: [{ ...sample, x: Infinity }],
    }).success,
  ).toBe(false);
  expect(
    imuUploadSchema.safeParse({ ...upload, samples: [{ ...sample, x: NaN }] })
      .success,
  ).toBe(false);
  expect(s.store.data.size).toBe(0);
  expect(s.provider).not.toHaveBeenCalled();
});

it("supports 6000 samples and keeps both uploads readable by ID", async () => {
  const s = setup();
  const body = {
    schemaVersion: 1,
    samples: Array.from({ length: 6000 }, (_, i) => ({
      ...sample,
      receivedAt: i * 10,
      x: -123456.78901234567,
    })),
  };
  expect((await s.request(body)).status).toBe(200);
  expect(await (await s.request()).json()).toMatchObject(body);
  expect(s.store.data.size).toBe(26);
  const old = await (await s.request()).json();
  await s.request({ ...upload, label: "left" });
  const latest = await (await s.request()).json();
  expect(latest.id).not.toBe(old.id);
  expect(latest.samples).toEqual([sample]);
  expect(latest.label).toBe("left");
  expect(latest.samples[0].phase).toBe("still");
  expect(s.store.data.size).toBe(50);
  expect(s.store.data.get("imu:slot:1:23")).toEqual([]);
  expect(
    await (await s.request(undefined, token, `${path}/${old.id}`)).json(),
  ).toEqual(old);
  expect(
    await (await s.request(undefined, token, `${path}/${latest.id}`)).json(),
  ).toEqual(latest);
  const listed = await (
    await s.request(undefined, token, `${path}/list`)
  ).json();
  expect(listed.reports.map((r: { id: string }) => r.id)).toEqual([
    latest.id,
    old.id,
  ]);
  expect(listed.reports[0].label).toBe("left");
  expect(listed.reports[0].samples).toBeUndefined();
});

it("migrates the existing latest record without changing its ID or samples", async () => {
  const s = setup();
  const legacy = {
    id: crypto.randomUUID(),
    receivedAt: "2026-10-20T00:00:00.000Z",
    sampleCount: 1,
    ownerHash: await secretHash(token),
  };
  await s.store.put("imu:latest", legacy);
  for (let i = 0; i < 24; i++)
    await s.store.put(`imu:latest:${i}`, i === 0 ? [sample] : []);
  const before = await (await s.request()).json();
  expect(
    (await (await s.request(undefined, token, `${path}/list`)).json())
      .reports[0].id,
  ).toBe(legacy.id);
  await s.request({ ...upload, label: "nod" });
  expect(
    await (await s.request(undefined, token, `${path}/${legacy.id}`)).json(),
  ).toEqual(before);
  expect(
    (await (await s.request(undefined, token, `${path}/list`)).json()).reports,
  ).toHaveLength(2);
});

it("retains exactly 20 reports, overwrites oldest chunks and does not grow storage", async () => {
  const s = setup();
  const first = await (
    await s.request({
      schemaVersion: 1,
      samples: Array.from({ length: 6000 }, () => sample),
    })
  ).json();
  const ids = [first.id];
  for (let i = 0; i < 21; i++)
    ids.push((await (await s.request(upload)).json()).id);
  const listed = await (
    await s.request(undefined, token, `${path}/list`)
  ).json();
  expect(listed.reports.map((r: { id: string }) => r.id)).toEqual(
    ids.slice(-20).reverse(),
  );
  expect(s.store.data.size).toBe(482);
  expect(s.store.data.get("imu:latest:23")).toEqual([]);
  expect(
    (await s.request(undefined, token, `${path}/${first.id}`)).status,
  ).toBe(404);
  expect((await s.request(undefined, token, `${path}/${ids[2]}`)).status).toBe(
    200,
  );
});

it("denies device reads, scopes history to owner and rejects malformed IDs", async () => {
  const s = setup();
  const receipt = await (await s.request(upload)).json();
  const paired = await (await s.request({}, token, "/v1/auth/pair")).json();
  for (const endpoint of [`${path}/list`, `${path}/${receipt.id}`]) {
    expect(
      (await s.request(undefined, paired.deviceToken, endpoint)).status,
    ).toBe(401);
    expect((await s.request(undefined, "invalid", endpoint)).status).toBe(401);
  }
  for (const suffix of ["not-an-id", "list/extra", `${receipt.id}/extra`])
    expect(
      (await s.request(undefined, token, `${path}/${suffix}`)).status,
    ).toBe(400);
  const other = "synthetic-other-owner-not-a-secret";
  s.env.ACCESS_TOKEN = other;
  expect(
    (await s.request(undefined, other, `${path}/${receipt.id}`)).status,
  ).toBe(404);
  expect(
    await (await s.request(undefined, other, `${path}/list`)).json(),
  ).toEqual({ reports: [] });
  const next = await (await s.request(upload, other)).json();
  expect(
    (
      await (await s.request(undefined, other, `${path}/list`)).json()
    ).reports.map((r: { id: string }) => r.id),
  ).toEqual([next.id]);
  s.env.ACCESS_TOKEN = token;
  expect((await s.request(undefined, token, `${path}/${next.id}`)).status).toBe(
    404,
  );
  expect(
    (
      await (await s.request(undefined, token, `${path}/list`)).json()
    ).reports.map((r: { id: string }) => r.id),
  ).toEqual([receipt.id]);
});

it("enforces streaming 1 MiB upload limit while preserving existing 16 KiB endpoint limits", async () => {
  const s = setup();
  const raw = async (endpoint: string, text: string, length?: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (length) headers["Content-Length"] = length;
    return s.worker.fetch(
      new Request(`https://worker.test${endpoint}`, {
        method: "POST",
        headers,
        body: text,
      }),
      s.env,
    );
  };
  const padded = JSON.stringify(upload) + " ".repeat(20_000);
  expect((await raw(path, padded)).status).toBe(200);
  expect((await raw("/v1/auth/pair", "{}" + " ".repeat(20_000))).status).toBe(
    400,
  );
  expect(
    (await raw(path, JSON.stringify(upload) + " ".repeat(1024 * 1024))).status,
  ).toBe(400);
  expect(
    (await raw(path, JSON.stringify(upload), String(1024 * 1024 + 1))).status,
  ).toBe(400);
  expect((await raw(path, "{")).status).toBe(400);
});

it("fails closed when diagnostic storage is missing or unavailable", async () => {
  const s = setup();
  s.env.QUOTA = undefined;
  expect((await s.request(upload)).status).toBe(503);
  s.env.QUOTA = {
    idFromName: () => 1,
    get: () => ({
      fetch: async () => {
        throw new Error("offline");
      },
    }),
  };
  expect((await s.request(upload)).status).toBe(502);
  expect((await s.request()).status).toBe(502);
});

it("retrieval script downloads only missing reports, preserves archives and prints metadata only", async () => {
  const existing = {
    ...upload,
    id: crypto.randomUUID(),
    receivedAt: "2026-10-20T00:00:00.000Z",
    sampleCount: 1,
  };
  const newest = { ...existing, id: crypto.randomUUID(), label: "left" };
  const existingPath = `.local/imu/reports/${existing.id}.json`;
  const files = new Map([
    [
      ".local/config.json",
      JSON.stringify({
        workerOrigin: "https://worker.test",
        accessToken: token,
      }),
    ],
    [existingPath, JSON.stringify(existing)],
  ]);
  const write = vi.fn((name: string, value: string) => {
    files.set(name, value);
  });
  vi.doMock("node:fs", () => ({
    existsSync: (name: string) => files.has(name),
    mkdirSync: vi.fn(),
    readFileSync: (name: string) => {
      if (!files.has(name)) throw new Error("Unexpected file read");
      return files.get(name);
    },
    writeFileSync: write,
  }));
  const fetcher = vi.fn(async (url: URL) => {
    if (url.pathname.endsWith("/list")) {
      return Response.json({
        reports: [newest, existing].map(
          ({ samples: _samples, schemaVersion: _schema, ...metadata }) =>
            metadata,
        ),
      });
    }
    expect(url.pathname).toBe(`${path}/${newest.id}`);
    return Response.json(newest);
  });
  vi.stubGlobal("fetch", fetcher);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await import("../../../scripts/receive-imu");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(files.get(existingPath)).toBe(JSON.stringify(existing));
    expect(write.mock.calls.some(([name]) => name === existingPath)).toBe(
      false,
    );
    expect(JSON.parse(files.get(".local/imu/latest.json")!)).toEqual(newest);
    expect(
      JSON.parse(files.get(`.local/imu/reports/${newest.id}.json`)!),
    ).toEqual(newest);
    const printed = log.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(printed).not.toContain('"samples"');
    expect(printed).not.toContain(token);
  } finally {
    vi.doUnmock("node:fs");
    vi.unstubAllGlobals();
    log.mockRestore();
  }
});
