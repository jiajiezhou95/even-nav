import { describe, expect, it } from "vitest";
import { hudCueText, wrapHudText } from "./hud-renderer";

describe("HUD B content", () => {
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
