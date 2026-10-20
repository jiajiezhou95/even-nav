import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import {
  createCredentialStore,
  DEVICE_CREDENTIAL_KEY,
  decodeCredential,
  DeviceCredentials,
  type CredentialStore,
} from "./credentials";
import { WorkerClient } from "./client";
import { getEvenBridge, isEvenHost } from "./runtime";

vi.mock("./runtime", () => ({
  getEvenBridge: vi.fn(),
  isEvenHost: vi.fn(() => true),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const token = "synthetic-issued-device-token-123456";
const origin = "https://worker.test";
const valid = () => ({
  version: 1,
  origin,
  deviceToken: token,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
});

describe("persistent per-device credentials", () => {
  it("production storage waits for native bridge even before the host is injected", async () => {
    vi.stubEnv("DEV", false);
    vi.mocked(isEvenHost).mockReturnValue(false);
    const bridge = { getLocalStorage: vi.fn(async () => "") };
    vi.mocked(getEvenBridge).mockResolvedValue(
      bridge as unknown as EvenAppBridge,
    );
    const store = createCredentialStore();
    expect(store.kind).toBe("EVEN_APP");
    expect(await store.read()).toBe("");
    expect(getEvenBridge).toHaveBeenCalledOnce();
  });
  it("uses official native app storage and verifies save and removal without browser fallback", async () => {
    let value = "";
    const bridge = {
      getLocalStorage: vi.fn(async () => value),
      setLocalStorage: vi.fn(async (_key: string, next: string) => {
        value = next;
        return true;
      }),
    };
    vi.mocked(isEvenHost).mockReturnValue(true);
    vi.mocked(getEvenBridge).mockResolvedValue(
      bridge as unknown as EvenAppBridge,
    );
    const store = createCredentialStore();
    await store.write(JSON.stringify(valid()));
    expect(JSON.parse(await store.read()).deviceToken).toBe(token);
    await store.write("");
    expect(await store.read()).toBe("");
    expect(bridge.setLocalStorage).toHaveBeenLastCalledWith(
      DEVICE_CREDENTIAL_KEY,
      "",
    );
    vi.mocked(bridge.setLocalStorage).mockResolvedValue(false);
    await expect(store.write("new")).rejects.toThrow("storage unavailable");
  });
  it("validates expiry, origin and device shape before any restored request", () => {
    expect(decodeCredential(JSON.stringify(valid()), origin)?.deviceToken).toBe(
      token,
    );
    expect(
      decodeCredential(
        JSON.stringify({ ...valid(), expiresAt: "2000-01-01T00:00:00Z" }),
        origin,
      ),
    ).toBeUndefined();
    expect(
      decodeCredential(JSON.stringify(valid()), "https://changed.test"),
    ).toBeUndefined();
    expect(
      decodeCredential(
        JSON.stringify({ ...valid(), deviceToken: "bad token" }),
        origin,
      ),
    ).toBeUndefined();
  });
  it("never saves the owner credential and preserves issued device credential through a temporary outage", async () => {
    vi.stubEnv("VITE_WORKER_ORIGIN", origin);
    let stored = "";
    const store: CredentialStore = {
      kind: "EVEN_APP",
      read: async () => stored,
      write: async (value) => {
        stored = value;
      },
    };
    const calls: { path: string; authorization: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        const path = new URL(url).pathname;
        calls.push({
          path,
          authorization: (options.headers as Record<string, string>)
            .Authorization,
        });
        if (path === "/v1/auth/pair")
          return Response.json({
            deviceToken: token,
            expiresAt: valid().expiresAt,
          });
        return new Response(null, { status: 503 });
      }),
    );
    const manager = new DeviceCredentials(new WorkerClient(), store);
    expect(await manager.pair("synthetic-owner-not-for-storage")).toMatchObject(
      { saved: true, verified: false },
    );
    expect(stored).not.toContain("synthetic-owner-not-for-storage");
    expect(JSON.parse(stored).deviceToken).toBe(token);
    expect(calls).toEqual([
      {
        path: "/v1/auth/pair",
        authorization: "Bearer synthetic-owner-not-for-storage",
      },
      { path: "/v1/providers", authorization: `Bearer ${token}` },
    ]);
    expect(
      await new DeviceCredentials(new WorkerClient(), store).restore(),
    ).toBe("OFFLINE");
    expect(JSON.parse(stored).deviceToken).toBe(token);
  });
  it("rejects a pairing endpoint that echoes the owner token without persisting it", async () => {
    vi.stubEnv("VITE_WORKER_ORIGIN", origin);
    const write = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ deviceToken: token, expiresAt: valid().expiresAt }),
      ),
    );
    const manager = new DeviceCredentials(new WorkerClient(), {
      kind: "EVEN_APP",
      read: async () => "",
      write,
    });
    await expect(manager.pair(token)).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });
    expect(write).not.toHaveBeenCalled();
  });
});
