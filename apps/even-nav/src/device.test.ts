import { describe, it, expect, vi } from "vitest";
import {
  EvenDevice,
  LatestFrameQueue,
  nativeFix,
  observePageCall,
  type PageCallTrace,
} from "./device";
import { project, unproject } from "./map";
import { staleInstruction } from "./freshness";
import { getEvenBridge } from "./runtime";
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  validateEvenHubPageContainer,
  type EvenHubEvent,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { renderHud, renderCompatibilityMap } from "./hud-renderer";

vi.mock("./runtime", () => ({
  isEvenHost: () => true,
  getEvenBridge: vi.fn(),
}));

vi.mock("./hud-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hud-renderer")>();
  return {
    ...actual,
    renderCompatibilityMap: vi.fn(
      async (pixels: Uint8Array) => new Uint8Array([42, ...pixels]),
    ),
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
  it("observes only safe page return shapes and forwards other methods and their receiver unchanged", async () => {
    const secret = "never record this private value";
    vi.stubGlobal("window", {
      flutter_inappwebview: { callHandler: () => {} },
      __EVEN_HUB_APP_ID__: secret,
    });
    try {
      for (const [value, shape] of [
        [undefined, "undefined"],
        [null, "null"],
        [false, "false"],
        [true, "true"],
        [0, "n0"],
        [1, "n1"],
        [3, "n3"],
        [4, "number"],
        [123456789, "number"],
        [NaN, "number"],
        [secret, "string"],
        [{ secret }, "object"],
      ] as const) {
        const traces: PageCallTrace[] = [];
        const payload = { secret };
        const receivers: unknown[] = [];
        const raw = vi.fn(async function (
          this: unknown,
          name: string,
          params?: unknown,
        ) {
          receivers.push(this);
          expect(params).toBe(payload);
          return name === "createStartUpPageContainer" ? value : payload;
        });
        const bridge = { callEvenApp: raw } as unknown as EvenAppBridge;
        const descriptor = Object.getOwnPropertyDescriptor(
          bridge,
          "callEvenApp",
        );
        const result = await observePageCall(bridge, "c", traces, async () => {
          expect(await bridge.callEvenApp("getDeviceInfo", payload)).toBe(
            payload,
          );
          return bridge.callEvenApp("createStartUpPageContainer", payload);
        });
        expect(result).toBe(value);
        expect(receivers).toEqual([bridge, bridge]);
        expect(Object.getOwnPropertyDescriptor(bridge, "callEvenApp")).toEqual(
          descriptor,
        );
        expect(traces).toEqual([
          {
            tag: "c",
            hooked: true,
            dispatched: true,
            raw: shape,
            handlerCallable: true,
            appIdPresent: true,
            appIdType: "string",
          },
        ]);
        expect(JSON.stringify(traces)).not.toContain(secret);
        expect(JSON.stringify(traces)).not.toContain("123456789");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("distinguishes SDK no-dispatch from missing handler and restores inherited methods after rejection", async () => {
    vi.stubGlobal("window", {});
    try {
      const original = vi.fn(async () => {
        throw new Error("private native error");
      });
      const bridge = Object.create({ callEvenApp: original }) as EvenAppBridge;
      const noDispatch: PageCallTrace[] = [];
      expect(
        await observePageCall(bridge, "c", noDispatch, async () => 1),
      ).toBe(1);
      expect(noDispatch[0]).toMatchObject({
        hooked: true,
        dispatched: false,
        handlerCallable: false,
        appIdPresent: false,
      });
      expect(Object.hasOwn(bridge, "callEvenApp")).toBe(false);
      const thrown: PageCallTrace[] = [];
      await expect(
        observePageCall(bridge, "r", thrown, () =>
          bridge.callEvenApp("rebuildPageContainer", {}),
        ),
      ).rejects.toThrow("private native error");
      expect(thrown[0]).toMatchObject({ dispatched: true, raw: "throw" });
      expect(JSON.stringify(thrown)).not.toContain("private");
      expect(Object.hasOwn(bridge, "callEvenApp")).toBe(false);
      expect(bridge.callEvenApp).toBe(original);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("does not block an SDK operation whose call method cannot be instrumented", async () => {
    const original = vi.fn(async () => 0);
    const bridge = {} as EvenAppBridge;
    Object.defineProperty(bridge, "callEvenApp", {
      value: original,
      writable: false,
      configurable: false,
    });
    const traces: PageCallTrace[] = [];
    expect(
      await observePageCall(bridge, "c", traces, () =>
        bridge.callEvenApp("createStartUpPageContainer"),
      ),
    ).toBe(0);
    expect(traces[0]).toMatchObject({
      hooked: false,
      dispatched: false,
      raw: "unobserved",
    });
    expect(bridge.callEvenApp).toBe(original);
  });
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
        rebuildPageContainer: vi.fn(async () => false),
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
        code:
          code === 1
            ? "create-invalid(1)/rebuild-invalid/compat-invalid"
            : `create-${name}(${code})`,
      });
      expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(
        code === 1 ? 2 : 0,
      );
      expect(device.connected).toBe(true);
      expect(health).toHaveBeenCalledWith(
        expect.stringContaining("设备仍已连接"),
      );
      expect(device.lastSubmission).toBeUndefined();
      // The next timer frame must not repeat rejected native creation/rebuild.
      device.queue.push({
        sequence: 2,
        version: 0,
        pixels: new Uint8Array([1]),
        instruction: "直行",
        status: "",
        attribution: "Synthetic",
      });
      await vi.waitFor(() => expect(health).toHaveBeenCalledTimes(2));
      expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(1);
      expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(
        code === 1 ? 2 : 0,
      );
    },
  );
  it("recovers an existing native page with exactly one identical rebuild before sending the frame", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(
        async (_page: CreateStartUpPageContainer) => 1,
      ),
      rebuildPageContainer: vi.fn(async (_page: RebuildPageContainer) => true),
      updateImageRawData: vi.fn(async () => "success"),
    };
    const health = vi.fn();
    const device = new EvenDevice(
      () => {},
      health,
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    const frame = {
      sequence: 1,
      version: 0,
      pixels: new Uint8Array([1]),
      instruction: "直行",
      status: "",
      attribution: "Synthetic",
    };
    device.queue.push(frame);
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(1));
    const created = bridge.createStartUpPageContainer.mock.calls[0][0].toJson();
    const rebuilt = bridge.rebuildPageContainer.mock.calls[0][0].toJson();
    expect(rebuilt).toEqual(created);
    expect(validateEvenHubPageContainer(rebuilt)).toEqual({ valid: true });
    expect(bridge.updateImageRawData).toHaveBeenCalledTimes(4);
    expect(health).not.toHaveBeenCalled();
    device.queue.push({ ...frame, sequence: 2 });
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(2));
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(1);
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
  });
  it("keeps create and rebuild exception stages distinct without leaking host messages", async () => {
    const health = vi.fn();
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 1),
      rebuildPageContainer: vi.fn(async () => {
        throw new Error("host timeout with private payload");
      }),
      updateImageRawData: vi.fn(),
    };
    const device = new EvenDevice(
      () => {},
      health,
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
    await vi.waitFor(() => expect(health).toHaveBeenCalledOnce());
    expect(device.lastDisplayFailure?.code).toBe(
      "create-invalid(1)/rebuild-timeout",
    );
    expect(JSON.stringify(device.lastDisplayFailure)).not.toContain("private");
    expect(bridge.updateImageRawData).not.toHaveBeenCalled();
    expect(bridge.rebuildPageContainer).toHaveBeenCalledOnce();
  });
  it("restores the exact proven native layout only after B is rejected, then deduplicates native updates", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 1),
      rebuildPageContainer: vi
        .fn(async (_page: RebuildPageContainer) => false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      textContainerUpgrade: vi.fn(
        async (_value: {
          containerID: number;
          content: string;
          contentOffset: number;
          contentLength: number;
        }) => true,
      ),
      updateImageRawData: vi.fn(
        async (_value: { containerID: number; imageData: number[] }) =>
          "success",
      ),
    };
    const health = vi.fn();
    const device = new EvenDevice(
      () => {},
      health,
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    const frame = {
      sequence: 1,
      version: 0,
      pixels: new Uint8Array([7]),
      instruction: "直行\n本段剩余 120 m\n\n下一步：向右转",
      status: "总剩余 860 m\n● 更新定位中",
      attribution: "Google Maps · 完整版权\nFull provider attribution",
      icon: { key: "straight", pixels: new Uint8Array([9]) },
    };
    device.queue.push(frame);
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(1));
    const legacy = bridge.rebuildPageContainer.mock.calls[1][0].toJson();
    expect(legacy).toEqual({
      containerTotalNum: 5,
      imageObject: [
        {
          containerID: 1,
          containerName: "map",
          xPosition: 0,
          yPosition: 0,
          width: 288,
          height: 144,
        },
        {
          containerID: 5,
          containerName: "maneuver",
          xPosition: 300,
          yPosition: 0,
          width: 48,
          height: 48,
        },
      ],
      textObject: [
        {
          containerID: 2,
          containerName: "instruction",
          xPosition: 360,
          yPosition: 0,
          width: 216,
          height: 144,
          content: "准备导航",
          isEventCapture: 1,
        },
        {
          containerID: 3,
          containerName: "status",
          xPosition: 300,
          yPosition: 150,
          width: 276,
          height: 54,
          content: "定位时间未知",
          isEventCapture: 0,
        },
        {
          containerID: 4,
          containerName: "attribution",
          xPosition: 0,
          yPosition: 208,
          width: 576,
          height: 80,
          content: " ",
          isEventCapture: 0,
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
    expect(validateEvenHubPageContainer(legacy)).toEqual({ valid: true });
    expect(
      bridge.textContainerUpgrade.mock.calls.map(([v]) => [
        v.containerID,
        v.content,
        v.contentOffset,
        v.contentLength,
      ]),
    ).toEqual([
      [2, frame.instruction, 0, 0],
      [3, frame.status, 0, 0],
      [4, frame.attribution, 0, 0],
    ]);
    expect(
      bridge.updateImageRawData.mock.calls.map(([v]) => [
        v.containerID,
        v.imageData,
      ]),
    ).toEqual([
      [5, [9]],
      [1, [42, 7]],
    ]);
    expect(health).toHaveBeenLastCalledWith("G2 已连接，兼容布局");
    device.queue.push({
      ...frame,
      sequence: 2,
      status: "总剩余 860 m\n  更新定位中",
    });
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(2));
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(2);
    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(4);
    expect(bridge.updateImageRawData).toHaveBeenCalledTimes(2);
  });
  it("does not send compatibility text or images when map conversion fails or the trip changes", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 1),
      rebuildPageContainer: vi
        .fn(async () => false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      textContainerUpgrade: vi.fn(async () => true),
      updateImageRawData: vi.fn(async () => "success"),
    };
    const health = vi.fn();
    const device = new EvenDevice(
      () => {},
      health,
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    const frame = {
      sequence: 1,
      version: 0,
      pixels: new Uint8Array([1]),
      instruction: "直行",
      status: "",
      attribution: "Synthetic",
    };
    vi.mocked(renderCompatibilityMap).mockRejectedValueOnce(
      new Error("invalid source"),
    );
    device.queue.push(frame);
    await vi.waitFor(() => expect(health).toHaveBeenCalledOnce());
    expect(device.lastDisplayFailure?.stage).toBe("RENDER");
    expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
    expect(bridge.updateImageRawData).not.toHaveBeenCalled();
    vi.mocked(renderCompatibilityMap).mockImplementationOnce(async () => {
      device.setVersion(1);
      return new Uint8Array([2]);
    });
    device.queue.push({ ...frame, sequence: 2 });
    await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
    expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
    expect(bridge.updateImageRawData).not.toHaveBeenCalled();
    expect(device.lastSubmission).toBeUndefined();
  });
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
      rebuildPageContainer: vi.fn(async () => false),
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
      "G2 PAGE create-invalid(1)/rebuild-invalid/compat-invalid",
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
