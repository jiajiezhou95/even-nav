import { HUD_QUADRANTS } from "./hud-renderer";

export const HUD_MENU_ITEMS = [
  { label: "查看路线", action: "VIEW_ROUTE" },
  { label: "放大地图", action: "ZOOM_IN" },
  { label: "缩小地图", action: "ZOOM_OUT" },
  { label: "重选路线", action: "RESELECT_ROUTE" },
  { label: "返回导航", action: "RETURN_NAVIGATION" },
] as const;

export interface HudRouteChoice {
  id: string;
  summary: string;
}

/** Draw into the existing four image containers; never rebuild the native page. */
export async function renderHudMenu(
  selected: number,
  message?: string,
  routes?: readonly HudRouteChoice[],
) {
  const canvas = document.createElement("canvas");
  canvas.width = 576;
  canvas.height = 288;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 576, 288);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.font = '26px "Microsoft YaHei", "PingFang SC", sans-serif';
  if (message) {
    ctx.fillText(message, 24, 140);
  } else {
    ctx.fillText(routes ? "选择路线" : "导航菜单", 24, 28);
    const items = routes
      ? routes.map((route, i) => ({
          label: `路线 ${i + 1}   ${route.summary}`,
        }))
      : HUD_MENU_ITEMS;
    items.forEach((item, index) => {
      const y = 56 + index * (routes ? 56 : 38);
      ctx.fillStyle = index === selected ? "#fff" : "#000";
      ctx.fillRect(16, y, 544, routes ? 48 : 34);
      ctx.fillStyle = index === selected ? "#000" : "#fff";
      ctx.fillText(item.label, 32, y + (routes ? 24 : 17));
    });
    ctx.fillStyle = "#fff";
    ctx.font = '18px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(
      routes
        ? "滑动选择 · 单击开始 · 双击取消"
        : "滑动选择 · 单击确认 · 双击返回",
      24,
      264,
    );
  }
  const images: Uint8Array[] = [];
  for (const tile of HUD_QUADRANTS) {
    const part = document.createElement("canvas");
    part.width = 288;
    part.height = 144;
    part
      .getContext("2d")!
      .drawImage(canvas, tile.x, tile.y, 288, 144, 0, 0, 288, 144);
    const blob = await new Promise<Blob>((resolve, reject) =>
      part.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Menu PNG encoding failed")),
        "image/png",
      ),
    );
    images.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return images;
}
