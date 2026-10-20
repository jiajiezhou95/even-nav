import type { AppLocation, EvenAppBridge } from "@evenrealities/even_hub_sdk";
import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  TextContainerProperty,
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
import { HUD_QUADRANTS, renderHud } from "./hud-renderer";
import type { GuidanceView } from "./guidance";

export interface DeviceFix {
  coordinate: Coordinate;
  timestamp: number;
  accuracyMeters?: number;
  speedMps?: number;
  heading?: number;
}
export type DeviceAction = "PAUSE" | "RESUME" | "END" | "ZOOM_IN" | "ZOOM_OUT";
export interface HudFrame {
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
  private pending?: T;
  private active = false;
  private epoch = 0;
  constructor(
    private send: (value: T) => Promise<void>,
    private failed: (error: unknown) => void,
  ) {}
  push(value: T) {
    this.pending = value;
    if (!this.active) void this.drain();
  }
  invalidate() {
    this.epoch++;
    this.pending = undefined;
  }
  get inFlight() {
    return this.active;
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
  private locationStarting?: Promise<void>;
  private locationStopping?: Promise<void>;
  private pageCreated = false;
  private quadrantPixels: Uint8Array[] = [];
  private pageStarting?: Promise<void>;
  private version = 0;
  private lastScrollAt = -Infinity;
  connected = false;
  source: "EVEN" | "BROWSER_DEV" | "NONE" = "NONE";
  readonly queue: LatestFrameQueue<HudFrame>;
  lastSubmission?: { sequence: number; at: number; result: string };
  constructor(
    private onFix: (fix: DeviceFix) => void,
    private onHealth: (message: string) => void,
    private onAction: (action: DeviceAction) => void,
  ) {
    this.queue = new LatestFrameQueue(
      async (frame) => {
        if (frame.version !== this.version || !this.bridge || !this.connected)
          return;
        await this.ensurePage();
        if (frame.version !== this.version || !this.connected) return;
        const quadrants = await renderHud(frame);
        // One serialized queue; check generation between every native write.
        for (const [index, tile] of HUD_QUADRANTS.entries()) {
          if (frame.version !== this.version || !this.connected) return;
          const pixels = quadrants[index];
          const previous = this.quadrantPixels[index];
          if (
            previous?.length === pixels.length &&
            pixels.every((value, i) => value === previous[i])
          )
            continue;
          const result = await this.bridge.updateImageRawData(
            new ImageRawDataUpdate({
              containerID: tile.id,
              containerName: tile.name,
              imageData: Array.from(pixels),
            }),
          );
          if (result !== "success")
            throw new Error(`G2 图像发送失败 (${result})`);
          if (frame.version !== this.version || !this.connected) return;
          this.quadrantPixels[index] = pixels.slice();
        }
        this.lastSubmission = {
          sequence: frame.sequence,
          at: Date.now(),
          result: "success",
        };
      },
      () => this.onHealth("G2 发送失败；请检查连接并重新连接。"),
    );
  }
  private async ensurePage() {
    if (this.pageCreated) return;
    if (!this.bridge || !this.connected) throw new Error("请先连接 G2");
    if (this.pageStarting) return this.pageStarting;
    this.pageStarting = this.createPage();
    try {
      await this.pageStarting;
    } finally {
      this.pageStarting = undefined;
    }
  }
  private async createPage() {
    const result = await this.bridge!.createStartUpPageContainer(
      new CreateStartUpPageContainer({
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
              zOrderIndex: tile.id,
            }),
        ),
        // Retain one native event surface below the raster, including IMU readiness.
        textObject: [
          new TextContainerProperty({
            containerID: 5,
            containerName: "hud-events",
            xPosition: 0,
            yPosition: 0,
            width: 576,
            height: 288,
            content: " ",
            isEventCapture: 1,
            zOrderIndex: 0,
          }),
        ],
        menuObject: new MenuContainerProperty({
          menuItems: [
            new MenuItemProperty({ itemID: 1, itemName: "暂停" }),
            new MenuItemProperty({ itemID: 2, itemName: "继续" }),
            new MenuItemProperty({ itemID: 3, itemName: "结束" }),
          ],
        }),
      }),
    );
    if (result !== 0) throw new Error("G2 容器创建失败");
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
    if (this.bridge) return;
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
      this.connected = status.connectType === "connected";
      this.queue.invalidate();
      this.quadrantPixels = [];
      this.onHealth(
        this.connected ? "G2 已连接" : "G2 已断开；手机继续显示导航",
      );
    });
    this.unsubscribeEvents = this.bridge.onEvenHubEvent((event) => {
      const item = event.menuItemClickEvent?.itemID;
      if (item === 1) this.onAction("PAUSE");
      if (item === 2) this.onAction("RESUME");
      if (item === 3) this.onAction("END");
      if (item !== undefined) return;
      if (event.sysEvent?.eventSource === EventSourceType.TOUCH_EVENT_FROM_RING)
        return;
      const eventType =
        event.sysEvent?.eventType ??
        event.textEvent?.eventType ??
        event.listEvent?.eventType;
      if (
        eventType !== OsEventTypeList.SCROLL_TOP_EVENT &&
        eventType !== OsEventTypeList.SCROLL_BOTTOM_EVENT
      )
        return;
      const now = Date.now();
      if (now - this.lastScrollAt < 250) return;
      this.lastScrollAt = now;
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
    this.version = version;
    this.queue.invalidate();
  }
  async close() {
    this.queue.invalidate();
    await this.stopLocation();
    this.unsubscribeDevice?.();
    this.unsubscribeEvents?.();
    if (this.bridge && this.pageCreated)
      await this.bridge.shutDownPageContainer(0);
    this.bridge = undefined;
    this.pageCreated = false;
    this.quadrantPixels = [];
    this.connected = false;
    this.source = "NONE";
  }
}
