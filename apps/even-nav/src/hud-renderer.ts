import type { GuidanceView } from "./guidance";
import { maneuverPng } from "./maneuver-icons";

export const HUD_WIDTH = 576;
export const HUD_HEIGHT = 288;
export const HUD_MAP_WIDTH = 576;
export const HUD_MAP_HEIGHT = 192;
export const HUD_QUADRANTS = [
  { id: 1, name: "h0", x: 0, y: 0 },
  { id: 2, name: "h1", x: 288, y: 0 },
  { id: 3, name: "h2", x: 0, y: 144 },
  { id: 4, name: "h3", x: 288, y: 144 },
] as const;

export interface HudContent {
  pixels: Uint8Array;
  instruction: string;
  status: string;
  attribution: string;
  guidance?: GuidanceView;
}

/** Character wrapping also handles CJK and unbroken attribution without ellipses. */
export function wrapHudText(
  value: string,
  width: number,
  measure: (value: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (line && measure(line + char) > width) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}

/** Fit only inside the fixed 64px header, reserving four pixels on each edge. */
export function fitHudHeader(
  text: string,
  width: number,
  measure: (value: string, fontSize: number) => number,
  retainedSuffix = "",
) {
  for (let fontSize = 21; fontSize >= 14; fontSize--) {
    const lineHeight = fontSize + 3;
    const lines = wrapHudText(text, width, (value) => measure(value, fontSize));
    if (lines.length * lineHeight <= 56) return { lines, fontSize, lineHeight };
  }
  const fontSize = 14,
    lineHeight = 17;
  // Keep the primary cue prefix and its distance even when the route name is extreme.
  const characters = Array.from(
    retainedSuffix && text.endsWith(retainedSuffix)
      ? text.slice(0, -retainedSuffix.length)
      : text,
  );
  while (characters.length) {
    characters.pop();
    const candidate = `${characters.join("").trimEnd()}…${retainedSuffix ? ` ${retainedSuffix}` : ""}`;
    const lines = wrapHudText(candidate, width, (value) =>
      measure(value, fontSize),
    );
    if (lines.length * lineHeight <= 56) return { lines, fontSize, lineHeight };
  }
  return { lines: ["…"], fontSize, lineHeight };
}

export function hudCueText(view: GuidanceView) {
  const distance = view.distance
    ?.replace(/^本段剩余 /, "")
    .replace(/ km$/, " 公里")
    .replace(/ m$/, " 米");
  return {
    current: `${view.action}${distance ? ` ${distance}` : ""}`,
    next: view.next ? `然后${view.next.replace(/^向/, "")}` : "",
  };
}

async function bitmap(pixels: Uint8Array) {
  return createImageBitmap(
    new Blob([pixels.slice().buffer], { type: "image/png" }),
  );
}
async function png(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("HUD PNG encoding failed")),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Actual production compositor; white pixels become green in the optical display. */
export async function drawHudCanvas(
  frame: HudContent,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = HUD_WIDTH;
  canvas.height = HUD_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, HUD_WIDTH, HUD_HEIGHT);
  let guidance = frame.guidance;
  let instruction = frame.instruction;
  try {
    const map = await bitmap(frame.pixels);
    try {
      if (map.width !== HUD_MAP_WIDTH || map.height !== HUD_MAP_HEIGHT)
        throw new Error("G2 map must be a real 576 × 192 viewport");
      ctx.drawImage(map, 0, 64);
    } finally {
      map.close();
    }
  } catch {
    // Replace an invalid or missing map with a visible safe state, never stale turns.
    guidance = undefined;
    instruction = "地图图像不可用，暂停转向指示";
  }
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.font = '21px "Microsoft YaHei", "PingFang SC", sans-serif';
  const drawLines = (
    lines: string[],
    x: number,
    y: number,
    lineHeight: number,
  ) => lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  const drawFittedHeader = (
    message: string,
    x: number,
    width: number,
    suffix = "",
  ) => {
    const fit = fitHudHeader(
      message,
      width,
      (value, size) => {
        ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
        return ctx.measureText(value).width;
      },
      suffix,
    );
    ctx.font = `${fit.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 4, width, 56);
    ctx.clip();
    drawLines(
      fit.lines,
      x,
      (64 - fit.lines.length * fit.lineHeight) / 2,
      fit.lineHeight,
    );
    ctx.restore();
  };
  if (guidance) {
    const view = guidance;
    const cues = hudCueText(view);
    for (const [text, icon, x] of [
      [cues.current, view.icon, 12],
      [cues.next, view.nextIcon, 328],
    ] as const) {
      if (!text) continue;
      if (icon && icon !== "none") {
        const image = await bitmap(await maneuverPng(icon));
        try {
          ctx.drawImage(image, x, 8, 48, 48);
        } finally {
          image.close();
        }
      }
      const textX = x + (icon && icon !== "none" ? 58 : 0);
      const width = x === 12 ? 288 - textX : 568 - textX;
      drawFittedHeader(
        text,
        textX,
        width,
        x === 12 && view.distance
          ? cues.current.slice(view.action.length).trim()
          : "",
      );
    }
  } else {
    // Map/provider failure uses the existing safety message, with no turn arrows.
    drawFittedHeader(instruction, 8, 560);
  }

  const hasGoogleBrand = /^Google Maps(?:\s*·\s*|\n|$)/.test(frame.attribution);
  const copyright = hasGoogleBrand
    ? frame.attribution.replace(/^Google Maps(?:\s*·\s*|\n|$)/, "")
    : frame.attribution;
  ctx.font = '12px "Microsoft YaHei", "PingFang SC", sans-serif';
  const copyrightX = 2;
  const copyrightLines = wrapHudText(
    `${hasGoogleBrand ? "Google Maps\n" : ""}${copyright}`,
    196,
    (v) => ctx.measureText(v).width,
  );
  ctx.font = '13px "Microsoft YaHei", "PingFang SC", sans-serif';
  const statusLines = wrapHudText(
    frame.status,
    366,
    (v) => ctx.measureText(v).width,
  );
  const footerHeight = Math.max(
    32,
    Math.max(copyrightLines.length * 13, statusLines.length * 15) + 2,
  );
  // Expand over the lower map for long copyright rather than shrink or truncate it.
  // Pathologically long content hides the map entirely, never uncredited map output.
  if (footerHeight > 224) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, HUD_WIDTH, HUD_HEIGHT);
    ctx.fillStyle = "#fff";
    ctx.font = '21px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText("版权信息过长，地图暂不可显示", 8, 12);
    return canvas;
  }
  const footerY = HUD_HEIGHT - footerHeight;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, footerY, HUD_WIDTH, footerHeight);
  ctx.fillStyle = "#fff";
  ctx.font = '12px "Microsoft YaHei", "PingFang SC", sans-serif';
  drawLines(copyrightLines, copyrightX, footerY + 2, 13);
  ctx.font = '13px "Microsoft YaHei", "PingFang SC", sans-serif';
  drawLines(statusLines, 208, footerY + 2, 15);
  return canvas;
}

export async function renderHud(frame: HudContent): Promise<Uint8Array[]> {
  const canvas = await drawHudCanvas(frame);
  const images: Uint8Array[] = [];
  for (const tile of HUD_QUADRANTS) {
    const quadrant = document.createElement("canvas");
    quadrant.width = 288;
    quadrant.height = 144;
    quadrant
      .getContext("2d")!
      .drawImage(canvas, tile.x, tile.y, 288, 144, 0, 0, 288, 144);
    images.push(await png(quadrant));
  }
  return images;
}

/** Fill the proven container at uniform 0.75 scale while retaining the stable-camera position margin. */
export async function renderCompatibilityMap(
  pixels: Uint8Array,
): Promise<Uint8Array> {
  const map = await bitmap(pixels);
  try {
    if (map.width !== HUD_MAP_WIDTH || map.height !== HUD_MAP_HEIGHT)
      throw new Error("Compatibility map requires a 576 × 192 source");
    const canvas = document.createElement("canvas");
    canvas.width = 288;
    canvas.height = 144;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 288, 144);
    ctx.drawImage(map, 96, 0, 384, 192, 0, 0, 288, 144);
    return await png(canvas);
  } finally {
    map.close();
  }
}
