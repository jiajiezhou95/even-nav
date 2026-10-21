import { renderHudOverview } from "./hud-overview";
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
  renderHudMenu,
  renderHudMenuTile,
  renderHudListTile,
} from "./hud-menu";
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  validateEvenHubPageContainer,
  evenHubEventFromJson,
  type EvenHubEvent,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import {
  renderHud,
  renderCompatibilityMap,
  HUD_WIDTH,
  HUD_HEIGHT,
  HUD_MAP_WIDTH,
  HUD_MAP_HEIGHT,
} from "./hud-renderer";

vi.mock("./runtime", () => ({
  isEvenHost: () => true,
  getEvenBridge: vi.fn(),
}));
vi.mock("./hud-menu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hud-menu")>()),
  buildHudStepPages: (steps: { text: string; current: boolean }[]) =>
    steps.map((step, index) => ({
      lines: [step.text],
      step: index + 1,
      total: steps.length,
      current: step.current,
      page: 1,
      pages: 1,
    })),
  HUD_MENU_ITEMS: [
    { label: "查看路线", action: "VIEW_ROUTE" },
    { label: "放大地图", action: "ZOOM_IN" },
    { label: "缩小地图", action: "ZOOM_OUT" },
    { label: "重选路线", action: "RESELECT_ROUTE" },
    { label: "返回导航", action: "RETURN_NAVIGATION" },
    { label: "退出插件", action: "EXIT_APP" },
  ],
  renderHudMenu: vi.fn(async (selected, message) =>
    [0, 1, 2, 3].map((i) =>
      new TextEncoder().encode(`menu/${selected}/${message || ""}/${i}`),
    ),
  ),
  renderHudMenuTile: vi.fn(async (selected) =>
    new TextEncoder().encode(`overlay/${selected}`),
  ),
  renderHudListTile: vi.fn(async (_background, content) =>
    new TextEncoder().encode(JSON.stringify(content)),
  ),
}));

vi.mock("./hud-overview", () => ({
  renderHudOverview: vi.fn(async (frame, page) =>
    [0, 1, 2, 3].map((i) =>
      new TextEncoder().encode(
        JSON.stringify({ pixels: frame.pixels[0], page, i }),
      ),
    ),
  ),
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

function rejectBAndRestore() {
  return vi
    .fn(async (_page: RebuildPageContainer) => true)
    .mockResolvedValueOnce(false);
}

async function menuDevice() {
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
    createStartUpPageContainer: vi.fn(async () => 0),
    rebuildPageContainer: vi.fn(async () => true),
    onAppLocationChanged: () => () => {},
    startAppLocationUpdates: vi.fn(async () => true),
    stopAppLocationUpdates: vi.fn(async () => true),
    shutDownPageContainer: vi.fn(async (_mode: number) => true),
    updateImageRawData: vi.fn(
      async (_value: { containerID: number; imageData: number[] }) => "success",
    ),
  };
  vi.mocked(getEvenBridge).mockResolvedValue(bridge as never);
  const action = vi.fn();
  const device = new EvenDevice(
    () => {},
    () => {},
    action,
  );
  await device.connect();
  const frame = {
    sequence: 1,
    version: 0,
    pixels: new Uint8Array([1]),
    instruction: "直行",
    status: "",
    attribution: "Synthetic",
  };
  device.queue.push(frame);
  await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
  return {
    device,
    bridge,
    action,
    frame,
    receive,
    emit: (eventType: number, ring = false) =>
      receive({
        sysEvent: { eventType, eventSource: ring ? 2 : 1 },
      } as EvenHubEvent),
  };
}

describe("official SDK boundary and display queue", () => {
  it("offers defer only for a current uncertainty prompt, binds its id and ignores single clicks", async () => {
    const { device, action, emit } = await menuDevice();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const context = {
        routeId: "rail",
        version: 0,
        legIndex: 1,
        promptId: "prompt-1",
      };
      device.setTransitAction("BOARDED", context);
      emit(3);
      now.mockReturnValue(1400);
      emit(2);
      emit(0);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(
        vi
          .mocked(renderHudMenuTile)
          .mock.lastCall?.[2]?.map((item) => item.action),
      ).toEqual([
        "BOARDED",
        "DEFER_TRANSIT",
        "VIEW_ROUTE",
        "ZOOM_IN",
        "ZOOM_OUT",
        "RESELECT_ROUTE",
        "RETURN_NAVIGATION",
        "EXIT_APP",
      ]);
      expect(action).not.toHaveBeenCalled();
      now.mockReturnValue(1800);
      emit(3);
      emit(3);
      expect(action).toHaveBeenCalledExactlyOnceWith("DEFER_TRANSIT", context);
      device.setTransitAction("BOARDED", {
        routeId: "rail",
        version: 0,
        legIndex: 1,
      });
      now.mockReturnValue(2200);
      emit(3);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(
        vi
          .mocked(renderHudMenuTile)
          .mock.lastCall?.[2]?.some((item) => item.action === "DEFER_TRANSIT"),
      ).toBe(false);
    } finally {
      now.mockRestore();
    }
  });
  it("offers a token-bound transit action ahead of all static items and invalidates an open menu on phase change", async () => {
    const { device, action, emit } = await menuDevice();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const context = { routeId: "rail", version: 0, legIndex: 1 };
      device.setTransitAction("BOARDED", context);
      emit(3);
      emit(0);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(
        vi
          .mocked(renderHudMenuTile)
          .mock.lastCall?.[2]?.map((item) => item.action),
      ).toEqual([
        "BOARDED",
        "VIEW_ROUTE",
        "ZOOM_IN",
        "ZOOM_OUT",
        "RESELECT_ROUTE",
        "RETURN_NAVIGATION",
        "EXIT_APP",
      ]);
      now.mockReturnValue(1400);
      emit(3);
      emit(3);
      expect(action).toHaveBeenCalledExactlyOnceWith("BOARDED", context);
      now.mockReturnValue(1800);
      emit(3);
      device.setTransitAction("ALIGHTED", { ...context, legIndex: 2 });
      now.mockReturnValue(2200);
      emit(3);
      emit(0);
      expect(action).toHaveBeenCalledTimes(1);
      now.mockReturnValue(2600);
      emit(3);
      expect(action).toHaveBeenLastCalledWith("ALIGHTED", {
        ...context,
        legIndex: 2,
      });
      now.mockReturnValue(3000);
      emit(3);
      now.mockReturnValue(3400);
      emit(1);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHudMenuTile).mock.lastCall?.[0]).toBe(6);
      device.setVersion(1);
      now.mockReturnValue(3800);
      emit(3);
      expect(action).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
  it("confirms exit once by double click, waits for GPS and the in-flight image before native shutdown", async () => {
    const { device, bridge, action, frame, emit } = await menuDevice();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    let release!: () => void;
    try {
      emit(3);
      now.mockReturnValue(1400);
      emit(1);
      emit(0);
      expect(action).not.toHaveBeenCalled();
      emit(3);
      emit(3);
      expect(action).toHaveBeenCalledExactlyOnceWith("EXIT_APP");
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      await device.startLocation();
      bridge.updateImageRawData.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return "success";
      });
      device.queue.push({ ...frame, pixels: new Uint8Array([2]) });
      await vi.waitFor(() => expect(release).toBeDefined());
      const before = bridge.updateImageRawData.mock.calls.length;
      const closing = device.close();
      device.queue.push({ ...frame, pixels: new Uint8Array([3]) });
      await vi.waitFor(() =>
        expect(bridge.stopAppLocationUpdates).toHaveBeenCalledOnce(),
      );
      expect(bridge.shutDownPageContainer).not.toHaveBeenCalled();
      release();
      await closing;
      expect(bridge.updateImageRawData.mock.calls.length).toBe(before);
      expect(bridge.shutDownPageContainer).toHaveBeenCalledExactlyOnceWith(0);
      expect(
        bridge.stopAppLocationUpdates.mock.invocationCallOrder[0],
      ).toBeLessThan(bridge.shutDownPageContainer.mock.invocationCallOrder[0]);
      expect(device.connected).toBe(false);
    } finally {
      release?.();
      now.mockRestore();
    }
  });
  it.each(["false", "throw"])(
    "reports native exit %s as failure",
    async (mode) => {
      const { device, bridge } = await menuDevice();
      if (mode === "false")
        bridge.shutDownPageContainer.mockResolvedValue(false);
      else
        bridge.shutDownPageContainer.mockRejectedValue(
          new Error("native failure"),
        );
      await expect(device.close()).rejects.toThrow("插件退出请求失败");
      expect(device.connected).toBe(true);
    },
  );
  it("requires double click to open and confirm, ignores all single clicks and duplicate double events", async () => {
    const { device, action, emit, receive } = await menuDevice();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      emit(0);
      emit(3, true);
      expect(action).not.toHaveBeenCalled();
      emit(3);
      emit(3);
      now.mockReturnValue(1400);
      for (const raw of [
        { type: "textEvent", jsonData: { Event_Type: 0, Container_ID: 5 } },
        { type: "textEvent", jsonData: { Container_ID: 5 } },
        { type: "sysEvent", jsonData: { eventSource: 1 } },
        { type: "textEvent", jsonData: { Event_Type: 99, Container_ID: 5 } },
      ])
        receive(evenHubEventFromJson(raw));
      await new Promise((resolve) => setTimeout(resolve, 320));
      expect(action).not.toHaveBeenCalled();
      emit(3);
      emit(3);
      emit(0);
      expect(action).toHaveBeenCalledExactlyOnceWith("VIEW_ROUTE");
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
    } finally {
      now.mockRestore();
    }
  });
  it("wraps to return and confirms without a navigation action", async () => {
    const { device, action, emit } = await menuDevice();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      emit(3);
      now.mockReturnValue(1400);
      emit(1);
      now.mockReturnValue(1800);
      emit(1);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHudMenuTile).mock.lastCall?.[0]).toBe(4);
      emit(0);
      expect(action).not.toHaveBeenCalled();
      emit(3);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(action).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
  it("shows map first, scrolls full-screen pages to the end and uses menu return instead of a return gesture", async () => {
    const { device, bridge, action, frame, emit } = await menuDevice();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      device.setOverview(true, [
        { text: "过去", current: false },
        { text: "当前", current: true },
        { text: "后续", current: false },
      ]);
      device.queue.push({ ...frame, overview: true });
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHudOverview).mock.lastCall?.[1]).toBeUndefined();
      const baseline = bridge.updateImageRawData.mock.calls.length;
      device.queue.push({
        ...frame,
        overview: true,
        pixels: new Uint8Array([2]),
      });
      expect(device.queue.inFlight).toBe(false);
      emit(2);
      emit(2);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHudOverview).mock.lastCall?.[1]?.step).toBe(1);
      now.mockReturnValue(1400);
      emit(2);
      now.mockReturnValue(1800);
      emit(2);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHudOverview).mock.lastCall?.[1]?.step).toBe(3);
      expect(bridge.updateImageRawData.mock.calls.length).toBeGreaterThan(
        baseline + 1,
      );
      now.mockReturnValue(2200);
      emit(2);
      expect(device.queue.inFlight).toBe(false);
      emit(3);
      emit(0);
      expect(action).not.toHaveBeenCalled();
      now.mockReturnValue(2600);
      emit(1);
      now.mockReturnValue(3000);
      emit(1);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHudMenuTile).mock.lastCall?.[0]).toBe(4);
      emit(3);
      emit(3);
      expect(action).toHaveBeenCalledExactlyOnceWith("EXIT_OVERVIEW");
      device.setOverview(false);
      device.queue.push({ ...frame, pixels: new Uint8Array([3]) });
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHud).mock.lastCall?.[0].pixels[0]).toBe(3);
    } finally {
      now.mockRestore();
    }
  });
  it("refreshes the overview map after a menu zoom while keeping menu scroll out of page navigation", async () => {
    const { device, action, frame, emit } = await menuDevice();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      device.setOverview(true, [{ text: "step", current: true }]);
      device.queue.push({ ...frame, overview: true });
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      emit(3);
      now.mockReturnValue(1400);
      emit(2);
      emit(3);
      expect(action).toHaveBeenCalledExactlyOnceWith("ZOOM_IN");
      device.refreshOverview();
      device.queue.push({
        ...frame,
        overview: true,
        pixels: new Uint8Array([9]),
      });
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHudOverview).mock.lastCall?.[0].pixels[0]).toBe(9);
      expect(vi.mocked(renderHudOverview).mock.lastCall?.[1]).toBeUndefined();
    } finally {
      now.mockRestore();
    }
  });
  it("rejects an old candidate map after selection changed, syncs phone selection and confirms only by double click", async () => {
    const { device, bridge, action, frame, emit } = await menuDevice();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      device.showRouteChoices(
        [
          { id: "a", summary: "3分钟" },
          { id: "b", summary: "4分钟" },
        ],
        "a",
        7,
        { ...frame, version: 7 },
      );
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      emit(2);
      emit(2);
      expect(action).toHaveBeenCalledExactlyOnceWith("SELECT_ROUTE", {
        routeId: "b",
        version: 7,
      });
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      const count = bridge.updateImageRawData.mock.calls.length;
      device.setRouteChoiceBackground(
        { ...frame, version: 7, pixels: new Uint8Array([8]) },
        "a",
      );
      expect(bridge.updateImageRawData.mock.calls.length).toBe(count);
      device.setRouteChoiceBackground(
        { ...frame, version: 7, pixels: new Uint8Array([2]) },
        "b",
      );
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHud).mock.lastCall?.[0].pixels[0]).toBe(2);
      emit(0);
      expect(action).toHaveBeenCalledTimes(1);
      device.selectRouteFromPhone("a", 7);
      now.mockReturnValue(1400);
      emit(3);
      emit(3);
      expect(action).toHaveBeenCalledWith("START_ROUTE", {
        routeId: "a",
        version: 7,
      });
      expect(action).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      device.setRouteChoiceBackground({ ...frame, version: 7 }, "a");
      expect(device.hasRouteChoices(7)).toBe(false);
      device.showRouteChoices([{ id: "a", summary: "3分钟" }], "a", 8);
      device.setVersion(9);
      now.mockReturnValue(1800);
      emit(3);
      expect(action).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
  it("executes double confirmation during a slow native write and repairs actual sent pixels serially", async () => {
    const { device, bridge, action, frame, emit } = await menuDevice();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    let release!: () => void;
    try {
      emit(3);
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      const before = bridge.updateImageRawData.mock.calls.length;
      device.queue.push({ ...frame, pixels: new Uint8Array([2]) });
      expect(device.queue.inFlight).toBe(false);
      bridge.updateImageRawData.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return "success";
      });
      now.mockReturnValue(1400);
      emit(2);
      await vi.waitFor(() => expect(release).toBeDefined());
      emit(3);
      emit(3);
      expect(action).toHaveBeenCalledExactlyOnceWith("ZOOM_IN");
      expect(bridge.updateImageRawData.mock.calls.length).toBe(before + 1);
      release();
      await vi.waitFor(() => expect(device.queue.inFlight).toBe(false));
      expect(vi.mocked(renderHud).mock.lastCall?.[0].pixels[0]).toBe(2);
      expect(
        bridge.updateImageRawData.mock.calls
          .slice(before + 1)
          .map(([v]) => v.containerID),
      ).toEqual([1, 2, 3, 4]);
    } finally {
      release?.();
      now.mockRestore();
    }
  });
  it("waits for baseline startup success before one B rebuild and four-image dispatch", async () => {
    let release!: (result: number) => void;
    const bridge = {
      createStartUpPageContainer: vi.fn(
        async (_page: CreateStartUpPageContainer) =>
          new Promise<number>((resolve) => {
            release = resolve;
          }),
      ),
      rebuildPageContainer: vi.fn(async (_page: RebuildPageContainer) => true),
      textContainerUpgrade: vi.fn(),
      updateImageRawData: vi.fn(
        async (_value: { containerID: number; containerName: string }) =>
          "success",
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
      instruction: "直行",
      status: "",
      attribution: "Synthetic",
    };
    device.queue.push(frame);
    expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    release(0);
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(1));
    const baseline =
      bridge.createStartUpPageContainer.mock.calls[0][0].toJson();
    const b = bridge.rebuildPageContainer.mock.calls[0][0].toJson();
    expect(
      baseline.imageObject.map((v: { containerID: number }) => v.containerID),
    ).toEqual([1, 5]);
    expect(
      b.imageObject.map((v: { containerID: number }) => v.containerID),
    ).toEqual([1, 2, 3, 4]);
    expect(b.imageObject).toEqual([
      {
        containerID: 1,
        containerName: "h0",
        xPosition: 0,
        yPosition: 0,
        width: 288,
        height: 144,
      },
      {
        containerID: 2,
        containerName: "h1",
        xPosition: 288,
        yPosition: 0,
        width: 288,
        height: 144,
      },
      {
        containerID: 3,
        containerName: "h2",
        xPosition: 0,
        yPosition: 144,
        width: 288,
        height: 144,
      },
      {
        containerID: 4,
        containerName: "h3",
        xPosition: 288,
        yPosition: 144,
        width: 288,
        height: 144,
      },
    ]);
    for (const container of [...b.imageObject, ...b.textObject]) {
      expect(
        new TextEncoder().encode(container.containerName).length,
      ).toBeLessThanOrEqual(14);
    }
    expect([HUD_WIDTH, HUD_HEIGHT, HUD_MAP_WIDTH, HUD_MAP_HEIGHT]).toEqual([
      576, 288, 576, 192,
    ]);
    expect(b.textObject).toEqual([
      {
        containerID: 5,
        containerName: "hud-events",
        xPosition: 300,
        yPosition: 0,
        width: 20,
        height: 20,
        content: " ",
        isEventCapture: 1,
      },
    ]);
    expect(
      bridge.updateImageRawData.mock.calls.map(([v]) => v.containerID),
    ).toEqual([1, 2, 3, 4]);
    expect(
      bridge.updateImageRawData.mock.calls.map(([v]) => [
        v.containerID,
        v.containerName,
      ]),
    ).toEqual(
      b.imageObject.map((v: { containerID: number; containerName: string }) => [
        v.containerID,
        v.containerName,
      ]),
    );
    expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
    device.queue.push({ ...frame, sequence: 2 });
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(2));
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledOnce();
    expect(bridge.rebuildPageContainer).toHaveBeenCalledOnce();
  });
  it("latches rejected B plus failed baseline restoration without dispatching an unknown layout", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 0),
      rebuildPageContainer: vi.fn(async () => false),
      updateImageRawData: vi.fn(),
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
    await vi.waitFor(() => expect(health).toHaveBeenCalledOnce());
    expect(device.lastDisplayFailure?.code).toBe(
      "B-rebuild-invalid/compat-restore-invalid",
    );
    device.queue.push({ ...frame, sequence: 2 });
    await vi.waitFor(() => expect(health).toHaveBeenCalledTimes(2));
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledOnce();
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(2);
    expect(bridge.updateImageRawData).not.toHaveBeenCalled();
  });
  it("reports a B rebuild exception without claiming either layout or attempting another rebuild", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 0),
      rebuildPageContainer: vi.fn(async () => {
        throw new Error("timeout");
      }),
      updateImageRawData: vi.fn(),
    };
    const health = vi.fn();
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
    expect(device.lastDisplayFailure?.code).toBe("B-rebuild-timeout");
    expect(device.lastSubmission).toBeUndefined();
    expect(bridge.rebuildPageContainer).toHaveBeenCalledOnce();
    expect(bridge.updateImageRawData).not.toHaveBeenCalled();
  });
  it("records only numeric App ID validity flags, never the identifier", async () => {
    try {
      for (const [id, finite, integer, positive] of [
        [87654321, true, true, true],
        [0, true, true, false],
        [-2, true, true, false],
        [1.5, true, false, true],
        [NaN, false, false, false],
      ] as const) {
        vi.stubGlobal("window", { __EVEN_HUB_APP_ID__: id });
        const traces: PageCallTrace[] = [];
        const bridge = {
          callEvenApp: async () => 0,
        } as unknown as EvenAppBridge;
        await observePageCall(bridge, "c", traces, async () => 0);
        expect(traces[0]).toMatchObject({
          appIdType: "number",
          appIdPresent: true,
          appIdFinite: finite,
          appIdInteger: integer,
          appIdPositive: positive,
        });
        expect(JSON.stringify(traces)).not.toContain("87654321");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
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
            appIdFinite: false,
            appIdInteger: false,
            appIdPositive: false,
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
  it("starts directly with two baseline images and three native text containers", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(
        async (_page: CreateStartUpPageContainer) => 0,
      ),
      rebuildPageContainer: rejectBAndRestore(),
      textContainerUpgrade: vi.fn(async () => true),
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
    const bRenderCalls = vi.mocked(renderHud).mock.calls.length;
    device.queue.push({
      sequence: 1,
      version: 0,
      pixels: new Uint8Array([1]),
      instruction: "直行",
      status: "",
      attribution: "Synthetic",
    });
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(1));
    const payload = bridge.createStartUpPageContainer.mock.calls[0][0].toJson();
    expect(
      payload.imageObject.map(
        (item: { containerID: number }) => item.containerID,
      ),
    ).toEqual([1, 5]);
    expect(
      payload.textObject.map(
        (item: { containerID: number }) => item.containerID,
      ),
    ).toEqual([2, 3, 4]);
    expect(validateEvenHubPageContainer(payload)).toEqual({ valid: true });
    expect(
      [...payload.imageObject, ...payload.textObject].every(
        (item) => !Object.hasOwn(item, "zOrderIndex"),
      ),
    ).toBe(true);
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(2);
    expect(vi.mocked(renderHud).mock.calls.length).toBe(bRenderCalls);
  });
  it("replaces changed native cue or blinking status without reuploading unchanged images", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 0),
      rebuildPageContainer: rejectBAndRestore(),
      textContainerUpgrade: vi.fn(async () => true),
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
    ).toEqual([1]);
    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(5);
  });
  it("reports a rejected baseline image without treating its preceding text as a complete frame", async () => {
    const failed = vi.fn();
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 0),
      rebuildPageContainer: rejectBAndRestore(),
      textContainerUpgrade: vi.fn(async () => true),
      updateImageRawData: vi.fn(async (v: { containerID: number }) =>
        v.containerID === 1 ? "imageSizeInvalid" : "success",
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
    expect(bridge.updateImageRawData).toHaveBeenCalledTimes(1);
    expect(device.lastSubmission).toBeUndefined();
    expect(device.queue.inFlight).toBe(false);
    expect(device.connected).toBe(true);
    expect(device.lastDisplayFailure).toMatchObject({
      stage: "IMAGE",
      code: "imageSizeInvalid",
      containerID: 1,
    });
    expect(failed).toHaveBeenCalledWith(
      expect.stringContaining("IMAGE:imageSizeInvalid，容器 1"),
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
            ? "compat-start-invalid(1)/compat-rebuild-invalid"
            : `compat-start-${name}(${code})`,
      });
      expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(
        code === 1 ? 1 : 0,
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
        code === 1 ? 1 : 0,
      );
    },
  );
  it("recovers an existing native page with exactly one identical rebuild before sending the frame", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(
        async (_page: CreateStartUpPageContainer) => 1,
      ),
      rebuildPageContainer: vi
        .fn(async (_page: RebuildPageContainer) => true)
        .mockResolvedValueOnce(true)
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
    device.queue.push(frame);
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(1));
    const created = bridge.createStartUpPageContainer.mock.calls[0][0].toJson();
    const rebuilt = bridge.rebuildPageContainer.mock.calls[0][0].toJson();
    expect(rebuilt).toEqual(created);
    expect(validateEvenHubPageContainer(rebuilt)).toEqual({ valid: true });
    expect(bridge.updateImageRawData).toHaveBeenCalledTimes(1);
    expect(health).toHaveBeenLastCalledWith("G2 已连接，兼容布局");
    device.queue.push({ ...frame, sequence: 2 });
    await vi.waitFor(() => expect(device.lastSubmission?.sequence).toBe(2));
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(1);
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(3);
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
      "compat-start-invalid(1)/compat-rebuild-timeout",
    );
    expect(JSON.stringify(device.lastDisplayFailure)).not.toContain("private");
    expect(bridge.updateImageRawData).not.toHaveBeenCalled();
    expect(bridge.rebuildPageContainer).toHaveBeenCalledOnce();
  });
  it("latches a thrown baseline startup without attempting rebuild or periodic retry", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => {
        throw new Error("host timeout private payload");
      }),
      rebuildPageContainer: vi.fn(),
      updateImageRawData: vi.fn(),
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
    await vi.waitFor(() => expect(health).toHaveBeenCalledOnce());
    expect(device.lastDisplayFailure?.code).toBe("compat-start-timeout");
    device.queue.push({ ...frame, sequence: 2 });
    await vi.waitFor(() => expect(health).toHaveBeenCalledTimes(2));
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledOnce();
    expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    expect(bridge.updateImageRawData).not.toHaveBeenCalled();
  });
  it("uses the exact proven baseline at startup, then deduplicates native updates", async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(
        async (_page: CreateStartUpPageContainer) => 0,
      ),
      rebuildPageContainer: rejectBAndRestore(),
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
    const legacy = bridge.createStartUpPageContainer.mock.calls[0][0].toJson();
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
      createStartUpPageContainer: vi.fn(async () => 0),
      rebuildPageContainer: rejectBAndRestore(),
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
      rebuildPageContainer: rejectBAndRestore(),
      textContainerUpgrade: vi.fn(async () => true),
      updateImageRawData: vi.fn(async () => "success"),
    };
    const device = new EvenDevice(
      () => {},
      health,
      () => {},
    );
    Object.assign(device, { bridge, connected: true, source: "EVEN" });
    vi.mocked(renderCompatibilityMap).mockRejectedValueOnce(
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
    expect(health).toHaveBeenLastCalledWith("G2 已连接，兼容布局");
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
      "G2 PAGE compat-start-invalid(1)/compat-rebuild-invalid",
    );
    expect(bridge.imuControl).not.toHaveBeenCalled();
    bridge.createStartUpPageContainer.mockResolvedValue(0);
    bridge.rebuildPageContainer.mockResolvedValue(true);
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
