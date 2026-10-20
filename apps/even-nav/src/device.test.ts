import { describe, it, expect, vi } from "vitest";
import { EvenDevice, LatestFrameQueue, nativeFix } from "./device";
import { project, unproject } from "./map";
import { staleInstruction } from "./freshness";
import { getEvenBridge } from "./runtime";
import {
  CreateStartUpPageContainer,
  validateEvenHubPageContainer,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { renderHud } from "./hud-renderer";

vi.mock("./runtime", () => ({
  isEvenHost: () => true,
  getEvenBridge: vi.fn(),
}));

vi.mock("./hud-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hud-renderer")>();
  return {
    ...actual,
    renderHud: vi.fn(async (frame) => [
      new TextEncoder().encode(`${frame.pixels[0]}/${frame.instruction}`),
      new TextEncoder().encode(
        `${frame.pixels[0]}/${frame.guidance?.next || ""}`,
      ),
      new TextEncoder().encode(`${frame.pixels[0]}/${frame.attribution}`),
      new TextEncoder().encode(`${frame.pixels[0]}/${frame.status}`),
    ]),
  };
});

describe("official SDK boundary and display queue", () => {
  it("maps temple scrolls once per burst, ignores ring/IMU events, and preserves menu actions", async () => {
    let receive!: (event: EvenHubEvent) => void;
    const bridge = {
      getDeviceInfo: async () => ({
        model: "g2",
        status: { connectType: "connected" },
      }),
      onDeviceStatusChanged: () => () => {},
      onEvenHubEvent: (callback: typeof receive) => {
        receive = callback;
        return () => {};
      },
    };
    vi.mocked(getEvenBridge).mockResolvedValue(bridge as never);
    const action = vi.fn();
    const device = new EvenDevice(
      () => {},
      () => {},
      action,
    );
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      await device.connect();
      receive({ sysEvent: { eventType: 1, eventSource: 1 } } as EvenHubEvent);
      receive({ textEvent: { eventType: 1 } } as EvenHubEvent);
      now.mockReturnValue(1300);
      receive({ sysEvent: { eventType: 2, eventSource: 3 } } as EvenHubEvent);
      now.mockReturnValue(1600);
      receive({ sysEvent: { eventType: 1, eventSource: 2 } } as EvenHubEvent);
      receive({ sysEvent: { eventType: 8 } } as EvenHubEvent);
      receive({ listEvent: { eventType: 1 } } as EvenHubEvent);
      receive({ menuItemClickEvent: { itemID: 1 } } as EvenHubEvent);
      receive({ menuItemClickEvent: { itemID: 2 } } as EvenHubEvent);
      receive({ menuItemClickEvent: { itemID: 3 } } as EvenHubEvent);
      expect(action.mock.calls.map(([value]) => value)).toEqual([
        "ZOOM_IN",
        "ZOOM_OUT",
        "ZOOM_IN",
        "PAUSE",
        "RESUME",
        "END",
      ]);
    } finally {
      now.mockRestore();
    }
  });
  it("submits four bounded raster quadrants and preserves the native event/menu surface", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async (_value: unknown) => 0),
      updateImageRawData: vi.fn(
        async (_value: { containerID: number }) => "success",
      ),
    };
    const device = new EvenDevice(
      () => {},
      () => {},
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    device.setVersion(1);
    device.queue.push({
      sequence: 1,
      version: 1,
      instruction: "直行 120 米",
      pixels: new Uint8Array([1]),
      status: "● 更新定位中",
      attribution: "Synthetic map",
    });
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(1));
    expect(
      bridge.updateImageRawData.mock.calls.map(([v]) => v.containerID),
    ).toEqual([1, 2, 3, 4]);
    expect(bridge.createStartUpPageContainer.mock.calls[0][0]).toMatchObject({
      containerTotalNum: 5,
      imageObject: [
        {
          containerID: 1,
          xPosition: 0,
          yPosition: 0,
          width: 288,
          height: 144,
        },
        {
          containerID: 2,
          xPosition: 288,
          yPosition: 0,
          width: 288,
          height: 144,
        },
        {
          containerID: 3,
          xPosition: 0,
          yPosition: 144,
          width: 288,
          height: 144,
        },
        {
          containerID: 4,
          xPosition: 288,
          yPosition: 144,
          width: 288,
          height: 144,
        },
      ],
      textObject: [
        {
          containerID: 5,
          isEventCapture: 1,
          xPosition: 300,
          yPosition: 0,
          width: 20,
          height: 20,
        },
      ],
      menuObject: {
        menuItems: [
          { itemID: 1, itemName: "暂停" },
          { itemID: 2, itemName: "继续" },
          { itemID: 3, itemName: "结束" },
        ],
      },
    });
    const nativePayload = (
      bridge.createStartUpPageContainer.mock
        .calls[0][0] as CreateStartUpPageContainer
    ).toJson();
    expect(validateEvenHubPageContainer(nativePayload)).toEqual({
      valid: true,
    });
    for (const item of [
      ...nativePayload.imageObject,
      ...nativePayload.textObject,
    ]) {
      expect(Object.hasOwn(item, "zOrderIndex")).toBe(false);
    }
  });
  it("replaces changed cue or blinking status only, without reuploading unchanged quadrants", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 0),
      updateImageRawData: vi.fn(
        async (_value: { containerID: number }) => "success",
      ),
    };
    const device = new EvenDevice(
      () => {},
      () => {},
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    const frame = {
      sequence: 1,
      version: 0,
      pixels: new Uint8Array([1]),
      instruction: "直行 120 米",
      status: "● 更新定位中",
      attribution: "Synthetic",
    };
    device.queue.push(frame);
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(1));
    device.queue.push({ ...frame, sequence: 2, instruction: "直行 80 米" });
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(2));
    device.queue.push({
      ...frame,
      sequence: 3,
      instruction: "直行 80 米",
      status: "  更新定位中",
    });
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(3));
    expect(
      bridge.updateImageRawData.mock.calls.map(([v]) => v.containerID),
    ).toEqual([1, 2, 3, 4, 1, 4]);
  });
  it("stops at the first failed quadrant and never reports a partial frame as submitted", async () => {
    const failed = vi.fn();
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 0),
      updateImageRawData: vi.fn(async (v: { containerID: number }) =>
        v.containerID === 2 ? "imageSizeInvalid" : "success",
      ),
    };
    const device = new EvenDevice(
      () => {},
      failed,
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    device.queue.push({
      sequence: 1,
      version: 0,
      pixels: new Uint8Array([1]),
      instruction: "直行",
      status: "",
      attribution: "Synthetic",
    });
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(bridge.updateImageRawData).toHaveBeenCalledTimes(2);
    expect(device.lastSubmission).toBeUndefined();
    expect(device.queue.inFlight).toBe(false);
    expect(device.connected).toBe(true);
    expect(device.lastDisplayFailure).toMatchObject({
      stage: "IMAGE",
      code: "imageSizeInvalid",
      containerID: 2,
    });
    expect(failed).toHaveBeenCalledWith(
      expect.stringContaining("IMAGE:imageSizeInvalid，块 2/4"),
    );
  });
  it.each([
    [1, "invalid"],
    [2, "oversize"],
    [3, "outOfMemory"],
  ] as const)(
    "reports native startup rejection %i before rendering or image transmission",
    async (code, name) => {
      const health = vi.fn();
      const bridge = {
        createStartUpPageContainer: vi.fn(async () => code),
        updateImageRawData: vi.fn(),
      };
      const device = new EvenDevice(
        () => {},
        health,
        () => {},
      );
      Object.assign(device, { bridge, connected: true, source: "EVEN" });
      const renderCalls = vi.mocked(renderHud).mock.calls.length;
      device.queue.push({
        sequence: 1,
        version: 0,
        pixels: new Uint8Array([1]),
        instruction: "直行",
        status: "",
        attribution: "Synthetic",
      });
      await vi.waitFor(() => expect(health).toHaveBeenCalledOnce());
      expect(vi.mocked(renderHud).mock.calls.length).toBe(renderCalls);
      expect(bridge.updateImageRawData).not.toHaveBeenCalled();
      expect(device.lastDisplayFailure).toMatchObject({
        stage: "PAGE",
        code: `${name}(${code})`,
      });
      expect(device.connected).toBe(true);
      expect(health).toHaveBeenCalledWith(
        expect.stringContaining("设备仍已连接"),
      );
      expect(device.lastSubmission).toBeUndefined();
    },
  );
  it("separates canvas failures from connectivity and clears the error only after a complete recovery frame", async () => {
    const health = vi.fn();
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 0),
      updateImageRawData: vi.fn(async () => "success"),
    };
    const device = new EvenDevice(
      () => {},
      health,
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    vi.mocked(renderHud).mockRejectedValueOnce(
      new DOMException("private payload must not escape", "InvalidStateError"),
    );
    const frame = {
      sequence: 1,
      version: 0,
      pixels: new Uint8Array([1]),
      instruction: "直行",
      status: "",
      attribution: "Synthetic",
    };
    device.queue.push(frame);
    await vi.waitFor(() => expect(health).toHaveBeenCalledOnce());
    expect(device.lastDisplayFailure).toMatchObject({
      stage: "RENDER",
      code: "InvalidStateError",
    });
    expect(bridge.updateImageRawData).not.toHaveBeenCalled();
    expect(JSON.stringify(device.lastDisplayFailure)).not.toContain("private");
    expect(device.connected).toBe(true);
    device.queue.push({ ...frame, sequence: 2 });
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(2));
    expect(device.lastDisplayFailure).toBeUndefined();
    expect(health).toHaveBeenLastCalledWith("G2 已连接，导航画面已发送");
  });
  it("requires successful startup page before exposing IMU controls, without GPS", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 1),
      getAppLocation: vi.fn(),
      imuControl: vi.fn(),
      onEvenHubEvent: vi.fn(),
    };
    const device = new EvenDevice(
      () => {},
      () => {},
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    await expect(device.prepareImuProbe()).rejects.toThrow(
      "G2 PAGE invalid(1)",
    );
    expect(bridge.imuControl).not.toHaveBeenCalled();
    bridge.createStartUpPageContainer.mockResolvedValue(0);
    const [one, two] = await Promise.all([
      device.prepareImuProbe(),
      device.prepareImuProbe(),
    ]);
    expect(one).toBe(bridge);
    expect(two).toBe(bridge);
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(2);
    expect(bridge.getAppLocation).not.toHaveBeenCalled();
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
