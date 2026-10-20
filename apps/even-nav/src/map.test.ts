import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerClient } from "./client";
import { NavigationMap, project } from "./map";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const contexts: Record<string, ReturnType<typeof vi.fn>>[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const ctx: Record<string, ReturnType<typeof vi.fn>> = {};
      const context = new Proxy(ctx, {
        get(target, property: string) {
          return target[property] ?? (target[property] = vi.fn());
        },
        set(target, property: string, value) {
          target[property] = value;
          return true;
        },
      });
      contexts.push(ctx);
      return {
        width: 0,
        height: 0,
        setAttribute: vi.fn(),
        getContext: () => context,
      };
    },
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ close: vi.fn() })),
  );
  const request = vi.fn(async (url: string, body?: { display?: string }) =>
    url.endsWith("/session")
      ? {
          session: "synthetic-session",
          expiry: 9999999999,
          tileWidth: body?.display === "G2" ? 512 : 256,
          tileHeight: body?.display === "G2" ? 512 : 256,
        }
      : { copyright: "Synthetic © Test" },
  );
  const fetch = vi.fn(async () => ({
    blob: async () => new Blob(["synthetic"]),
  }));
  const map = new NavigationMap({ request, fetch } as unknown as WorkerClient);
  return { map, request, fetch, contexts };
}

describe("magnified high-DPI navigation viewport", () => {
  it("bounds gesture zoom, changes only map zoom, and resets on disposal", async () => {
    const { map, request } = setup();
    map.setSize(576, 192);
    expect(map.adjustZoom(1)).toBe(true);
    expect(map.adjustZoom(1)).toBe(true);
    expect(map.adjustZoom(1)).toBe(false);
    await map.draw({ lat: 35, lng: 139 });
    expect(request.mock.calls.some(([url]) => url.includes("zoom=18"))).toBe(
      true,
    );
    for (let i = 0; i < 4; i++) expect(map.adjustZoom(-1)).toBe(true);
    expect(map.adjustZoom(-1)).toBe(false);
    await map.draw({ lat: 35, lng: 139 });
    expect(request.mock.calls.some(([url]) => url.includes("zoom=14"))).toBe(
      true,
    );
    map.dispose();
    await map.draw({ lat: 35, lng: 139 });
    expect(request.mock.calls.some(([url]) => url.includes("zoom=16"))).toBe(
      true,
    );
    expect(
      request.mock.calls.every(([url]) => url.includes("/maps/google/")),
    ).toBe(true);
  });
  it("renders a 576 × 192 HUD from 512px tiles without widening the old geographic span", async () => {
    const { map, request, fetch, contexts } = setup();
    const center = { lat: 35, lng: 139 };
    map.setSize(576, 192);
    await map.draw(center, undefined, undefined, center);
    expect([map.canvas.width, map.canvas.height]).toEqual([576, 192]);
    expect(request).toHaveBeenCalledWith(
      "/v1/maps/google/session",
      { display: "G2" },
      expect.any(AbortSignal),
    );
    const url = request.mock.calls.find(([url]) =>
      url.includes("/viewport?"),
    )![0];
    const params = new URL(`https://synthetic.test${url}`).searchParams;
    const northwest = project(
      { lat: Number(params.get("north")), lng: Number(params.get("west")) },
      16,
    );
    const southeast = project(
      { lat: Number(params.get("south")), lng: Number(params.get("east")) },
      16,
    );
    expect(southeast.x - northwest.x).toBeCloseTo(288);
    expect(southeast.y - northwest.y).toBeCloseTo(96);
    const tileColumns =
      Math.floor(southeast.x / 256) - Math.floor(northwest.x / 256) + 1;
    const tileRows =
      Math.floor(southeast.y / 256) - Math.floor(northwest.y / 256) + 1;
    expect(fetch).toHaveBeenCalledTimes(tileColumns * tileRows);
    const tileDraws = contexts
      .flatMap((ctx) => ctx.drawImage?.mock.calls || [])
      .filter((call) => call.length === 5);
    expect(tileDraws.every((call) => call[3] === 512 && call[4] === 512)).toBe(
      true,
    );
    const markerCalls = contexts.flatMap((ctx) => ctx.arc?.mock.calls || []);
    expect(markerCalls.some((call) => call[0] === 288 && call[1] === 96)).toBe(
      true,
    );
  });
  it("invalidates viewport pixels on resize, switches high-DPI session and reuses unchanged dimensions", async () => {
    const { map, request, fetch } = setup();
    const center = { lat: 35, lng: 139 };
    await map.draw(center);
    map.setSize(576, 192);
    expect(map.ready).toBe(false);
    await map.draw(center);
    const tileCalls = fetch.mock.calls.length;
    map.setSize(576, 192);
    expect(map.ready).toBe(true);
    await map.draw(center);
    expect(fetch).toHaveBeenCalledTimes(tileCalls);
    expect(
      request.mock.calls.filter(([url]) => url.endsWith("/session")),
    ).toHaveLength(2);
    expect(
      request.mock.calls.filter(([url]) => url.includes("/viewport?")),
    ).toHaveLength(2);
    expect(() => map.setSize(576, 288)).toThrow("Unsupported");
  });
});
