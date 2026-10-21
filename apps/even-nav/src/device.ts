import type {
  AppLocation,
  EvenAppBridge,
  EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ImageContainerProperty,
  TextContainerProperty,
  TextContainerUpgrade,
  MenuContainerProperty,
  MenuItemProperty,
  ImageRawDataUpdate,
  AppLocationAccuracy,
  OsEventTypeList,
  EventSourceType,
} from "@evenrealities/even_hub_sdk";
import { isCoordinate, NavError } from "../../../packages/contracts/src/index";
import type { Coordinate } from "../../../packages/contracts/src/index";
import { getEvenBridge, isEvenHost } from "./runtime";
import {
  HUD_QUADRANTS,
  renderHud,
  renderCompatibilityMap,
} from "./hud-renderer";
import type { GuidanceView } from "./guidance";
import { renderHudOverview } from "./hud-overview";
import {
  HUD_MENU_ITEMS,
  renderHudMenu,
  renderHudMenuTile,
  renderHudListTile,
  buildHudStepPages,
  type HudRouteStep,
  type HudStepPage,
  type HudRouteChoice,
} from "./hud-menu";

/** PB CLICK is zero and may be omitted, but only recognized touch targets default. */
function touchEventType(event: EvenHubEvent) {
  const explicit =
    event.textEvent?.eventType ??
    event.listEvent?.eventType ??
    event.sysEvent?.eventType;
  if (explicit !== undefined) return explicit;
  const raw = event.jsonData;
  if (
    raw &&
    Object.keys(raw).some(
      (key) => key.replace(/_/g, "").toLowerCase() === "eventtype",
    )
  )
    return;
  const target = event.textEvent ?? event.listEvent;
  if (target?.containerID === 5 || target?.containerName === "hud-events")
    return OsEventTypeList.CLICK_EVENT;
  const sys = event.sysEvent;
  if (
    sys &&
    !sys.imuData &&
    sys.systemExitReasonCode === undefined &&
    (sys.eventSource === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R ||
      sys.eventSource === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L)
  )
    return OsEventTypeList.CLICK_EVENT;
}

export interface DeviceFix {
  coordinate: Coordinate;
  timestamp: number;
  accuracyMeters?: number;
  speedMps?: number;
  heading?: number;
}
export type DeviceAction =
  | "PAUSE"
  | "RESUME"
  | "END"
  | "ZOOM_IN"
  | "ZOOM_OUT"
  | "VIEW_ROUTE"
  | "EXIT_OVERVIEW"
  | "RESELECT_ROUTE"
  | "SELECT_ROUTE"
  | "START_ROUTE"
  | "EXIT_APP";
export interface RouteChoiceAction {
  routeId: string;
  version: number;
}
export interface DisplayFailure {
  stage: "PAGE" | "RENDER" | "IMAGE" | "TEXT";
  code: string;
  containerID?: number;
  at: number;
  pageCalls?: PageCallTrace[];
}
export interface PageCallTrace {
  tag: "c" | "r" | "k";
  hooked: boolean;
  dispatched: boolean;
  raw: string;
  handlerCallable: boolean;
  appIdPresent: boolean;
  appIdType: string;
  appIdFinite: boolean;
  appIdInteger: boolean;
  appIdPositive: boolean;
}
function resultShape(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number")
    return Number.isInteger(value) && value >= 0 && value <= 3
      ? `n${value}`
      : "number";
  return typeof value;
}
/** Observe SDK dispatch/return shape only; never retain its payload or raw text. */
export async function observePageCall<T>(
  bridge: EvenAppBridge,
  tag: PageCallTrace["tag"],
  traces: PageCallTrace[],
  operation: () => Promise<T>,
): Promise<T> {
  const environment =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as {
          flutter_inappwebview?: { callHandler?: unknown };
          __EVEN_HUB_APP_ID__?: unknown;
        });
  const appId = environment?.__EVEN_HUB_APP_ID__;
  const trace: PageCallTrace = {
    tag,
    hooked: false,
    dispatched: false,
    raw: "unobserved",
    handlerCallable:
      typeof environment?.flutter_inappwebview?.callHandler === "function",
    appIdPresent: Boolean(environment && "__EVEN_HUB_APP_ID__" in environment),
    appIdType: typeof appId,
    appIdFinite: typeof appId === "number" && Number.isFinite(appId),
    appIdInteger: typeof appId === "number" && Number.isInteger(appId),
    appIdPositive:
      typeof appId === "number" && Number.isFinite(appId) && appId > 0,
  };
  traces.push(trace);
  const original = bridge.callEvenApp;
  const descriptor = Object.getOwnPropertyDescriptor(bridge, "callEvenApp");
  const method =
    tag === "c" ? "createStartUpPageContainer" : "rebuildPageContainer";
  const wrapped: EvenAppBridge["callEvenApp"] = async function (
    this: EvenAppBridge,
    name,
    params,
  ) {
    if (name !== method) return original.call(this, name, params);
    trace.dispatched = true;
    try {
      const value = await original.call(this, name, params);
      trace.raw = resultShape(value);
      return value;
    } catch (error) {
      trace.raw = "throw";
      throw error;
    }
  };
  if (typeof original === "function") {
    try {
      bridge.callEvenApp = wrapped;
      trace.hooked = bridge.callEvenApp === wrapped;
    } catch {
      /* Read-only bridges still execute unchanged, marked unobserved. */
    }
  }
  try {
    return await operation();
  } finally {
    if (trace.hooked) {
      if (descriptor) Object.defineProperty(bridge, "callEvenApp", descriptor);
      else Reflect.deleteProperty(bridge, "callEvenApp");
    }
  }
}
function pageTraceText(traces: PageCallTrace[]): string {
  return traces
    .map(
      (trace) =>
        `${trace.tag}(h${Number(trace.handlerCallable)},id:${trace.appIdPresent ? trace.appIdType + (trace.appIdType === "number" ? `/f${Number(trace.appIdFinite)}i${Number(trace.appIdInteger)}p${Number(trace.appIdPositive)}` : "") : "missing"}):${!trace.hooked ? "unobserved" : !trace.dispatched ? "no-dispatch" : trace.raw}`,
    )
    .join(";");
}
class DisplayError extends Error {
  constructor(
    readonly stage: DisplayFailure["stage"],
    readonly code: string,
    readonly containerID?: number,
  ) {
    super(`G2 ${stage} ${code}`);
  }
}
function exceptionCode(error: unknown): string {
  if (error instanceof Error && /timeout|timed out/i.test(error.message))
    return "timeout";
  return error instanceof DOMException ? error.name : "exception";
}
export interface HudFrame {
  overview?: boolean;
  sequence: number;
  version: number;
  pixels: Uint8Array;
  instruction: string;
  guidance?: GuidanceView;
  status: string;
  attribution: string;
  icon?: { key: string; pixels: Uint8Array };
}

/** One in-flight operation, one replaceable pending operation. No automatic retry. */
export class LatestFrameQueue<T> {
  private draining?: Promise<void>;
  private pending?: T;
  private active = false;
  private epoch = 0;
  constructor(
    private send: (value: T) => Promise<void>,
    private failed: (error: unknown) => void,
    private queued?: (value: T) => void | boolean,
  ) {}
  push(value: T) {
    if (this.queued?.(value) === false) return;
    this.pending = value;
    if (!this.active) this.draining = this.drain();
  }
  invalidate() {
    this.epoch++;
    this.pending = undefined;
  }
  get inFlight() {
    return this.active;
  }
  async waitForIdle() {
    await this.draining;
  }
  private async drain() {
    this.active = true;
    while (this.pending !== undefined) {
      const value = this.pending;
      this.pending = undefined;
      const epoch = this.epoch;
      try {
        await this.send(value);
      } catch (error) {
        if (epoch === this.epoch) {
          this.pending = undefined;
          this.failed(error);
        }
      }
    }
    this.active = false;
  }
}
export function nativeFix(
  location: AppLocation,
  now = Date.now(),
): DeviceFix | undefined {
  const coordinate = { lat: location.latitude, lng: location.longitude };
  if (
    !isCoordinate(coordinate) ||
    !Number.isFinite(location.timestamp) ||
    location.timestamp! < 1e12 ||
    location.timestamp! > now + 5000
  )
    return;
  return {
    coordinate,
    timestamp: location.timestamp!,
    accuracyMeters: location.accuracy,
    speedMps: location.speed,
    heading: location.heading,
  };
}
export class EvenDevice {
  private bridge?: EvenAppBridge;
  private unsubscribeLocation?: () => void;
  private unsubscribeDevice?: () => void;
  private unsubscribeEvents?: () => void;
  private browserWatch?: number;
  private subscribed = false;
  private connecting?: Promise<void>;
  private closing = false;
  private locationStarting?: Promise<void>;
  private locationStopping?: Promise<void>;
  private pageCreated = false;
  private quadrantPixels: Uint8Array[] = [];
  private compatibilityLayout = false;
  private layoutAnnounced = false;
  private legacyMapPixels?: Uint8Array;
  private legacyIconKey?: string;
  private legacyTextValues = new Map<number, string>();
  private pageStarting?: Promise<void>;
  private pageFailure?: DisplayError;
  private pageCalls: PageCallTrace[] = [];
  private version = 0;
  private lastScrollAt = -Infinity;
  private lastDoubleAt = -Infinity;
  private latestFrame?: HudFrame;
  private menuOpen = false;
  private menuSelected = 0;
  private menuBackground?: Uint8Array;
  private requestingPresentation = false;
  private routeChoices?: {
    version: number;
    items: HudRouteChoice[];
    background?: HudFrame;
    ready?: boolean;
  };
  private overview = false;
  private stepPages: HudStepPage[] = [];
  private stepPage = 0;
  private overviewReady = false;
  private overviewFrame?: HudFrame;
  private displayMessage?: string;
  private presentationEpoch = 0;
  connected = false;
  source: "EVEN" | "BROWSER_DEV" | "NONE" = "NONE";
  readonly queue: LatestFrameQueue<HudFrame>;
  lastSubmission?: { sequence: number; at: number; result: string };
  lastDisplayFailure?: DisplayFailure;
  constructor(
    private onFix: (fix: DeviceFix) => void,
    private onHealth: (message: string) => void,
    private onAction: (
      action: DeviceAction,
      choice?: RouteChoiceAction,
    ) => void,
  ) {
    this.queue = new LatestFrameQueue(
      async (frame) => {
        if (
          this.closing ||
          frame.version !== this.version ||
          !this.bridge ||
          !this.connected
        )
          return;
        await this.ensurePage();
        if (frame.version !== this.version || !this.connected) return;
        if (this.overview && (!frame.overview || !this.overviewFrame)) return;
        const presentation = this.presentationEpoch;
        if (this.compatibilityLayout) {
          if (!(await this.sendCompatibilityFrame(frame))) return;
        } else {
          let quadrants: (Uint8Array | undefined)[];
          try {
            quadrants = this.menuOpen
              ? [
                  undefined,
                  await renderHudMenuTile(
                    this.menuSelected,
                    this.menuBackground,
                  ),
                ]
              : this.routeChoices
                ? [
                    undefined,
                    await renderHudListTile(this.menuBackground, {
                      routes: this.routeChoices.items,
                      selected: this.menuSelected,
                    }),
                  ]
                : this.overview
                  ? await renderHudOverview(
                      this.overviewFrame!,
                      this.stepPage > 0
                        ? this.stepPages[this.stepPage - 1]
                        : undefined,
                    )
                  : this.displayMessage
                    ? await renderHudMenu(
                        this.menuSelected,
                        this.displayMessage,
                      )
                    : await renderHud(frame);
            if (this.routeChoices?.background && !this.routeChoices.ready) {
              quadrants = await renderHud(this.routeChoices.background);
              this.menuBackground = quadrants[1]?.slice();
              quadrants[1] = await renderHudListTile(this.menuBackground, {
                routes: this.routeChoices.items,
                selected: this.menuSelected,
              });
            }
          } catch (error) {
            throw new DisplayError("RENDER", exceptionCode(error));
          }
          // One serialized queue; check generation between every native write.
          for (const [index, tile] of HUD_QUADRANTS.entries()) {
            if (
              frame.version !== this.version ||
              !this.connected ||
              presentation !== this.presentationEpoch
            )
              return;
            const pixels = quadrants[index];
            if (!pixels) continue;
            const previous = this.quadrantPixels[index];
            if (
              previous?.length === pixels.length &&
              pixels.every((value, i) => value === previous[i])
            )
              continue;
            let result;
            try {
              result = await this.bridge.updateImageRawData(
                new ImageRawDataUpdate({
                  containerID: tile.id,
                  containerName: tile.name,
                  imageData: Array.from(pixels),
                }),
              );
            } catch (error) {
              throw new DisplayError("IMAGE", exceptionCode(error), tile.id);
            }
            if (result !== "success")
              throw new DisplayError("IMAGE", result, tile.id);
            if (frame.version !== this.version || !this.connected) {
              this.quadrantPixels = [];
              return;
            }
            this.quadrantPixels[index] = pixels.slice();
            // The completed native write is physical truth even if its presentation expired.
            if (presentation !== this.presentationEpoch) return;
          }
        }
        this.lastSubmission = {
          sequence: frame.sequence,
          at: Date.now(),
          result: "success",
        };
        if (this.overview) this.overviewReady = true;
        if (this.routeChoices?.background) this.routeChoices.ready = true;
        if (!this.layoutAnnounced) {
          this.layoutAnnounced = true;
          this.lastDisplayFailure = undefined;
          this.onHealth(
            this.compatibilityLayout
              ? "G2 已连接，兼容布局"
              : "G2 已连接，大地图",
          );
        } else if (this.lastDisplayFailure) {
          this.lastDisplayFailure = undefined;
          this.onHealth(
            this.compatibilityLayout
              ? "G2 已连接，兼容布局"
              : "G2 已连接，大地图",
          );
        }
      },
      (error) => {
        const failure =
          error instanceof DisplayError
            ? error
            : new DisplayError("RENDER", exceptionCode(error));
        this.lastDisplayFailure = {
          stage: failure.stage,
          code: failure.code,
          containerID: failure.containerID,
          at: Date.now(),
          ...(failure.stage === "PAGE"
            ? { pageCalls: this.pageCalls.map((trace) => ({ ...trace })) }
            : {}),
        };
        const label = {
          PAGE: "页面创建失败",
          RENDER: "画面生成失败",
          IMAGE: "图像传输失败",
          TEXT: "文字传输失败",
        }[failure.stage];
        this.onHealth(
          `G2 ${label} [${failure.stage}:${failure.code}${failure.containerID ? (this.compatibilityLayout ? `，容器 ${failure.containerID}` : `，块 ${failure.containerID}/4`) : ""}]${failure.stage === "PAGE" ? ` [${pageTraceText(this.pageCalls)}]` : ""}${this.connected ? "；设备仍已连接" : "；设备已断开"}`,
        );
      },
      (frame) => {
        if (this.closing) return false;
        if (
          frame.version === this.version &&
          frame.overview &&
          this.overview &&
          !this.overviewReady &&
          !this.requestingPresentation
        )
          this.overviewFrame = frame;
        if (
          frame.version === this.version &&
          !this.displayMessage &&
          !this.routeChoices
        )
          this.latestFrame = frame;
        if (
          (this.menuOpen ||
            this.routeChoices ||
            (this.overview && this.overviewReady)) &&
          !this.requestingPresentation
        )
          return false;
      },
    );
  }
  private redrawPresentation() {
    this.presentationEpoch++;
    this.requestingPresentation = true;
    try {
      if (this.routeChoices || this.displayMessage)
        this.queue.push({
          sequence: 0,
          version: this.version,
          pixels: new Uint8Array(),
          instruction: this.displayMessage || "请选择路线",
          status: "",
          attribution: "",
        });
      else if (this.latestFrame?.version === this.version)
        this.queue.push(this.latestFrame);
    } finally {
      this.requestingPresentation = false;
    }
  }
  showRouteChoices(
    items: HudRouteChoice[],
    selectedId: string,
    version: number,
    background?: HudFrame,
  ) {
    if (!this.connected || this.compatibilityLayout || !items.length) return;
    this.setVersion(version);
    this.menuOpen = false;
    this.overview = false;
    this.displayMessage = undefined;
    this.latestFrame = undefined;
    this.routeChoices = { version, items: items.slice(0, 3), background };
    this.menuBackground = this.quadrantPixels[1]?.slice();
    this.menuSelected = Math.max(
      0,
      this.routeChoices.items.findIndex((item) => item.id === selectedId),
    );
    this.redrawPresentation();
  }
  selectRouteFromPhone(id: string, version: number) {
    if (this.routeChoices?.version !== version) return;
    const index = this.routeChoices.items.findIndex((item) => item.id === id);
    if (index < 0 || index === this.menuSelected) return;
    this.menuSelected = index;
    this.redrawPresentation();
  }
  hasRouteChoices(version: number) {
    return this.routeChoices?.version === version;
  }
  setRouteChoiceBackground(frame: HudFrame, routeId?: string) {
    if (
      !this.routeChoices ||
      this.routeChoices.version !== frame.version ||
      (routeId && this.routeChoices.items[this.menuSelected].id !== routeId)
    )
      return;
    this.routeChoices.background = frame;
    this.routeChoices.ready = false;
    this.redrawPresentation();
  }
  setOverview(value: boolean, steps: HudRouteStep[] = []) {
    this.overview = value;
    this.overviewReady = false;
    this.overviewFrame = undefined;
    this.stepPages = value ? buildHudStepPages(steps) : [];
    this.stepPage = 0;
    this.menuOpen = false;
    this.presentationEpoch++;
  }
  refreshOverview() {
    if (!this.overview) return;
    this.overviewFrame = undefined;
    this.overviewReady = false;
    this.stepPage = 0;
    this.presentationEpoch++;
  }
  showMessage(message: string) {
    this.routeChoices = undefined;
    this.menuOpen = false;
    this.overview = false;
    this.latestFrame = undefined;
    this.displayMessage = message;
    this.presentationEpoch++;
    this.queue.push({
      sequence: 0,
      version: this.version,
      pixels: new Uint8Array(),
      instruction: message,
      status: "",
      attribution: "",
    });
  }
  private resetPresentation() {
    this.stepPages = [];
    this.overviewReady = false;
    this.overviewFrame = undefined;
    this.routeChoices = undefined;
    this.menuOpen = false;
    this.menuBackground = undefined;
    this.overview = false;
    this.displayMessage = undefined;
    this.latestFrame = undefined;
    this.lastSubmission = undefined;
    this.presentationEpoch++;
    this.quadrantPixels = [];
  }
  private async sendCompatibilityFrame(frame: HudFrame): Promise<boolean> {
    const current = () => frame.version === this.version && this.connected;
    let mapPixels: Uint8Array;
    try {
      mapPixels = await renderCompatibilityMap(frame.pixels);
    } catch (error) {
      throw new DisplayError("RENDER", exceptionCode(error));
    }
    for (const [id, name, content] of [
      [2, "instruction", frame.instruction],
      [3, "status", frame.status],
      [4, "attribution", frame.attribution],
    ] as const) {
      if (!current()) return false;
      if (this.legacyTextValues.get(id) === content) continue;
      let updated;
      try {
        updated = await this.bridge!.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: id,
            containerName: name,
            content,
            contentOffset: 0,
            contentLength: 0,
          }),
        );
      } catch (error) {
        throw new DisplayError("TEXT", exceptionCode(error), id);
      }
      if (!updated) throw new DisplayError("TEXT", "rejected", id);
      if (!current()) return false;
      this.legacyTextValues.set(id, content);
    }
    for (const [id, name, pixels, unchanged] of [
      ...(frame.icon
        ? [
            [
              5,
              "maneuver",
              frame.icon.pixels,
              frame.icon.key === this.legacyIconKey,
            ] as const,
          ]
        : []),
      [
        1,
        "map",
        mapPixels,
        this.legacyMapPixels?.length === mapPixels.length &&
          mapPixels.every((value, i) => value === this.legacyMapPixels![i]),
      ] as const,
    ]) {
      if (!current()) return false;
      if (unchanged) continue;
      let result;
      try {
        result = await this.bridge!.updateImageRawData(
          new ImageRawDataUpdate({
            containerID: id,
            containerName: name,
            imageData: Array.from(pixels),
          }),
        );
      } catch (error) {
        throw new DisplayError("IMAGE", exceptionCode(error), id);
      }
      if (result !== "success") throw new DisplayError("IMAGE", result, id);
      if (!current()) return false;
      if (id === 5) this.legacyIconKey = frame.icon!.key;
      else this.legacyMapPixels = pixels.slice();
    }
    return current();
  }
  private async ensurePage() {
    if (this.pageCreated) return;
    if (this.pageFailure) throw this.pageFailure;
    if (!this.bridge || !this.connected) throw new Error("请先连接 G2");
    if (this.pageStarting) return this.pageStarting;
    this.pageStarting = this.createPage();
    try {
      await this.pageStarting;
    } catch (error) {
      if (error instanceof DisplayError) this.pageFailure = error;
      throw error;
    } finally {
      this.pageStarting = undefined;
    }
  }
  /** Exact native layout from the last working 55551fb (Beta 0.1.7). */
  private compatibilityPage() {
    return new RebuildPageContainer({
      containerTotalNum: 5,
      imageObject: [
        new ImageContainerProperty({
          containerID: 1,
          containerName: "map",
          xPosition: 0,
          yPosition: 0,
          width: 288,
          height: 144,
        }),
        new ImageContainerProperty({
          containerID: 5,
          containerName: "maneuver",
          xPosition: 300,
          yPosition: 0,
          width: 48,
          height: 48,
        }),
      ],
      textObject: [
        new TextContainerProperty({
          containerID: 2,
          containerName: "instruction",
          xPosition: 360,
          yPosition: 0,
          width: 216,
          height: 144,
          content: "准备导航",
          isEventCapture: 1,
        }),
        new TextContainerProperty({
          containerID: 3,
          containerName: "status",
          xPosition: 300,
          yPosition: 150,
          width: 276,
          height: 54,
          content: "定位时间未知",
          isEventCapture: 0,
        }),
        new TextContainerProperty({
          containerID: 4,
          containerName: "attribution",
          xPosition: 0,
          yPosition: 208,
          width: 576,
          height: 80,
          content: " ",
          isEventCapture: 0,
        }),
      ],
      menuObject: new MenuContainerProperty({
        menuItems: [
          new MenuItemProperty({ itemID: 1, itemName: "暂停" }),
          new MenuItemProperty({ itemID: 2, itemName: "继续" }),
          new MenuItemProperty({ itemID: 3, itemName: "结束" }),
        ],
      }),
    });
  }
  private layoutBPage() {
    return new RebuildPageContainer({
      containerTotalNum: 5,
      imageObject: HUD_QUADRANTS.map(
        (tile) =>
          new ImageContainerProperty({
            containerID: tile.id,
            containerName: tile.name,
            xPosition: tile.x,
            yPosition: tile.y,
            width: 288,
            height: 144,
          }),
      ),
      // Event capture in a visually blank header area.
      textObject: [
        new TextContainerProperty({
          containerID: 5,
          containerName: "hud-events",
          xPosition: 300,
          yPosition: 0,
          width: 20,
          height: 20,
          content: " ",
          isEventCapture: 1,
        }),
      ],
      menuObject: new MenuContainerProperty({
        menuItems: [
          new MenuItemProperty({ itemID: 1, itemName: "暂停" }),
          new MenuItemProperty({ itemID: 2, itemName: "继续" }),
          new MenuItemProperty({ itemID: 3, itemName: "结束" }),
        ],
      }),
    });
  }
  private async createPage() {
    this.pageCalls = [];
    // Restore the proven baseline at STARTUP, not only after an uncreated B page.
    const page = new CreateStartUpPageContainer(this.compatibilityPage());
    let result;
    try {
      result = await observePageCall(this.bridge!, "c", this.pageCalls, () =>
        this.bridge!.createStartUpPageContainer(page),
      );
    } catch (error) {
      throw new DisplayError("PAGE", `compat-start-${exceptionCode(error)}`);
    }
    if (result === 1) {
      let rebuilt;
      try {
        rebuilt = await observePageCall(this.bridge!, "k", this.pageCalls, () =>
          this.bridge!.rebuildPageContainer(new RebuildPageContainer(page)),
        );
      } catch (error) {
        throw new DisplayError(
          "PAGE",
          `compat-start-invalid(1)/compat-rebuild-${exceptionCode(error)}`,
        );
      }
      if (!rebuilt)
        throw new DisplayError(
          "PAGE",
          "compat-start-invalid(1)/compat-rebuild-invalid",
        );
    } else if (result !== 0) {
      const code =
        ["success", "invalid", "oversize", "outOfMemory"][result] || "unknown";
      throw new DisplayError("PAGE", `compat-start-${code}(${result})`);
    }
    // The native startup must succeed before attempting the approved larger layout.
    let expanded;
    try {
      expanded = await observePageCall(this.bridge!, "r", this.pageCalls, () =>
        this.bridge!.rebuildPageContainer(this.layoutBPage()),
      );
    } catch (error) {
      throw new DisplayError("PAGE", `B-rebuild-${exceptionCode(error)}`);
    }
    if (expanded === true) {
      this.compatibilityLayout = false;
    } else {
      let restored;
      try {
        restored = await observePageCall(
          this.bridge!,
          "k",
          this.pageCalls,
          () =>
            this.bridge!.rebuildPageContainer(new RebuildPageContainer(page)),
        );
      } catch (error) {
        throw new DisplayError(
          "PAGE",
          `B-rebuild-invalid/compat-restore-${exceptionCode(error)}`,
        );
      }
      if (restored !== true)
        throw new DisplayError(
          "PAGE",
          "B-rebuild-invalid/compat-restore-invalid",
        );
      this.compatibilityLayout = true;
    }
    this.pageCreated = true;
  }
  /** Diagnostic caller must hold navigation idle. No location/provider access. */
  async prepareImuProbe(): Promise<
    Pick<EvenAppBridge, "imuControl" | "onEvenHubEvent">
  > {
    await this.connect();
    await this.ensurePage();
    return this.bridge!;
  }
  async connect() {
    if (this.connecting) return this.connecting;
    if (this.bridge) {
      // A new explicit connect/start may retry; periodic display frames may not.
      this.pageFailure = undefined;
      return;
    }
    this.connecting = this.connectNative();
    try {
      await this.connecting;
    } catch (error) {
      this.unsubscribeDevice?.();
      this.unsubscribeEvents?.();
      this.bridge = undefined;
      this.source = "NONE";
      this.connected = false;
      throw error;
    } finally {
      this.connecting = undefined;
    }
  }
  private async connectNative() {
    if (!isEvenHost())
      throw new NavError(
        "DISPLAY_DISCONNECTED",
        "当前不是 Even App。可使用浏览器开发定位预览，不能验证 G2。",
      );
    this.bridge = await getEvenBridge();
    this.source = "EVEN";
    const device = await this.bridge.getDeviceInfo();
    this.connected =
      device?.model === "g2" && device.status.connectType === "connected";
    this.unsubscribeDevice = this.bridge.onDeviceStatusChanged((status) => {
      const wasConnected = this.connected;
      this.connected = status.connectType === "connected";
      if (!wasConnected && this.connected) this.pageFailure = undefined;
      this.queue.invalidate();
      this.resetPresentation();
      this.quadrantPixels = [];
      this.legacyMapPixels = undefined;
      this.legacyIconKey = undefined;
      this.legacyTextValues.clear();
      this.layoutAnnounced = false;
      this.onHealth(
        this.connected ? "G2 已连接" : "G2 已断开；手机继续显示导航",
      );
    });
    this.unsubscribeEvents = this.bridge.onEvenHubEvent((event) => {
      const item = event.menuItemClickEvent?.itemID;
      if (
        (this.menuOpen || this.routeChoices || this.overview) &&
        item !== undefined
      )
        return;
      if (item === 1) this.onAction("PAUSE");
      if (item === 2) this.onAction("RESUME");
      if (item === 3) this.onAction("END");
      if (item !== undefined) return;
      if (event.sysEvent?.eventSource === EventSourceType.TOUCH_EVENT_FROM_RING)
        return;
      const eventType = touchEventType(event);
      const now = Date.now();
      if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        if (now - this.lastDoubleAt < 300) return;
        this.lastDoubleAt = now;
        if (this.routeChoices) {
          const choice = {
            routeId: this.routeChoices.items[this.menuSelected].id,
            version: this.routeChoices.version,
          };
          this.showMessage("正在开始所选路线");
          this.onAction("START_ROUTE", choice);
          return;
        }
        if (
          !this.connected ||
          this.compatibilityLayout ||
          this.displayMessage ||
          !this.latestFrame ||
          !this.lastSubmission ||
          this.latestFrame.version !== this.version
        )
          return;
        if (this.menuOpen) {
          const action = HUD_MENU_ITEMS[this.menuSelected].action;
          this.menuOpen = false;
          if (action === "RETURN_NAVIGATION") {
            if (this.overview) this.onAction("EXIT_OVERVIEW");
            else this.redrawPresentation();
          } else {
            this.redrawPresentation();
            this.onAction(action);
          }
          return;
        }
        this.menuOpen = true;
        this.menuBackground = this.quadrantPixels[1]?.slice();
        this.menuSelected = 0;
        this.redrawPresentation();
        return;
      }
      if (eventType === OsEventTypeList.CLICK_EVENT) return;
      if (
        eventType !== OsEventTypeList.SCROLL_TOP_EVENT &&
        eventType !== OsEventTypeList.SCROLL_BOTTOM_EVENT
      )
        return;
      if (now - this.lastScrollAt < 250) return;
      this.lastScrollAt = now;
      if (this.overview && !this.menuOpen) {
        const next = Math.max(
          0,
          Math.min(
            this.stepPages.length,
            this.stepPage +
              (eventType === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1),
          ),
        );
        if (next !== this.stepPage) {
          this.stepPage = next;
          this.redrawPresentation();
        }
        return;
      }
      if (this.routeChoices) {
        this.menuSelected =
          (this.menuSelected +
            (eventType === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1) +
            this.routeChoices.items.length) %
          this.routeChoices.items.length;
        this.redrawPresentation();
        this.onAction("SELECT_ROUTE", {
          routeId: this.routeChoices.items[this.menuSelected].id,
          version: this.routeChoices.version,
        });
        return;
      }
      if (this.menuOpen) {
        this.menuSelected =
          (this.menuSelected +
            (eventType === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1) +
            HUD_MENU_ITEMS.length) %
          HUD_MENU_ITEMS.length;
        this.redrawPresentation();
        return;
      }
      this.onAction(
        eventType === OsEventTypeList.SCROLL_TOP_EVENT ? "ZOOM_IN" : "ZOOM_OUT",
      );
    });
    this.onHealth(this.connected ? "G2 已连接" : "G2 未连接；请检查蓝牙与设备");
  }
  private receive = (location: AppLocation) => {
    const fix = nativeFix(location);
    if (fix) this.onFix(fix);
    else this.onHealth("定位坐标或绝对时间缺失，等待可靠定位。");
  };
  async locate(): Promise<DeviceFix> {
    if (this.source === "BROWSER_DEV")
      return new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const fix = this.browserFix(position);
            this.onFix(fix);
            resolve(fix);
          },
          () =>
            reject(
              new NavError(
                "LOCATION_UNAVAILABLE",
                "浏览器定位不可用，请检查定位权限。",
              ),
            ),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        ),
      );
    await this.connect();
    const location = await this.bridge!.getAppLocation({
      accuracy: AppLocationAccuracy.High,
      timeoutMs: 10000,
    });
    const fix = location && nativeFix(location);
    if (!fix || Date.now() - fix.timestamp > 15000)
      throw new NavError(
        "LOCATION_UNAVAILABLE",
        "未获得新鲜的手机定位，请检查 Even App 定位权限。",
      );
    this.onFix(fix);
    return fix;
  }
  useBrowserDevelopment() {
    if (this.bridge) throw new Error("Even 连接中不能切换为开发定位");
    this.source = "BROWSER_DEV";
    this.onHealth("浏览器开发定位 · 不代表 G2 或锁屏验收");
  }
  private browserFix(position: GeolocationPosition): DeviceFix {
    return {
      coordinate: {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      },
      timestamp: position.timestamp,
      accuracyMeters: position.coords.accuracy,
      speedMps: position.coords.speed ?? undefined,
      heading: position.coords.heading ?? undefined,
    };
  }
  async startLocation() {
    if (this.locationStopping) await this.locationStopping;
    if (this.subscribed) return;
    if (this.locationStarting) return this.locationStarting;
    this.locationStarting = this.startLocationNative();
    try {
      await this.locationStarting;
    } finally {
      this.locationStarting = undefined;
    }
  }
  private async startLocationNative() {
    if (this.source === "BROWSER_DEV") {
      this.browserWatch = navigator.geolocation.watchPosition(
        (position) => this.onFix(this.browserFix(position)),
        () => this.onHealth("浏览器定位中断"),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } else {
      await this.connect();
      this.unsubscribeLocation = this.bridge!.onAppLocationChanged(
        this.receive,
      );
      if (
        !(await this.bridge!.startAppLocationUpdates({
          accuracy: AppLocationAccuracy.High,
          intervalMs: 1000,
          distanceFilter: 0,
        }))
      ) {
        this.unsubscribeLocation();
        this.unsubscribeLocation = undefined;
        throw new NavError(
          "LOCATION_UNAVAILABLE",
          "Even 持续定位未启动，请检查权限。",
        );
      }
    }
    this.subscribed = true;
  }
  async stopLocation() {
    if (this.locationStopping) return this.locationStopping;
    this.locationStopping = this.stopLocationNative();
    try {
      await this.locationStopping;
    } finally {
      this.locationStopping = undefined;
    }
  }
  private async stopLocationNative() {
    if (this.locationStarting) await this.locationStarting.catch(() => {});
    this.unsubscribeLocation?.();
    this.unsubscribeLocation = undefined;
    if (this.browserWatch !== undefined)
      navigator.geolocation.clearWatch(this.browserWatch);
    this.browserWatch = undefined;
    if (this.bridge && this.subscribed)
      await this.bridge.stopAppLocationUpdates();
    this.subscribed = false;
  }
  setVersion(version: number) {
    if (version !== this.version || this.displayMessage)
      this.resetPresentation();
    this.version = version;
    this.queue.invalidate();
  }
  async close() {
    this.closing = true;
    this.resetPresentation();
    this.queue.invalidate();
    try {
      await this.stopLocation();
      await this.queue.waitForIdle();
      if (
        this.bridge &&
        this.pageCreated &&
        !(await this.bridge.shutDownPageContainer(0))
      )
        throw new Error("插件退出请求失败，请在 Even App 中关闭。");
    } catch (error) {
      this.closing = false;
      throw new NavError(
        "DISPLAY_DISCONNECTED",
        "插件退出请求失败，请在 Even App 中关闭。",
        true,
      );
    }
    this.unsubscribeDevice?.();
    this.unsubscribeEvents?.();
    this.bridge = undefined;
    this.pageCreated = false;
    this.pageFailure = undefined;
    this.quadrantPixels = [];
    this.compatibilityLayout = false;
    this.layoutAnnounced = false;
    this.legacyMapPixels = undefined;
    this.legacyIconKey = undefined;
    this.legacyTextValues.clear();
    this.connected = false;
    this.source = "NONE";
    this.closing = false;
  }
}
