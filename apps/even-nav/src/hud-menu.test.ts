import { describe, expect, it } from "vitest";
import { buildHudStepPages } from "./hud-menu";
import { routeOverviewSteps, transitLegOverview } from "./route-overview";
import type { Route } from "../../../packages/contracts/src/index";

describe("complete route overview text", () => {
  it("retains long Chinese and newlines across nine-line full-width pages and packs short steps together", () => {
    const text =
      "前往中央车站东出口，经过地下通道后右转。\n在第二个路口左转，沿人行道继续前行至公交站。".repeat(
        12,
      );
    const pages = buildHudStepPages(
      [
        { text, current: true },
        { text: "已到终点", current: false },
      ],
      (value) => Array.from(value).length * 20,
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(
      pages
        .flatMap((p) => p.lines)
        .filter((line) => !line.startsWith("步骤 ") && line !== "已到终点")
        .join(""),
    ).toBe(text);
    for (const page of pages) {
      expect(page.lines.length).toBeLessThanOrEqual(9);
      for (const line of page.lines)
        expect(Array.from(line.replace(/\n/g, "")).length).toBeLessThanOrEqual(
          27,
        );
    }
    expect(pages.at(-1)?.lines).toContain("已到终点");
    const rows = pages.flatMap((page) => page.lines);
    expect(rows[rows.indexOf("步骤 2/2") - 1]).toBe("");
    expect(
      buildHudStepPages(
        [
          { text: "左转", current: true },
          { text: "到达", current: false },
        ],
        (text) => text.length * 22,
      ),
    ).toHaveLength(1);
  });
  it("summarizes transit by leg, retains all stops and preserves walking-only turn details", () => {
    const legs = [
      {
        mode: "WALK",
        distanceMeters: 250,
        durationSeconds: 240,
        to: "甲站",
        steps: [
          { instruction: "已走道路", distanceMeters: 10 },
          { instruction: "从A口进入车站入口", distanceMeters: 20 },
        ],
      },
      { mode: "WAIT", line: "公交12", from: "甲站", platform: "2", steps: [] },
      {
        mode: "RIDE",
        line: "公交12",
        from: "甲站",
        to: "乙站",
        headsign: "东站",
        startTime: "2026-10-21T01:00:00Z",
        endTime: "2026-10-21T01:20:00Z",
        durationSeconds: 1200,
        intermediateStops: Array.from({ length: 12 }, (_, i) => ({
          name: `中途站${i + 1}`,
          arrivalTime: "2026-10-21T01:10:00Z",
          cancelled: i === 5,
        })),
        steps: [],
      },
      { mode: "TRANSFER", from: "乙站", to: "地铁站", steps: [] },
    ];
    const result = routeOverviewSteps({ legs } as Route, 0, 1);
    expect(result).toHaveLength(4);
    expect(result.map((s) => s.current)).toEqual([true, false, false, false]);
    expect(result[0].text).toContain("步行 250米 · 4分钟");
    expect(result[0].text).not.toContain("已走道路");
    expect(result[0].text).toContain("从A口进入车站入口");
    expect(result[1].text).toContain("2站台");
    expect(result[2].text).toContain("乘坐 公交12 · 往东站 · 20分钟");
    expect(result[2].text).toContain("出发 10:00");
    expect(result[2].text).toContain("到达 10:20");
    const planned = {
      ...legs[2],
      fromStop: { scheduledPlatform: "3" },
    } as Route["legs"][number];
    expect(transitLegOverview(planned)).toContain("计划3站台");
    expect(
      transitLegOverview({
        ...planned,
        fromStop: { platform: "4", scheduledPlatform: "3" },
      }),
    ).toContain("4站台");
    expect(
      transitLegOverview({
        ...planned,
        fromStop: { platform: "4", scheduledPlatform: "3" },
      }),
    ).not.toContain("计划3站台");
    const pages = buildHudStepPages(result, (text) => text.length * 22);
    const all = pages.flatMap((p) => p.lines).join("");
    for (let i = 1; i <= 12; i++) expect(all).toContain(`中途站${i}`);
    expect(all).toContain("停靠取消");
    expect(all).toContain("未列出的站台/出入口未提供");
    expect(result[3].text).toContain("乙站 → 地铁站");
    const walking = routeOverviewSteps(
      { provider: "GOOGLE_ROUTES", legs: [legs[0]] } as Route,
      0,
      1,
    );
    expect(walking).toHaveLength(2);
    expect(walking[0].text).toContain("已走道路");
    expect(
      transitLegOverview({
        ...legs[1],
        durationSeconds: 300,
        startTime: "2026-10-21T01:00:00Z",
        endTime: "2026-10-21T01:05:00Z",
      } as Route["legs"][number]),
    ).toContain("出发 10:05");
  });
});
