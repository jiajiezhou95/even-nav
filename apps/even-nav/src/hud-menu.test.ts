import { describe, expect, it } from "vitest";
import { buildHudStepPages } from "./hud-menu";
import { routeOverviewSteps, transitLegOverview } from "./route-overview";
import type { Route } from "../../../packages/contracts/src/index";

describe("complete route overview text", () => {
  it("lists NAVITIME station exits as unselected candidates without changing platform or navigation steps", () => {
    const leg: Route["legs"][number] = {
      mode: "RIDE",
      line: "試験線",
      distanceMeters: 1000,
      durationSeconds: 300,
      geometry: [],
      steps: [],
      fromStop: { name: "甲駅", platform: "2" },
      toStop: { name: "乙駅" },
    };
    const baseline = transitLegOverview(leg);
    expect(baseline).not.toContain("可选出入口");
    const access: NonNullable<
      NonNullable<typeof leg.fromStop>["stationAccess"]
    > = {
      source: "NAVITIME",
      fetchedAt: "2026-10-21T00:00:00Z",
      nodeId: "test-node",
      lineId: "test-line",
      selection: "UNSELECTED_CANDIDATES",
      gateways: Array.from({ length: 20 }, (_, i) => ({
        name: `A${i + 1}口`,
        coordinate: { lat: 35, lng: 139 },
        directions: ["up", "down"],
      })),
    };
    const enriched = {
      ...leg,
      fromStop: { ...leg.fromStop, stationAccess: access },
      toStop: {
        ...leg.toStop,
        stationAccess: {
          ...access,
          nodeId: "other-node",
          gateways: [{ ...access.gateways[0], name: "東口 <中央> & 連絡口" }],
        },
      },
    };
    const text = transitLegOverview(enriched);
    expect(text.startsWith(baseline)).toBe(true);
    expect(text).toContain("甲駅 · 可选出入口（NAVITIME）\nA1口\nA2口");
    expect(text).toContain(
      "乙駅 · 可选出入口（NAVITIME）\n東口 <中央> & 連絡口",
    );
    expect(text).toContain("2站台");
    expect(text).not.toMatch(/推荐|从A1口|选择A1口/);
    expect(enriched.steps).toEqual([]);
    const pages = buildHudStepPages(
      routeOverviewSteps(
        { provider: "TRANSITOUS", legs: [enriched] } as Route,
        0,
        0,
      ),
      (value) => value.length * 22,
    );
    const all = pages.flatMap((page) => page.lines).join("");
    for (const gateway of access.gateways) expect(all).toContain(gateway.name);
    expect(all).toContain("東口 <中央> & 連絡口");
    const sameStation = {
      ...enriched,
      toStop: enriched.fromStop,
    };
    expect(transitLegOverview(sameStation).match(/可选出入口/g)).toHaveLength(
      1,
    );
    expect(
      transitLegOverview({
        ...leg,
        fromStop: {
          ...leg.fromStop,
          stationAccess: { ...access, gateways: [] },
        },
      }),
    ).toBe(baseline);
    for (const mode of ["WALK", "WAIT", "TRANSFER"] as const)
      expect(transitLegOverview({ ...enriched, mode })).toContain(
        "可选出入口（NAVITIME）\nA1口\nA2口",
      );
    const recommended = structuredClone(enriched);
    recommended.fromStop.stationAccess.selection = "NEAREST_STRAIGHT_LINE";
    recommended.fromStop.stationAccess.selectedGateway = {
      ...access.gateways[2],
      distanceMeters: 42.3,
      reference: "WALK_ORIGIN",
    };
    const recommendation = transitLegOverview(recommended);
    expect(recommendation).toContain("甲駅 · 建议入口：A3口（直线最近 42米）");
    expect(recommendation).not.toContain("A1口");
    expect(recommended.steps).toEqual([]);
  });
  it("omits missing metadata without dangling separators while keeping schedule provenance", () => {
    const leg: Route["legs"][number] = {
      mode: "RIDE",
      line: "12345",
      geometry: [],
      steps: [],
      distanceMeters: 1000,
      durationSeconds: 600,
      startTime: "2026-10-21T01:00:00Z",
      intermediateStops: [{}, { name: "中途甲站" }],
    };
    const text = transitLegOverview(leg);
    expect(text).toContain("乘车 · 10分钟");
    expect(text).toContain("出发 10:00");
    expect(text).toContain("时刻表时间");
    expect(text).toContain("中途甲站");
    expect(text).not.toMatch(/12345|待补充|未提供|未知|未命名|无实时|^ ·| ·$/m);
    expect(
      transitLegOverview({ ...leg, intermediateStops: undefined }),
    ).not.toContain("中途站");
    expect(transitLegOverview({ ...leg, intermediateStops: [] })).not.toContain(
      "中途停靠站",
    );
  });
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
    expect(all).not.toContain("未显示的站台或出入口");
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
