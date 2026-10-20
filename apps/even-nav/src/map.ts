import type {
  Coordinate,
  EndpointCandidate,
  Route,
} from "../../../packages/contracts/src/index";
import { NavError } from "../../../packages/contracts/src/index";
import { WorkerClient } from "./client";

export const MAP_WIDTH = 288,
  MAP_HEIGHT = 144;
export function project(point: Coordinate, zoom: number) {
  const world = 256 * 2 ** zoom;
  const sine = Math.sin(
    (Math.max(-85.05112878, Math.min(85.05112878, point.lat)) * Math.PI) / 180,
  );
  return {
    x: ((point.lng + 180) / 360) * world,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * world,
  };
}
export function unproject(x: number, y: number, zoom: number): Coordinate {
  const world = 256 * 2 ** zoom;
  return {
    lng: (x / world) * 360 - 180,
    lat:
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI,
  };
}
export class NavigationMap {
  readonly canvas = document.createElement("canvas");
  private context: CanvasRenderingContext2D;
  // Only the currently displayed base image is retained. Source tiles are closed immediately.
  private displayedBase?: {
    key: string;
    canvas: HTMLCanvasElement;
    copyright: string;
  };
  private session?: {
    session: string;
    expiry: string | number;
    tileWidth: number;
    tileHeight: number;
  };
  private generation = 0;
  private controller?: AbortController;
  private center?: Coordinate;
  private zoom = 16;
  private viewport?: { key: string; copyright: string };
  attribution = "";
  ready = false;
  constructor(private client: WorkerClient) {
    this.canvas.width = MAP_WIDTH;
    this.canvas.height = MAP_HEIGHT;
    this.canvas.setAttribute("aria-label", "真实道路地图、路线与位置");
    this.context = this.canvas.getContext("2d")!;
    this.clear();
  }
  clear() {
    this.generation++;
    this.controller?.abort();
    this.ready = false;
    this.attribution = "";
    this.center = undefined;
    this.viewport = undefined;
    this.displayedBase = undefined;
    this.context.fillStyle = "#e5e9e3";
    this.context.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  }
  dispose() {
    this.clear();
    this.session = undefined;
  }
  pointFromClick(event: MouseEvent): Coordinate | undefined {
    if (!this.ready || !this.center) return;
    const rect = this.canvas.getBoundingClientRect();
    const center = project(this.center, this.zoom);
    return unproject(
      center.x +
        ((event.clientX - rect.left) / rect.width) * MAP_WIDTH -
        MAP_WIDTH / 2,
      center.y +
        ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT -
        MAP_HEIGHT / 2,
      this.zoom,
    );
  }
  async draw(
    center: Coordinate,
    destination?: EndpointCandidate,
    route?: Route,
    position?: Coordinate,
  ): Promise<void> {
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    const generation = ++this.generation;
    this.ready = false;
    if (route?.basemapProvider === "OPEN_MAP")
      throw new NavError(
        "CONFIG_MISSING",
        "开放底图尚未配置，不能用 Google 图层替换此路线。",
      );
    this.zoom = route?.legs.some((leg) => leg.mode === "DRIVE") ? 15 : 16;
    // Stable view until the position reaches the middle half of the map.
    const previous = this.center && project(this.center, this.zoom);
    const next = project(center, this.zoom);
    if (
      !previous ||
      Math.abs(previous.x - next.x) > MAP_WIDTH / 4 ||
      Math.abs(previous.y - next.y) > MAP_HEIGHT / 4
    )
      this.center = center;
    const c = project(this.center!, this.zoom);
    const west = c.x - MAP_WIDTH / 2,
      north = c.y - MAP_HEIGHT / 2;
    if (!this.session)
      this.session = await this.client.request(
        "/v1/maps/google/session",
        {},
        controller.signal,
      );
    const session = this.session!;
    const expiry =
      typeof session.expiry === "string"
        ? Number(session.expiry)
        : session.expiry;
    if (Number.isFinite(expiry) && expiry * 1000 <= Date.now()) {
      this.session = undefined;
      throw new NavError(
        "PROVIDER_UNAVAILABLE",
        "地图会话已过期，请刷新地图。",
        true,
      );
    }
    const boundsA = unproject(west, north, this.zoom),
      boundsB = unproject(west + MAP_WIDTH, north + MAP_HEIGHT, this.zoom);
    const viewportKey = `${session.session}/${this.zoom}/${west}/${north}`;
    const viewport =
      this.viewport?.key === viewportKey
        ? this.viewport
        : await this.client.request<{ copyright: string }>(
            `/v1/maps/google/viewport?${new URLSearchParams({
              session: session.session,
              zoom: String(this.zoom),
              north: String(boundsA.lat),
              south: String(boundsB.lat),
              west: String(boundsA.lng),
              east: String(boundsB.lng),
            })}`,
            undefined,
            controller.signal,
          );
    if (!viewport.copyright)
      throw new NavError(
        "PROVIDER_UNAVAILABLE",
        "地图版权信息缺失，暂不能显示此地图。",
      );
    if (generation !== this.generation) return;
    this.viewport = { key: viewportKey, copyright: viewport.copyright };
    const offscreen = document.createElement("canvas");
    offscreen.width = MAP_WIDTH;
    offscreen.height = MAP_HEIGHT;
    const ctx = offscreen.getContext("2d")!;
    if (this.displayedBase?.key === viewportKey) {
      ctx.drawImage(this.displayedBase.canvas, 0, 0);
    } else {
      this.displayedBase = undefined;
      const worldTiles = 2 ** this.zoom;
      for (
        let y = Math.floor(north / 256);
        y <= Math.floor((north + MAP_HEIGHT) / 256);
        y++
      ) {
        for (
          let x = Math.floor(west / 256);
          x <= Math.floor((west + MAP_WIDTH) / 256);
          x++
        ) {
          if (y < 0 || y >= worldTiles) continue;
          const tileX = (x + worldTiles) % worldTiles;
          const response = await this.client.fetch(
            `/v1/maps/google/tiles/${this.zoom}/${tileX}/${y}?session=${encodeURIComponent(session.session)}`,
            undefined,
            controller.signal,
          );
          const image = await createImageBitmap(await response.blob());
          try {
            if (generation !== this.generation) return;
            ctx.drawImage(image, x * 256 - west, y * 256 - north, 256, 256);
          } finally {
            image.close();
          }
        }
      }
      const displayed = document.createElement("canvas");
      displayed.width = MAP_WIDTH;
      displayed.height = MAP_HEIGHT;
      displayed.getContext("2d")!.drawImage(offscreen, 0, 0);
      this.displayedBase = {
        key: viewportKey,
        canvas: displayed,
        copyright: viewport.copyright,
      };
    }
    if (generation !== this.generation) return;
    const path = (coordinates: Coordinate[]) => {
      ctx.beginPath();
      coordinates.forEach((point, i) => {
        const p = project(point, this.zoom);
        if (i === 0) ctx.moveTo(p.x - west, p.y - north);
        else ctx.lineTo(p.x - west, p.y - north);
      });
      ctx.stroke();
    };
    if (route)
      for (const leg of route.legs) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 7;
        path(leg.geometry);
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 3;
        ctx.setLineDash(leg.mode === "WALK" ? [5, 3] : []);
        path(leg.geometry);
        ctx.setLineDash([]);
      }
    const marker = (point: Coordinate, radius: number, fill: string) => {
      const p = project(point, this.zoom);
      ctx.beginPath();
      ctx.arc(p.x - west, p.y - north, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = fill === "#fff" ? "#000" : "#fff";
      ctx.stroke();
    };
    if (destination?.coordinate) marker(destination.coordinate, 5, "#fff");
    if (position) marker(position, 6, "#000");
    this.context.drawImage(offscreen, 0, 0);
    this.attribution = `底图 Google Maps · ${viewport.copyright}${route?.attribution.length ? `\n路线 ${[...new Set(route.attribution)].join(" · ")}` : ""}`;
    this.ready = true;
  }
  async pixels(): Promise<Uint8Array> {
    // Official image template specifies encoded bytes; native host converts PNG to 4-bit.
    const blob = await new Promise<Blob>((resolve, reject) =>
      this.canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("PNG encoding failed")),
        "image/png",
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  }
}
