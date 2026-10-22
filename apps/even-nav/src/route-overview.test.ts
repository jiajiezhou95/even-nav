import { describe, expect, it } from "vitest";
import type { RouteLeg } from "../../../packages/contracts/src/index";
import { transitLegOverview } from "./route-overview";

const bus: RouteLeg = {
  mode: "RIDE",
  transitMode: "BUS",
  line: "８８",
  headsign: "合成总站",
  from: "甲站",
  to: "乙站",
  distanceMeters: 2000,
  durationSeconds: 600,
  geometry: [],
  steps: [],
  startTime: "2026-10-22T00:00:00Z",
  endTime: "2026-10-22T00:10:00Z",
  fromStop: {
    name: "甲站",
    platform: "2",
    stationAccess: {
      source: "NAVITIME",
      fetchedAt: "2026-10-22T00:00:00Z",
      nodeId: "synthetic",
      lineId: "synthetic",
      selection: "UNSELECTED_CANDIDATES",
      gateways: [
        {
          name: "不应出现的铁路出口",
          coordinate: { lat: 35, lng: 139 },
          directions: [],
        },
      ],
    },
  },
  intermediateStops: [{ name: "中途站", arrivalTime: "2026-10-22T00:05:00Z" }],
};

describe("bus journey overview", () => {
  it("includes numeric line, direction, stop sequence and schedule without rail entrance metadata", () => {
    const text = transitLegOverview(bus);
    expect(text).toContain("乘坐 公交 88 · 往合成总站 · 10分钟");
    expect(text).toContain("甲站 · 2乘车点 · 出发 09:00");
    expect(text).toContain("途经停靠站：\n中途站 · 09:05");
    expect(text).toContain("乙站 · 到达 09:10");
    expect(text).not.toMatch(/铁路出口|站台|未知|待补充/);
  });
  it("labels bus waiting while retaining existing rail numeric-identifier filtering", () => {
    expect(transitLegOverview({ ...bus, mode: "WAIT" })).toContain(
      "候车 公交 88",
    );
    expect(transitLegOverview({ ...bus, transitMode: "RAIL" })).not.toContain(
      "公交",
    );
    expect(transitLegOverview({ ...bus, transitMode: "RAIL" })).not.toContain(
      "乘坐 88",
    );
  });
});
