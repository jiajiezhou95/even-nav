import type { Mode } from "../../../packages/contracts/src/index";
export const staleThreshold = (mode: Mode) => (mode === "DRIVE" ? 3000 : 5000);
export function staleInstruction(
  timestamp: number | undefined,
  mode: Mode,
  now = Date.now(),
): string | undefined {
  if (
    timestamp === undefined ||
    !Number.isFinite(timestamp) ||
    now - timestamp > staleThreshold(mode)
  ) {
    return mode === "DRIVE"
      ? "定位已过期，请以现场道路为准；暂停转向指示"
      : "定位已过期，请检查现场；等待可靠定位";
  }
}
