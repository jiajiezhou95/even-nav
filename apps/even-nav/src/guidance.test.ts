import { describe, expect, it } from "vitest";
import { NavigationSession } from "../../../packages/core/src/navigation";
import type { Route } from "../../../packages/contracts/src/index";
import {
  conciseInstruction,
  currentStepDetail,
  estimatedArrival,
  hudStatus,
  guidanceView,
  transitPhaseDetail,
} from "./guidance";
import { geometryLength } from "../../../packages/core/src/geometry";

const now = 1800000000000;
const points = [0, 1, 2, 3].map((i) => ({ lat: 35, lng: 139 + i * 0.001 }));
const compound =
  "沿测试道路直行\n经过合成商店，稍向左转后继续到测试路口。\n此说明包含多个地标但仍是同一个供应商步骤。";
function start() {
  const route: Route = {
    id: "guidance-synthetic",
    provider: "GOOGLE_ROUTES",
    basemapProvider: "GOOGLE_TILES",
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600000).toISOString(),
    distanceMeters: 273,
    durationSeconds: 180,
    warnings: [],
    attribution: ["Synthetic"],
    legs: [
      {
        mode: "WALK",
        geometry: points,
        distanceMeters: 273,
        durationSeconds: 180,
        steps: ["STRAIGHT", "TURN_RIGHT", "TURN_LEFT"].map((maneuver, i) => ({
          maneuver,
          instruction: i === 0 ? compound : `未来步骤原文${i}`,
          geometry: points.slice(i, i + 2),
          distanceMeters: 91,
          durationSeconds: 60,
        })),
      },
    ],
  };
  const session = new NavigationSession({ staleMs: 5000 });
  const request = session.beginRequest("PLANNING");
  session.acceptRoutes(request.version, [route], points[0]);
  session.start(route.id, { coordinate: points[0], timestamp: now }, now);
  return session;
}
describe("compact structured navigation guidance", () => {
  it("keeps line, direction, stops and provided platform visible through stale transit GPS", () => {
    const state = start().snapshot;
    const ride = {
      ...state.route!.legs[0],
      mode: "RIDE" as const,
      line: "合成一号线",
      headsign: "东站",
      from: "甲站",
      to: "乙站",
      platform: "2",
      steps: [],
    };
    state.route!.legs = [
      { ...ride, mode: "WAIT" },
      ride,
      {
        ...ride,
        mode: "TRANSFER",
        from: "乙站",
        to: "丙站",
        distanceMeters: 120,
      },
    ];
    const view = guidanceView(state, "TRANSIT", now + 60000);
    expect(view.action).toBe("候车 合成一号线");
    expect(view.distance).toContain("东站");
    expect(view.distance).toContain("2站台");
    expect(view.next).toBe("上车 甲站");
    expect(transitPhaseDetail(state)).toContain("下车站 乙站");
    state.legIndex = 1;
    state.boarded = true;
    expect(guidanceView(state, "TRANSIT", now + 60000)).toMatchObject({
      action: "乘坐 合成一号线",
      next: "下车 乙站",
      stale: true,
    });
    expect(hudStatus(state, "TRANSIT", now + 60000)).toContain("更新定位中");
    expect(currentStepDetail(state)).toContain("方向 东站");
    state.legIndex = 2;
    expect(transitPhaseDetail(state)).toContain("换乘步行 120米");
    state.route!.legs[2] = { ...ride, staySeated: true };
    state.legIndex = 1;
    expect(guidanceView(state, "TRANSIT", now)).toMatchObject({
      next: "直通无需下车",
    });
  });
  it("estimates current step plus later steps and legs, not a fraction of whole-trip distance", () => {
    const state = start().snapshot;
    state.stepIndex = 1;
    state.stepRemainingMeters =
      geometryLength(state.route!.legs[0].steps[1].geometry) / 2;
    state.route!.legs.push({
      mode: "WALK",
      geometry: [],
      steps: [],
      distanceMeters: 400,
      durationSeconds: 300,
    });
    expect(estimatedArrival(state, "WALK", now)).toBe(
      now + (30 + 60 + 300) * 1000,
    );
    state.remainingMeters = 1; // Whole-trip ratio must not change this estimate.
    expect(estimatedArrival(state, "WALK", now)).toBe(now + 390000);
  });
  it("uses transit WAIT and RIDE timetables and rejects missed connections", () => {
    const state = start().snapshot;
    const leg = (mode: "WAIT" | "RIDE", start: number, end: number) => ({
      mode,
      geometry: [],
      steps: [],
      distanceMeters: 0,
      durationSeconds: (end - start) / 1000,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
    });
    state.route!.legs = [
      leg("WAIT", now - 60000, now + 120000),
      leg("RIDE", now + 120000, now + 720000),
      {
        mode: "WALK",
        geometry: [],
        steps: [],
        distanceMeters: 100,
        durationSeconds: 900,
      },
    ];
    expect(estimatedArrival(state, "TRANSIT", now)).toBe(now + 1620000);
    state.legIndex = 1;
    state.location!.timestamp = now + 300000;
    expect(estimatedArrival(state, "TRANSIT", now + 300000)).toBe(
      now + 1620000,
    );
    state.legIndex = 0;
    state.route!.legs[0].endTime = new Date(now + 180000).toISOString();
    expect(estimatedArrival(state, "TRANSIT", now + 300000)).toBeUndefined();
    state.location!.timestamp = now;
    expect(estimatedArrival(state, "TRANSIT", now)).toBeUndefined();
  });
  it("freezes stale ETA at the accepted fix while the clock continues, then hides a past ETA", () => {
    const state = start().snapshot;
    const eta = estimatedArrival(state, "WALK", now);
    expect(estimatedArrival(state, "WALK", now + 60000)).toBe(eta);
    const status = hudStatus(state, "WALK", now + 60000);
    expect(status).toContain("总剩余 273 m");
    expect(status).toContain("预计到达");
    expect(status).toContain("更新定位中");
    expect(status.split("\n")).toHaveLength(2);
    expect(estimatedArrival(state, "WALK", now + 240000)).toBeUndefined();
    expect(hudStatus(state, "WALK", now + 240000)).toContain("预计到达 --:--");
  });
  it("formats local date rollover and handles paused, ended and malformed input safely", () => {
    const state = start().snapshot;
    const midnight = new Date(2026, 9, 21, 23, 59, 0).getTime();
    state.location!.timestamp = midnight;
    expect(hudStatus(state, "WALK", midnight)).toContain(
      "23:59\n预计到达 00:02",
    );
    state.paused = true;
    expect(hudStatus(state, "WALK", midnight)).toContain(
      "预计到达 --:-- · 已暂停",
    );
    state.paused = false;
    state.phase = "ENDED";
    expect(estimatedArrival(state, "WALK", midnight)).toBeUndefined();
    state.phase = "NAVIGATING";
    state.route!.legs[0].steps[1].durationSeconds = NaN;
    expect(estimatedArrival(state, "WALK", midnight)).toBeUndefined();
    state.remainingMeters = NaN;
    expect(hudStatus(state, "WALK", NaN)).toBe(
      "总剩余 --  现在--:--\n预计到达 --:--",
    );
  });
  it("ignores compound multiline prose and includes only one structured upcoming maneuver", () => {
    const state = start().snapshot;
    expect(conciseInstruction(state, "WALK", now)).toMatch(
      /^直行\n本段剩余 \d+ m\n\n下一步：向右转$/,
    );
    expect(conciseInstruction(state, "WALK", now)).not.toMatch(
      /商店|地标|左转|未来步骤原文/,
    );
    expect(currentStepDetail(state)).toBe(compound);
  });
  it("decreases only with accepted fixes and updates the next cue at the geometry boundary", () => {
    const session = start(),
      first = session.snapshot.stepRemainingMeters;
    session.updateLocation(
      { coordinate: { lat: 35, lng: 139.0005 }, timestamp: now + 5000 },
      now + 5000,
    );
    expect(session.snapshot.stepRemainingMeters).toBeLessThan(first);
    const midpoint = conciseInstruction(session.snapshot, "WALK", now + 5000);
    expect(midpoint).toContain("下一步：向右转");
    expect(conciseInstruction(session.snapshot, "WALK", now + 6000)).toBe(
      midpoint,
    );
    session.updateLocation(
      { coordinate: { lat: 35, lng: 139.0011 }, timestamp: now + 10000 },
      now + 10000,
    );
    expect(session.snapshot.stepIndex).toBe(1);
    expect(conciseInstruction(session.snapshot, "WALK", now + 10000)).toMatch(
      /^沿路线前行\n本段剩余 \d+ m\n\n下一步：向左转$/,
    );
    expect(currentStepDetail(session.snapshot)).toBe("未来步骤原文1");
  });
  it("retains planned action and last meters while blinking status only, never interpolating", () => {
    const state = start().snapshot;
    const stale = conciseInstruction(state, "WALK", now + 5001);
    expect(stale).toContain("直行");
    expect(stale).toBe(conciseInstruction(state, "WALK", now));
    expect(hudStatus(state, "WALK", now + 5001)).toContain("● 更新定位中");
    expect(hudStatus(state, "WALK", now + 6001)).toContain("  更新定位中");
    expect(hudStatus(state, "WALK", now)).not.toContain("更新定位中");
    expect(stale).toContain("下一步：向右转");
    expect(stale).toContain("本段剩余");
    state.paused = true;
    expect(hudStatus(state, "WALK", now + 6001)).not.toContain("更新定位中");
    state.paused = false;
    state.phase = "ARRIVED";
    expect(hudStatus(state, "WALK", now + 6001)).not.toContain("更新定位中");
    state.phase = "ENDED";
    expect(hudStatus(state, "WALK", now + 6001)).not.toContain("更新定位中");
    state.phase = "NAVIGATING";
    state.paused = true;
    expect(conciseInstruction(state, "WALK", now)).toBe("导航已暂停");
  });
  it.each(["constructor", "__proto__", "UNKNOWN_NEW_ENUM", undefined])(
    "uses neutral fallback for unknown enum %s without parsing prose",
    (maneuver) => {
      const state = start().snapshot;
      state.route!.legs[0].steps[0].maneuver = maneuver;
      state.route!.legs[0].steps[1].maneuver = maneuver;
      expect(conciseInstruction(state, "WALK", now)).toMatch(
        /^沿路线前行\n本段剩余 \d+ m$/,
      );
    },
  );
  it("preserves a structured special action and does not leave DEPART as a waiting prompt", () => {
    const state = start().snapshot;
    state.route!.legs[0].steps[0].maneuver = "RAMP_LEFT";
    expect(conciseInstruction(state, "DRIVE", now)).toContain("从左侧上匝道");
    state.route!.legs[0].steps[0].maneuver = "DEPART";
    expect(conciseInstruction(state, "WALK", now)).toMatch(/^沿路线前行/);
  });
});
