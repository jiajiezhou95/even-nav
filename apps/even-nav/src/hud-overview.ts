import { HUD_QUADRANTS, wrapHudText } from "./hud-renderer";
import type { HudFrame } from "./device";
import type { HudStepPage } from "./hud-menu";

/** Full-map first page or full-width text; the native four-container layout never changes. */
export async function renderHudOverview(frame: HudFrame, page?: HudStepPage) {
  const canvas = document.createElement("canvas");
  canvas.width = 576;
  canvas.height = 288;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 576, 288);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  if (page) {
    ctx.font = '22px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(`完整行程 ${page.page}/${page.pages}`, 12, 6);
    page.lines.forEach((line, i) =>
      ctx.fillText(line.replace(/[\r\n]/g, ""), 12, 36 + i * 24),
    );
    ctx.font = '18px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(
      `${page.page === page.pages ? "已到列表末尾" : "向下继续"} · 向上查看 · 双击菜单`,
      12,
      266,
    );
  } else {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(frame.pixels)], { type: "image/png" }),
    );
    try {
      if (bitmap.width !== 576 || bitmap.height !== 256)
        throw new Error("Overview map dimensions mismatch");
      ctx.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
    ctx.font = '13px "Microsoft YaHei", "PingFang SC", sans-serif';
    const branded = /^Google Maps(?:\s*·\s*|\n|$)/.test(frame.attribution);
    const copyright = branded
      ? frame.attribution.replace(/^Google Maps(?:\s*·\s*|\n|$)/, "")
      : frame.attribution;
    const left = branded ? 116 : 8;
    const lines = wrapHudText(
      copyright,
      350 - left,
      (text) => ctx.measureText(text).width,
    );
    const height = Math.max(32, lines.length * 15 + 2);
    if (height > 256) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 576, 288);
      ctx.fillStyle = "#fff";
      ctx.font = '21px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.fillText("版权信息过长，地图暂不可显示", 8, 12);
    } else {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 288 - height, 576, height);
      ctx.fillStyle = "#fff";
      lines.forEach((line, i) =>
        ctx.fillText(line, left, 290 - height + i * 15),
      );
      ctx.fillText("滑动查看行程 · 双击菜单", 365, 290 - height);
      if (branded) {
        ctx.font = "16px Arial, sans-serif";
        ctx.fillText("Google Maps", 8, 288 - height + (height - 18) / 2);
      }
    }
  }
  return Promise.all(
    HUD_QUADRANTS.map(async (tile) => {
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
              : reject(new Error("Overview PNG encoding failed")),
          "image/png",
        ),
      );
      return new Uint8Array(await blob.arrayBuffer());
    }),
  );
}
