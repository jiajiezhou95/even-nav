import { describe, expect, it } from "vitest";
import {
  fitHudHeader,
  fitHudSecondary,
  hudCueText,
  wrapHudText,
} from "./hud-renderer";

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
  it("keeps the next turn and selected entrance together without changing the current cue", () => {
    const view = {
      action: "继续直行",
      icon: "straight" as const,
      distance: "本段剩余 120 m",
      next: "向右转",
      nextIcon: "right" as const,
      access: "建议入口 A3口",
      stale: false,
    };
    const cues = hudCueText(view);
    expect(cues).toEqual({ current: "继续直行 120 米", next: "然后右转" });
    const fit = fitHudSecondary(cues.next, view.access, 182, measure);
    expect(fit.lines.join("")).toBe("然后右转建议入口 A3口");
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(56);
    expect(fit.fontSize).toBeGreaterThanOrEqual(14);
  });
  it("retains both transfer codes when descriptions exceed the header space", () => {
    const fit = fitHudSecondary(
      "然后右转",
      `建议出口 地下2层${"站内地下通道".repeat(12)} B2-1口 → 入口 ${"换乘方向通道".repeat(12)} C1口`,
      182,
      measure,
    );
    expect(fit.lines).toEqual(["然后右转", "建议出口 B2-1口", "入口 C1口"]);
    expect(fit.fontSize).toBe(14);
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(56);
    expect(fit.lines.every((line) => measure(line, fit.fontSize) <= 182)).toBe(
      true,
    );
  });
  it("shows access without a next turn and fits descriptive non-numbered gateways", () => {
    const fit = fitHudSecondary("", "建议出口 東口（地下通道）", 240, measure);
    expect(fit.lines.join("")).toBe("建议出口 東口（地下通道）");
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(56);
    const long = fitHudSecondary(
      "然后左转",
      `建议出口 東口（${"地下连通通道".repeat(20)}）`,
      182,
      measure,
    );
    expect(long.lines[0]).toBe("然后左转");
    expect(long.lines.join("")).toContain("建议出口 東口");
    expect(long.lines.join("")).toContain("…");
    expect(long.lines.length * long.lineHeight).toBeLessThanOrEqual(56);
  });
});
