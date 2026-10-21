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
  private zoomOffset = 0;
  private viewport?: { key: string; copyright: string };
  private routePaths: { id: string; points: { x: number; y: number }[] }[] = [];
  private hudOverlay?: (ctx: CanvasRenderingContext2D) => void;
  private previewFrame?: {
    west: number;
    north: number;
    zoom: number;
    routeIds: string[];
  };
  private width = MAP_WIDTH;
  private height = MAP_HEIGHT;
  private get displayScale() {
    return this.width === 576 ? 2 : 1;
  }
  private project(point: Coordinate, zoom: number) {
    const p = project(point, zoom);
    return { x: p.x * this.displayScale, y: p.y * this.displayScale };
  }
  private unproject(x: number, y: number, zoom: number) {
    return unproject(x / this.displayScale, y / this.displayScale, zoom);
  }
  attribution = "";
  ready = false;
  constructor(private client: WorkerClient) {
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.setAttribute("aria-label", "真实道路地图、路线与位置");
    this.context = this.canvas.getContext("2d")!;
    this.clear();
  }
  /** Reproject and fetch the actual viewport; never stretch a smaller map. */
  setSize(width: number, height: number) {
    if (!(
      (width === 288 && height === 144) ||
      (width === 576 && height === 192)
    ))
      throw new Error("Unsupported navigation map viewport");
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.session = undefined;
    this.clear();
  }
  /** Zoom changes only map coverage; caller restricts this to active navigation. */
  adjustZoom(delta: 1 | -1): boolean {
    const next = Math.max(-2, Math.min(2, this.zoomOffset + delta));
    if (next === this.zoomOffset) return false;
    this.zoomOffset = next;
    return true;
  }
  clear() {
    this.generation++;
    this.controller?.abort();
    this.ready = false;
    this.attribution = "";
    this.center = undefined;
    this.viewport = undefined;
    this.displayedBase = undefined;
    this.routePaths = [];
    this.hudOverlay = undefined;
    this.previewFrame = undefined;
    this.context.fillStyle = "#e5e9e3";
    this.context.fillRect(0, 0, this.width, this.height);
  }
  dispose() {
    this.clear();
    this.session = undefined;
    this.zoomOffset = 0;
  }
  routeFromClick(event: MouseEvent): string | undefined {
    if (!this.ready) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * this.width;
    const y = ((event.clientY - rect.top) / rect.height) * this.height;
    let nearest = 12,
      selected: string | undefined;
    for (const route of this.routePaths)
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1],
          b = route.points[i];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
        const d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
        if (d < nearest) {
          nearest = d;
          selected = route.id;
        }
      }
    return selected;
  }
  /** Paint a candidate from the active tile image; never fetch or retain another viewport. */
  paintRoutePreview(canvas: HTMLCanvasElement, route: Route): boolean {
    const frame = this.previewFrame;
    if (
      !this.ready ||
      !this.displayedBase ||
      !frame?.routeIds.includes(route.id) ||
      !route.legs.some((leg) => leg.geometry.length > 1)
    )
      return false;
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(this.displayedBase.canvas, 0, 0);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const leg of route.legs) {
      for (const [color, width] of [
        ["#fff", 7],
        ["#163e30", 3],
      ] as const) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(color !== "#fff" && leg.mode === "WALK" ? [5, 3] : []);
        leg.geometry.forEach((point, i) => {
          const p = this.project(point, frame.zoom);
          if (i === 0) ctx.moveTo(p.x - frame.west, p.y - frame.north);
          else ctx.lineTo(p.x - frame.west, p.y - frame.north);
        });
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    const points = route.legs.flatMap((leg) => leg.geometry);
    for (const [point, end] of [
      [points[0], false],
      [points.at(-1), true],
    ] as const) {
      if (!point) continue;
      const p = this.project(point, frame.zoom);
      ctx.beginPath();
      ctx.arc(p.x - frame.west, p.y - frame.north, 5, 0, Math.PI * 2);
      ctx.fillStyle = end ? "#fff" : "#163e30";
      ctx.fill();
      ctx.strokeStyle = end ? "#163e30" : "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    return true;
  }
  get previewCopyright() {
    return this.ready ? this.displayedBase?.copyright || "" : "";
  }
  async draw(
    center: Coordinate,
    destination?: EndpointCandidate,
    route?: Route,
    position?: Coordinate,
    alternatives: Route[] = [],
    movement?: { bearing: number; timestamp: number; maxAgeMs: number },
  ): Promise<void> {
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    const generation = ++this.generation;
    const displayScale = this.displayScale;
    this.ready = false;
    if (
      route?.basemapProvider === "OPEN_MAP" ||
      alternatives.some((item) => item.basemapProvider === "OPEN_MAP")
    )
      throw new NavError(
        "CONFIG_MISSING",
        "开放底图尚未配置，不能用 Google 图层替换此路线。",
      );
    const previousZoom = this.zoom;
    this.zoom =
      (route?.legs.some((leg) => leg.mode === "DRIVE") ? 15 : 16) +
      this.zoomOffset;
    const overview = alternatives.slice(0, 3);
    if (overview.length) {
      const points = overview.flatMap((item) =>
        item.legs.flatMap((leg) => leg.geometry),
      );
      if (points.length) {
        const bounds = points.reduce(
          (bounds, point) => {
            const p = this.project(point, 0);
            return {
              left: Math.min(bounds.left, p.x),
              right: Math.max(bounds.right, p.x),
              top: Math.min(bounds.top, p.y),
              bottom: Math.max(bounds.bottom, p.y),
            };
          },
          {
            left: Infinity,
            right: -Infinity,
            top: Infinity,
            bottom: -Infinity,
          },
        );
        for (this.zoom = 18; this.zoom > 2; this.zoom--) {
          const width = (bounds.right - bounds.left) * 2 ** this.zoom;
          const height = (bounds.bottom - bounds.top) * 2 ** this.zoom;
          if (width <= this.width - 40 && height <= this.height - 40) break;
        }
        this.center = this.unproject(
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
          0,
        );
      }
    }
    const zoom = this.zoom;
    if (!this.center) this.center = center;
    // Stable view until the position reaches the middle half of the map.
    const previous = this.center && this.project(this.center, zoom);
    const next = this.project(center, zoom);
    if (
      !overview.length &&
      (!previous ||
        previousZoom !== zoom ||
        Math.abs(previous.x - next.x) > this.width / 4 ||
        Math.abs(previous.y - next.y) > this.height / 4)
    )
      this.center = center;
    const c = this.project(this.center!, zoom);
    const west = c.x - this.width / 2,
      north = c.y - this.height / 2;
    if (!this.session)
      this.session = await this.client.request(
        "/v1/maps/google/session",
        displayScale === 2 ? { display: "G2" } : {},
        controller.signal,
      );
    const session = this.session!;
    const tileSize = 256 * displayScale;
    if (session.tileWidth !== tileSize || session.tileHeight !== tileSize) {
      this.session = undefined;
      throw new NavError(
        "PROVIDER_UNAVAILABLE",
        "地图分辨率不匹配，请刷新地图。",
        true,
      );
    }
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
    const boundsA = this.unproject(west, north, zoom),
      boundsB = this.unproject(west + this.width, north + this.height, zoom);
    const viewportKey = `${session.session}/${zoom}/${west}/${north}`;
    const viewport =
      this.viewport?.key === viewportKey
        ? this.viewport
        : await this.client.request<{ copyright: string }>(
            `/v1/maps/google/viewport?${new URLSearchParams({
              session: session.session,
              zoom: String(zoom),
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
    offscreen.width = this.width;
    offscreen.height = this.height;
    const ctx = offscreen.getContext("2d")!;
    if (this.displayedBase?.key === viewportKey) {
      ctx.drawImage(this.displayedBase.canvas, 0, 0);
    } else {
      this.displayedBase = undefined;
      const worldTiles = 2 ** zoom;
      for (
        let y = Math.floor(north / tileSize);
        y <= Math.floor((north + this.height) / tileSize);
        y++
      ) {
        for (
          let x = Math.floor(west / tileSize);
          x <= Math.floor((west + this.width) / tileSize);
          x++
        ) {
          if (y < 0 || y >= worldTiles) continue;
          const tileX = (x + worldTiles) % worldTiles;
          const response = await this.client.fetch(
            `/v1/maps/google/tiles/${zoom}/${tileX}/${y}?session=${encodeURIComponent(session.session)}`,
            undefined,
            controller.signal,
          );
          const image = await createImageBitmap(await response.blob());
          try {
            if (generation !== this.generation) return;
            ctx.drawImage(
              image,
              x * tileSize - west,
              y * tileSize - north,
              tileSize,
              tileSize,
            );
          } finally {
            image.close();
          }
        }
      }
      const displayed = document.createElement("canvas");
      displayed.width = this.width;
      displayed.height = this.height;
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
        const p = this.project(point, zoom);
        if (i === 0) ctx.moveTo(p.x - west, p.y - north);
        else ctx.lineTo(p.x - west, p.y - north);
      });
      ctx.stroke();
    };
    const visibleRoutes = overview.length ? overview : route ? [route] : [];
    this.routePaths = [];
    const drawingOrder = [
      ...visibleRoutes.filter((item) => item.id !== route?.id),
      ...visibleRoutes.filter((item) => item.id === route?.id),
    ];
    for (const item of drawingOrder)
      for (const leg of item.legs) {
        this.routePaths.push({
          id: item.id,
          points: leg.geometry.map((point) => {
            const p = this.project(point, zoom);
            return { x: p.x - west, y: p.y - north };
          }),
        });
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = (item.id === route?.id ? 7 : 5) * displayScale;
        path(leg.geometry);
        ctx.strokeStyle = item.id === route?.id ? "#163e30" : "#929f97";
        ctx.lineWidth = (item.id === route?.id ? 3 : 2) * displayScale;
        ctx.setLineDash(
          leg.mode === "WALK" ? [5 * displayScale, 3 * displayScale] : [],
        );
        path(leg.geometry);
        ctx.setLineDash([]);
      }
    if (overview.length)
      overview.forEach((item, i) => {
        const points = item.legs.flatMap((leg) => leg.geometry);
        if (!points.length) return;
        const a = this.project(
          points[Math.max(0, Math.floor(points.length / 2) - 1)],
          zoom,
        );
        const b = this.project(points[Math.floor(points.length / 2)], zoom);
        const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.fillStyle = item.id === route?.id ? "#163e30" : "#66766e";
        ctx.beginPath();
        ctx.arc(p.x - west, p.y - north, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), p.x - west, p.y - north);
      });
    const marker = (point: Coordinate, radius: number, fill: string) => {
      const p = this.project(point, zoom);
      ctx.beginPath();
      ctx.arc(p.x - west, p.y - north, radius * displayScale, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = fill === "#fff" ? "#000" : "#fff";
      ctx.stroke();
    };
    const drawDirection = (
      target: CanvasRenderingContext2D,
      color: string,
      halo: string,
    ) => {
      if (
        !position ||
        !movement ||
        !Number.isFinite(movement.bearing) ||
        movement.bearing < 0 ||
        movement.bearing >= 360 ||
        Date.now() < movement.timestamp ||
        Date.now() - movement.timestamp > movement.maxAgeMs
      )
        return;
      const p = this.project(position, zoom);
      target.save();
      target.translate(p.x - west, p.y - north);
      target.scale(displayScale, displayScale);
      target.rotate((movement.bearing * Math.PI) / 180);
      target.beginPath();
      target.moveTo(0, -19);
      target.lineTo(-6, -8);
      target.lineTo(0, -10);
      target.lineTo(6, -8);
      target.closePath();
      target.fillStyle = color;
      target.fill();
      target.strokeStyle = halo;
      target.lineWidth = 1.5;
      target.stroke();
      target.restore();
    };
    if (destination?.coordinate) marker(destination.coordinate, 5, "#fff");
    if (position) marker(position, 6, "#000");
    drawDirection(ctx, "#163e30", "#fff");
    this.hudOverlay = (hud) => {
      hud.lineJoin = "round";
      hud.lineCap = "round";
      for (const leg of route?.legs || []) {
        const stroke = (color: string, width: number) => {
          hud.strokeStyle = color;
          hud.lineWidth = width;
          hud.beginPath();
          leg.geometry.forEach((point, i) => {
            const p = this.project(point, zoom);
            if (i === 0) hud.moveTo(p.x - west, p.y - north);
            else hud.lineTo(p.x - west, p.y - north);
          });
          hud.stroke();
        };
        stroke("#000", 7 * displayScale);
        stroke("#fff", 3 * displayScale);
      }
      for (const [point, current] of [
        [destination?.coordinate, false],
        [position, true],
      ] as const) {
        if (!point) continue;
        const p = this.project(point, zoom);
        hud.beginPath();
        hud.arc(
          p.x - west,
          p.y - north,
          (current ? 6 : 5) * displayScale,
          0,
          Math.PI * 2,
        );
        hud.fillStyle = current ? "#fff" : "#000";
        hud.fill();
        hud.strokeStyle = current ? "#000" : "#fff";
        hud.lineWidth = 2 * displayScale;
        hud.stroke();
      }
      drawDirection(hud, "#fff", "#000");
    };
    this.context.drawImage(offscreen, 0, 0);
    const routeAttribution = [
      ...new Set(visibleRoutes.flatMap((item) => item.attribution)),
    ];
    this.attribution = `Google Maps · ${viewport.copyright}${routeAttribution.length ? `\n${routeAttribution.join(" · ")}` : ""}`;
    this.canvas.setAttribute(
      "aria-label",
      overview.length
        ? `路线比较地图，${overview.length} 条路线，已选择路线 ${overview.findIndex((item) => item.id === route?.id) + 1}`
        : "道路地图、路线与位置",
    );
    this.ready = true;
    this.previewFrame = {
      west,
      north,
      zoom,
      routeIds: visibleRoutes.map((item) => item.id),
    };
  }
  async pixels(): Promise<Uint8Array> {
    const hud = document.createElement("canvas");
    hud.width = this.width;
    hud.height = this.height;
    const ctx = hud.getContext("2d")!;
    ctx.drawImage(this.displayedBase?.canvas || this.canvas, 0, 0);
    const image = ctx.getImageData(0, 0, this.width, this.height);
    // Transform the actual tile pixels only; no synthetic road or edge geometry.
    // G2's physical green display renders white pixels bright and black pixels dark.
    for (let i = 0; i < image.data.length; i += 4) {
      const luminance =
        image.data[i] * 0.2126 +
        image.data[i + 1] * 0.7152 +
        image.data[i + 2] * 0.0722;
      const value = Math.max(0, Math.min(210, (245 - luminance) * 2.5));
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    }
    ctx.putImageData(image, 0, 0);
    this.hudOverlay?.(ctx);
    // Official image template specifies encoded bytes; native host converts PNG to 4-bit.
    const blob = await new Promise<Blob>((resolve, reject) =>
      hud.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("PNG encoding failed")),
        "image/png",
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  }
}
