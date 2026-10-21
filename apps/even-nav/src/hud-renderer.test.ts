import { describe, expect, it } from "vitest";
import { fitHudHeader, hudCueText, wrapHudText } from "./hud-renderer";

describe("HUD B content", () => {
  const measure = (text: string, size: number) =>
    Array.from(text).length * size;
  it("keeps short cues at 21px and fits longer cues inside the fixed header", () => {
    expect(fitHudHeader("直行 120 米", 218, measure).fontSize).toBe(21);
    const text = "然后沿东侧地下通道进入中央车站南侧入口";
    const fit = fitHudHeader(text, 182, measure);
    expect(fit.fontSize).toBeLessThan(21);
    expect(fit.fontSize).toBeGreaterThanOrEqual(14);
    expect(fit.lines.join("")).toBe(text);
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(56);
    expect(fit.lines.every((line) => measure(line, fit.fontSize) <= 182)).toBe(
      true,
    );
  });
  it("ellipsizes only at the readable floor, preserving the action prefix and distance", () => {
    const fit = fitHudHeader(
      `乘坐 ${"合成超长线路名称".repeat(30)} 120 米`,
      218,
      measure,
      "120 米",
    );
    expect(fit.fontSize).toBe(14);
    expect(fit.lines.join("")).toMatch(/^乘坐 .*… 120 米$/);
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(56);
    expect(fit.lines.every((line) => measure(line, fit.fontSize) <= 218)).toBe(
      true,
    );
  });
  it("uses structured current remaining distance and next maneuver without provider prose", () => {
    expect(
      hudCueText({
        action: "直行",
        icon: "straight",
        distance: "本段剩余 120 m",
        next: "向右转",
        nextIcon: "right",
        stale: true,
      }),
    ).toEqual({ current: "直行 120 米", next: "然后右转" });
    expect(
      hudCueText({ action: "导航已暂停", icon: "none", stale: false }),
    ).toEqual({ current: "导航已暂停", next: "" });
  });
  it("preserves every character of multiline, CJK and unbroken attribution when wrapping", () => {
    const source = "© Google 日本地図データ\nProviderCopyrightWithoutSpaces";
    const lines = wrapHudText(source, 7, (text) => text.length);
    expect(lines.join("")).toBe(source.replace("\n", ""));
    expect(lines.every((line) => line.length <= 7)).toBe(true);
    expect(lines.some((line) => line.includes("…"))).toBe(false);
  });
});
