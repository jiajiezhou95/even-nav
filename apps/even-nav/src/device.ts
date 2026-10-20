import type { AppLocation, EvenAppBridge } from "@evenrealities/even_hub_sdk";
import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  TextContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  TextContainerUpgrade,
  ImageRawDataUpdate,
  AppLocationAccuracy,
} from "@evenrealities/even_hub_sdk";
import { isCoordinate, NavError } from "../../../packages/contracts/src/index";
import type { Coordinate } from "../../../packages/contracts/src/index";

export interface DeviceFix {
  coordinate: Coordinate;
  timestamp: number;
  accuracyMeters?: number;
  speedMps?: number;
  heading?: number;
}
export interface HudFrame {
  sequence: number;
  version: number;
  pixels: Uint8Array;
  instruction: string;
  status: string;
  attribution: string;
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
  private pageCreated = false;
  private version = 0;
  connected = false;
  source: "EVEN" | "BROWSER_DEV" | "NONE" = "NONE";
  readonly queue: LatestFrameQueue<HudFrame>;
  lastSubmission?: { sequence: number; at: number; result: string };
  constructor(
    private onFix: (fix: DeviceFix) => void,
    private onHealth: (message: string) => void,
    private onAction: (action: "PAUSE" | "RESUME" | "END") => void,
  ) {
    this.queue = new LatestFrameQueue(
      async (frame) => {
        if (frame.version !== this.version || !this.bridge || !this.connected)
          return;
        if (!this.pageCreated) {
          const result = await this.bridge.createStartUpPageContainer(
            new CreateStartUpPageContainer({
              containerTotalNum: 4,
              imageObject: [
                new ImageContainerProperty({
                  containerID: 1,
                  containerName: "map",
                  xPosition: 0,
                  yPosition: 0,
                  width: 288,
                  height: 144,
                }),
              ],
              textObject: [
                new TextContainerProperty({
                  containerID: 2,
                  containerName: "instruction",
                  xPosition: 300,
                  yPosition: 0,
                  width: 276,
                  height: 144,
                  content: "准备导航",
                  isEventCapture: 1,
                }),
                new TextContainerProperty({
                  containerID: 3,
                  containerName: "status",
                  xPosition: 0,
                  yPosition: 150,
                  width: 576,
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
            }),
          );
          if (result !== 0) throw new Error("G2 容器创建失败");
          this.pageCreated = true;
        }
        if (frame.version !== this.version || !this.connected) return;
        // Text is submitted before the single serialized image; native submission is not optical proof.
        for (const [id, name, content] of [
          [2, "instruction", frame.instruction],
          [3, "status", frame.status],
          [4, "attribution", frame.attribution],
        ] as const) {
          if (frame.version !== this.version || !this.connected) return;
          if (
            !(await this.bridge.textContainerUpgrade(
              new TextContainerUpgrade({
                containerID: id,
                containerName: name,
                content,
              }),
            ))
          )
            throw new Error("G2 文字发送失败");
        }
        if (frame.version !== this.version || !this.connected) return;
        const result = await this.bridge.updateImageRawData(
          new ImageRawDataUpdate({
            containerID: 1,
            containerName: "map",
            imageData: Array.from(frame.pixels),
          }),
        );
        this.lastSubmission = {
          sequence: frame.sequence,
          at: Date.now(),
          result,
        };
        if (result !== "success")
          throw new Error(`G2 图像发送失败 (${result})`);
      },
      () => this.onHealth("G2 发送失败；请检查连接并重新连接。"),
    );
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
    const host = window as Window & {
      flutter_inappwebview?: { callHandler?: unknown };
    };
    if (!host.flutter_inappwebview?.callHandler)
      throw new NavError(
        "DISPLAY_DISCONNECTED",
        "当前不是 Even App。可使用浏览器开发定位预览，不能验证 G2。",
      );
    const sdk = await import("@evenrealities/even_hub_sdk");
    this.bridge = await Promise.race([
      sdk.waitForEvenAppBridge(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Even bridge timeout")), 8000),
      ),
    ]);
    this.source = "EVEN";
    const device = await this.bridge.getDeviceInfo();
    this.connected =
      device?.model === "g2" && device.status.connectType === "connected";
    this.unsubscribeDevice = this.bridge.onDeviceStatusChanged((status) => {
      this.connected = status.connectType === "connected";
      this.queue.invalidate();
      this.onHealth(
        this.connected ? "G2 已连接" : "G2 已断开；手机继续显示导航",
      );
    });
    this.unsubscribeEvents = this.bridge.onEvenHubEvent((event) => {
      const item = event.menuItemClickEvent?.itemID;
      if (item === 1) this.onAction("PAUSE");
      if (item === 2) this.onAction("RESUME");
      if (item === 3) this.onAction("END");
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
          distanceFilter: 2,
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
    this.connected = false;
    this.source = "NONE";
  }
}
