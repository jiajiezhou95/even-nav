import { HUD_QUADRANTS } from "./hud-renderer";

export const HUD_MENU_ITEMS = [
  { label: "查看路线", action: "VIEW_ROUTE" },
  { label: "放大地图", action: "ZOOM_IN" },
  { label: "缩小地图", action: "ZOOM_OUT" },
  { label: "重选路线", action: "RESELECT_ROUTE" },
  { label: "返回导航", action: "RETURN_NAVIGATION" },
  { label: "退出插件", action: "EXIT_APP" },
] as const;

export interface HudRouteChoice {
  id: string;
  summary: string;
}

export interface HudRouteStep {
  text: string;
  current: boolean;
}
export interface HudStepPage {
  lines: string[];
  step: number;
  total: number;
  current: boolean;
  page: number;
  pages: number;
}

/** Break by measured glyph width, retaining every character across page boundaries. */
export function buildHudStepPages(
  steps: readonly HudRouteStep[],
  measure?: (text: string) => number,
): HudStepPage[] {
  if (!measure) {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = '22px "Microsoft YaHei", "PingFang SC", sans-serif';
    measure = (text) => ctx.measureText(text).width;
  }
  const all: { text: string; step: number; current: boolean }[] = [];
  steps.forEach((step, index) => {
    const lines: string[] = [];
    let line = "";
    for (const char of step.text) {
      if (char === "\n") {
        lines.push(line + char);
        line = "";
        continue;
      }
      if (line && measure!(line + char) > 552) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    if (line || !lines.length) lines.push(line);
    all.push({
      text: `步骤 ${index + 1}/${steps.length}${step.current ? " · 当前" : ""}`,
      step: index + 1,
      current: step.current,
    });
    all.push(
      ...lines.map((text) => ({
        text,
        step: index + 1,
        current: step.current,
      })),
    );
  });
  const pages = Math.ceil(all.length / 9);
  return Array.from({ length: pages }, (_, page) => {
    const rows = all.slice(page * 9, page * 9 + 9);
    return {
      lines: rows.map((row) => row.text),
      step: rows[0].step,
      total: steps.length,
      current: rows.some((row) => row.current),
      page: page + 1,
      pages,
    };
  });
}

export async function renderHudListTile(
  background: Uint8Array | undefined,
  content:
    | { routes: readonly HudRouteChoice[]; selected: number }
    | { page: HudStepPage },
) {
  const canvas = document.createElement("canvas");
  canvas.width = 288;
  canvas.height = 144;
  const ctx = canvas.getContext("2d")!;
  if (background) {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(background)], { type: "image/png" }),
    );
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(108, 0, 180, 144);
  ctx.strokeStyle = "#fff";
  ctx.strokeRect(108.5, 0.5, 179, 143);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.font = '20px "Microsoft YaHei", "PingFang SC", sans-serif';
  if ("routes" in content) {
    content.routes.forEach((route, i) => {
      const y = 14 + i * 46;
      if (i === content.selected) ctx.fillText("›", 115, y);
      ctx.fillText(`路线 ${i + 1}`, 133, y);
      const summary = route.summary.replace(/\s+/g, "");
      ctx.font = '20px "Microsoft YaHei", "PingFang SC", sans-serif';
      const width = ctx.measureText(summary).width;
      if (width > 162)
        ctx.font = `${(20 * 162) / width}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.fillText(summary, 117, y + 22);
      ctx.font = '20px "Microsoft YaHei", "PingFang SC", sans-serif';
    });
  } else {
    const page = content.page;
    ctx.font = '18px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(
      `${page.step}/${page.total}${page.current ? " · 当前" : ""}`,
      117,
      15,
    );
    ctx.font = '20px "Microsoft YaHei", "PingFang SC", sans-serif';
    page.lines.forEach((line, i) =>
      ctx.fillText(line.replace(/[\r\n]/g, ""), 117, 43 + i * 22),
    );
    ctx.font = '16px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(`${page.page}/${page.pages}页 · 双击菜单`, 117, 132);
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("List PNG encoding failed")),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Only h1 changes: keep the rest of the last navigation presentation visible. */
export async function renderHudMenuTile(
  selected: number,
  background?: Uint8Array,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 288;
  canvas.height = 144;
  const ctx = canvas.getContext("2d")!;
  if (background) {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(background)], { type: "image/png" }),
    );
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(108, 0, 180, 144);
  ctx.strokeStyle = "#fff";
  ctx.strokeRect(108.5, 0.5, 179, 143);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.font = '20px "Microsoft YaHei", "PingFang SC", sans-serif';
  HUD_MENU_ITEMS.forEach((item, index) => {
    const y = 17 + index * 22;
    if (index === selected) ctx.fillText("›", 119, y);
    ctx.fillText(item.label, 138, y);
  });
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Menu PNG encoding failed")),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
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
        ? "滑动选择 · 双击开始"
        : "滑动选择 · 双击确认",
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
