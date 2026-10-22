import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("G2 compositor retains turns and map while adding fitted station access", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.route("https://**", (route) => route.abort());
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/hud-renderer.ts";
    const { drawHudCanvas } = await import(path);
    const map = document.createElement("canvas");
    map.width = 576;
    map.height = 192;
    const context = map.getContext("2d")!;
    context.fillStyle = "#000";
    context.fillRect(0, 0, 576, 192);
    context.strokeStyle = "#fff";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(10, 180);
    context.lineTo(250, 70);
    context.lineTo(550, 70);
    context.stroke();
    const blob = await new Promise<Blob>((resolve) =>
      map.toBlob((blob) => resolve(blob!), "image/png"),
    );
    const pixels = new Uint8Array(await blob.arrayBuffer());
    const guidance = {
      action: "继续直行",
      icon: "straight",
      distance: "本段剩余 120 m",
      next: "向右转",
      nextIcon: "right",
      stale: false,
    };
    const variants = [
      undefined,
      "建议入口 A3口",
      `建议出口 ${"合成地下通道".repeat(12)} B2-1口 → 入口 ${"合成换乘方向".repeat(12)} C1口`,
    ];
    const frames = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    for (const access of variants) {
      const calls: {
        text: string;
        x: number;
        y: number;
        width: number;
        fontSize: number;
      }[] = [];
      CanvasRenderingContext2D.prototype.fillText = function (
        text,
        x,
        y,
        maxWidth,
      ) {
        calls.push({
          text,
          x,
          y,
          width: this.measureText(text).width,
          fontSize: Number.parseFloat(this.font),
        });
        return maxWidth === undefined
          ? original.call(this, text, x, y)
          : original.call(this, text, x, y, maxWidth);
      };
      let canvas: HTMLCanvasElement;
      try {
        canvas = await drawHudCanvas({
          pixels,
          guidance: { ...guidance, access },
          instruction: "继续直行",
          attribution: "Google Maps",
          status: "剩余 1.2 公里 · 14:20 → 14:35",
        });
      } finally {
        CanvasRenderingContext2D.prototype.fillText = original;
      }
      frames.push({
        calls,
        width: canvas.width,
        height: canvas.height,
        map: Array.from(
          canvas.getContext("2d")!.getImageData(0, 64, 576, 192).data,
        ),
      });
      if (access === variants.at(-1)) {
        document.body.replaceChildren(canvas);
        document.body.style.cssText = "margin:0;background:#000;";
        canvas.id = "access-hud-preview";
      }
    }
    return frames;
  });
  const header = (frame: (typeof result)[number]) =>
    frame.calls.filter((call) => call.y < 64);
  for (const frame of result) {
    expect([frame.width, frame.height]).toEqual([576, 288]);
    expect(frame.map).toEqual(result[0]!.map);
    expect(header(frame).filter((call) => call.x < 288)).toEqual(
      header(result[0]!).filter((call) => call.x < 288),
    );
    expect(header(frame).some((call) => call.text.includes("然后右转"))).toBe(
      true,
    );
    for (const call of header(frame)) {
      expect(call.y).toBeGreaterThanOrEqual(4);
      expect(call.y + call.fontSize).toBeLessThanOrEqual(60);
      expect(call.x + call.width).toBeLessThanOrEqual(call.x < 288 ? 288 : 568);
    }
  }
  expect(
    header(result[1]!)
      .map((call) => call.text)
      .join(""),
  ).toContain("建议入口 A3口");
  const longText = header(result[2]!)
    .map((call) => call.text)
    .join("");
  expect(longText).toContain("建议出口 B2-1口");
  expect(longText).toContain("入口 C1口");
  await mkdir(".local/access-hud", { recursive: true });
  await page
    .locator("#access-hud-preview")
    .screenshot({ path: ".local/access-hud/transfer.png" });
});
