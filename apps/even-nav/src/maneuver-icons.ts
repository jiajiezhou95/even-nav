import type { ManeuverIcon } from "./guidance";

// Original vector strokes shared by phone SVG and G2 PNG; no font glyph dependency.
const paths: Record<ManeuverIcon, string> = {
  none: "",
  straight: "M32 54V10M16 26L32 10L48 26",
  left: "M44 54V32Q44 20 32 20H10M24 6L10 20L24 34",
  right: "M20 54V32Q20 20 32 20H54M40 6L54 20L40 34",
  uturn: "M46 54V24C46 5 18 5 18 24V38M6 26L18 38L30 26",
  roundabout:
    "M32 56V48C9 48 9 16 32 16C47 16 52 32 44 42M44 42L44 27M44 42L29 40",
  transport:
    "M14 42V16Q14 8 22 8H42Q50 8 50 16V42ZM14 30H50M22 50L16 57M42 50L48 57",
};
export function maneuverSvg(icon: ManeuverIcon): string {
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d="${paths[icon]}" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
const pngCache = new Map<ManeuverIcon, Promise<Uint8Array>>();
export function maneuverPng(icon: ManeuverIcon): Promise<Uint8Array> {
  let pending = pngCache.get(icon);
  if (!pending) {
    pending = (async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 48;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#000";
      context.fillRect(0, 0, 48, 48);
      context.scale(0.75, 0.75);
      context.strokeStyle = "#fff";
      context.lineWidth = 7;
      context.lineCap = context.lineJoin = "round";
      context.stroke(new Path2D(paths[icon]));
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Icon PNG encoding failed")),
          "image/png",
        ),
      );
      return new Uint8Array(await blob.arrayBuffer());
    })();
    pngCache.set(icon, pending);
  }
  return pending;
}
