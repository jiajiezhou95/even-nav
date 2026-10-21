import { describe, expect, it } from "vitest";
import { buildHudStepPages } from "./hud-menu";
import { routeOverviewSteps } from "./route-overview";
import type { Route } from "../../../packages/contracts/src/index";

describe("complete route overview text", () => {
  it("retains long Chinese, punctuation and explicit newlines across bounded four-line pages", () => {
    const text =
      "前往中央车站东出口，经过地下通道后右转。\n在第二个路口左转，沿人行道继续前行至公交站。".repeat(
        3,
      );
    const pages = buildHudStepPages(
      [
        { text, current: true },
        { text: "已到终点", current: false },
      ],
      (value) => Array.from(value).length * 20,
    );
    expect(pages.length).toBeGreaterThan(3);
    expect(
      pages
        .filter((p) => p.step === 1)
        .flatMap((p) => p.lines)
        .join(""),
    ).toBe(text);
    for (const page of pages) {
      expect(page.lines.length).toBeLessThanOrEqual(4);
      for (const line of page.lines)
        expect(Array.from(line.replace(/\n/g, "")).length).toBeLessThanOrEqual(
          8,
        );
    }
    expect(pages.at(-1)).toMatchObject({ step: 2, total: 2, current: false });
  });
  it("includes past/current/future road steps and step-less WAIT RIDE TRANSFER legs", () => {
    const legs = [
      {
        mode: "WALK",
        steps: [
          { instruction: "已走道路", distanceMeters: 10 },
          { instruction: "右转进入站口", distanceMeters: 20 },
        ],
      },
      { mode: "WAIT", line: "公交12", from: "甲站", platform: "2", steps: [] },
      {
        mode: "RIDE",
        line: "公交12",
        from: "甲站",
        to: "乙站",
        headsign: "东站",
        steps: [],
      },
      { mode: "TRANSFER", from: "乙站", to: "地铁站", steps: [] },
    ];
    const result = routeOverviewSteps({ legs } as Route, 0, 1);
    expect(result).toHaveLength(5);
    expect(result.map((s) => s.current)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(result[0].text).toContain("已走道路");
    expect(result[1].text).toContain("右转进入站口");
    expect(result[2].text).toContain("候车 · 公交12 · 甲站 · 2站台");
    expect(result[3].text).toContain("乘车 · 公交12 · 往东站 · 甲站 → 乙站");
    expect(result[4].text).toContain("换乘 · 乙站 → 地铁站");
  });
});
