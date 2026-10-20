import { describe, it, expect, vi } from "vitest";
import { EvenDevice, LatestFrameQueue, nativeFix } from "./device";
import { project, unproject } from "./map";
import { staleInstruction } from "./freshness";

describe("official SDK boundary and display queue", () => {
  it("coalesces concurrent native starts and awaits pending start before stopping", async () => {
    let release!: (value: boolean) => void;
    const unsubscribe = vi.fn();
    const bridge = {
      onAppLocationChanged: vi.fn(() => unsubscribe),
      startAppLocationUpdates: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            release = resolve;
          }),
      ),
      stopAppLocationUpdates: vi.fn(async () => true),
    };
    const device = new EvenDevice(
      () => {},
      () => {},
      () => {},
    );
    Object.assign(device, { bridge, source: "EVEN" });
    const first = device.startLocation(),
      second = device.startLocation();
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.startAppLocationUpdates).toHaveBeenCalledTimes(1);
    const stop = device.stopLocation();
    release(true);
    await Promise.all([first, second, stop]);
    expect(bridge.onAppLocationChanged).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(bridge.stopAppLocationUpdates).toHaveBeenCalledTimes(1);
  });
  it("serializes sends and replaces all intermediate pending frames", async () => {
    const submitted: number[] = [];
    const releases: (() => void)[] = [];
    const queue = new LatestFrameQueue<number>(
      (value) => {
        submitted.push(value);
        return new Promise((resolve) => releases.push(resolve));
      },
      () => {},
    );
    queue.push(1);
    queue.push(2);
    queue.push(3);
    expect(submitted).toEqual([1]);
    expect(queue.inFlight).toBe(true);
    releases.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(submitted).toEqual([1, 3]);
    releases.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.inFlight).toBe(false);
  });
  it("discards a previous trip pending frame and reports failure without retry", async () => {
    let reject!: (error: Error) => void;
    const submitted: number[] = [],
      errors: unknown[] = [];
    const queue = new LatestFrameQueue<number>(
      (value) => {
        submitted.push(value);
        return new Promise((_, fail) => {
          reject = fail;
        });
      },
      (error) => errors.push(error),
    );
    queue.push(1);
    queue.push(2);
    queue.invalidate();
    reject(new Error("old trip"));
    await Promise.resolve();
    await Promise.resolve();
    expect(submitted).toEqual([1]);
    expect(errors).toEqual([]);
    queue.push(3);
    reject(new Error("send failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(submitted).toEqual([1, 3]);
    expect(errors).toHaveLength(1);
    expect(queue.inFlight).toBe(false);
  });
  it("never invents a fix timestamp or accepts seconds as milliseconds", () => {
    const now = Date.now();
    expect(nativeFix({ latitude: 35, longitude: 139 }, now)).toBeUndefined();
    expect(
      nativeFix({ latitude: 35, longitude: 139, timestamp: now / 1000 }, now),
    ).toBeUndefined();
    expect(
      nativeFix({ latitude: 91, longitude: 139, timestamp: now }, now),
    ).toBeUndefined();
    expect(
      nativeFix({ latitude: 35, longitude: 139, timestamp: now + 10000 }, now),
    ).toBeUndefined();
    expect(
      nativeFix(
        { latitude: 35, longitude: 139, timestamp: now, accuracy: 6 },
        now,
      ),
    ).toEqual({
      coordinate: { lat: 35, lng: 139 },
      timestamp: now,
      accuracyMeters: 6,
      speedMps: undefined,
      heading: undefined,
    });
  });
  it("projects map, route and fix using the same mercator coordinates", () => {
    expect(project({ lat: 0, lng: 0 }, 0)).toEqual({ x: 128, y: 128 });
    const point = { lat: 35.6812, lng: 139.7671 };
    const p = project(point, 16),
      restored = unproject(p.x, p.y, 16);
    expect(restored.lat).toBeCloseTo(point.lat, 8);
    expect(restored.lng).toBeCloseTo(point.lng, 8);
    expect(project({ ...point, lng: point.lng + 0.001 }, 16).x).toBeGreaterThan(
      p.x,
    );
  });
  it("stops precise turn instructions at mode-specific GPS age limits", () => {
    expect(staleInstruction(10000, "DRIVE", 13000)).toBeUndefined();
    expect(staleInstruction(10000, "DRIVE", 13001)).toContain("暂停转向指示");
    expect(staleInstruction(10000, "WALK", 15000)).toBeUndefined();
    expect(staleInstruction(10000, "WALK", 15001)).toContain("定位已过期");
    expect(staleInstruction(undefined, "DRIVE", 10000)).toContain("定位已过期");
  });
});
