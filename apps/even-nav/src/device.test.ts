import { describe, it, expect, vi } from "vitest";
import { EvenDevice, LatestFrameQueue, nativeFix } from "./device";
import { project, unproject } from "./map";
import { staleInstruction } from "./freshness";

describe("official SDK boundary and display queue", () => {
  it("fully replaces each current-step text and submits new map bytes in order", async () => {
    const sent: {
      containerID: number;
      content: string;
      contentOffset: number;
      contentLength: number;
    }[] = [];
    const images: number[][] = [];
    const bridge = {
      createStartUpPageContainer: vi.fn(async (_value: unknown) => 0),
      textContainerUpgrade: vi.fn(async (value) => {
        sent.push(value);
        return true;
      }),
      updateImageRawData: vi.fn(async (value) => {
        images.push(value.imageData);
        return "success";
      }),
    };
    const device = new EvenDevice(
      () => {},
      () => {},
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    device.setVersion(1);
    const frame = (
      sequence: number,
      instruction: string,
      iconKey = "left",
    ) => ({
      sequence,
      version: 1,
      instruction,
      pixels: new Uint8Array([sequence]),
      status: "测试定位",
      attribution: "Synthetic map",
      icon: {
        key: iconKey,
        pixels: new Uint8Array([iconKey === "left" ? 9 : 8]),
      },
    });
    device.queue.push(frame(1, "沿架空道路继续前行至下一个路口"));
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(1));
    device.queue.push(frame(2, "向左转"));
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(2));
    device.queue.push(frame(3, "向右转", "right"));
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(3));
    expect(
      sent
        .filter((value) => value.containerID === 2)
        .map((value) => value.content),
    ).toEqual(["沿架空道路继续前行至下一个路口", "向左转", "向右转"]);
    expect(
      sent.every(
        (value) => value.contentOffset === 0 && value.contentLength === 0,
      ),
    ).toBe(true);
    expect(images).toEqual([[9], [1], [2], [8], [3]]);
    expect(bridge.createStartUpPageContainer.mock.calls[0][0]).toMatchObject({
      containerTotalNum: 5,
      imageObject: expect.arrayContaining([
        expect.objectContaining({
          containerID: 5,
          xPosition: 300,
          yPosition: 0,
          width: 48,
          height: 48,
        }),
      ]),
      textObject: expect.arrayContaining([
        expect.objectContaining({ containerID: 2, xPosition: 360, width: 216 }),
        expect.objectContaining({
          containerID: 3,
          xPosition: 300,
          yPosition: 150,
          width: 276,
          height: 54,
        }),
        expect.objectContaining({ containerID: 4, yPosition: 208 }),
      ]),
    });
  });
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
    expect(bridge.startAppLocationUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ intervalMs: 1000, distanceFilter: 0 }),
    );
    const stop = device.stopLocation();
    const secondStop = device.stopLocation();
    release(true);
    await Promise.all([first, second, stop, secondStop]);
    expect(bridge.onAppLocationChanged).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(bridge.stopAppLocationUpdates).toHaveBeenCalledTimes(1);
  });
  it("forwards stationary native fixes with their actual measurement timestamps", async () => {
    const receive = vi.fn();
    let callback!: (location: {
      latitude: number;
      longitude: number;
      timestamp: number;
    }) => void;
    const bridge = {
      onAppLocationChanged: vi.fn((listener) => {
        callback = listener;
        return () => {};
      }),
      startAppLocationUpdates: vi.fn(async () => true),
      stopAppLocationUpdates: vi.fn(async () => true),
    };
    const device = new EvenDevice(
      receive,
      () => {},
      () => {},
    );
    Object.assign(device, { bridge, source: "EVEN" });
    await device.startLocation();
    const now = Date.now();
    callback({ latitude: 35, longitude: 139, timestamp: now - 1000 });
    callback({ latitude: 35, longitude: 139, timestamp: now });
    expect(receive.mock.calls.map(([fix]) => fix.timestamp)).toEqual([
      now - 1000,
      now,
    ]);
    await device.stopLocation();
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
