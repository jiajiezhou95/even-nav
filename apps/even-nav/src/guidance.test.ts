import { describe, expect, it } from "vitest";
import { NavigationSession } from "../../../packages/core/src/navigation";
import type { Route } from "../../../packages/contracts/src/index";
import { conciseInstruction, currentStepDetail } from "./guidance";

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
  it("ignores compound multiline prose and includes only one structured upcoming maneuver", () => {
    const state = start().snapshot;
    expect(conciseInstruction(state, "WALK", now)).toMatch(
      /^↑ 直行\n本段剩余 \d+ m\n下一步：→ 向右转$/,
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
    expect(midpoint).toContain("下一步：→ 向右转");
    expect(conciseInstruction(session.snapshot, "WALK", now + 6000)).toBe(
      midpoint,
    );
    session.updateLocation(
      { coordinate: { lat: 35, lng: 139.0011 }, timestamp: now + 10000 },
      now + 10000,
    );
    expect(session.snapshot.stepIndex).toBe(1);
    expect(conciseInstruction(session.snapshot, "WALK", now + 10000)).toMatch(
      /^↑ 沿路线前行\n本段剩余 \d+ m\n下一步：← 向左转$/,
    );
    expect(currentStepDetail(session.snapshot)).toBe("未来步骤原文1");
  });
  it("hides distance and turn cues when stale instead of interpolating progress", () => {
    const state = start().snapshot;
    const stale = conciseInstruction(state, "WALK", now + 5001);
    expect(stale).toContain("定位已过期");
    expect(stale).not.toMatch(/本段剩余|下一步| m/);
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
        /^↑ 沿路线前行\n本段剩余 \d+ m$/,
      );
    },
  );
  it("preserves a structured special action and does not leave DEPART as a waiting prompt", () => {
    const state = start().snapshot;
    state.route!.legs[0].steps[0].maneuver = "RAMP_LEFT";
    expect(conciseInstruction(state, "DRIVE", now)).toContain("← 从左侧上匝道");
    state.route!.legs[0].steps[0].maneuver = "DEPART";
    expect(conciseInstruction(state, "WALK", now)).toMatch(/^↑ 沿路线前行/);
  });
});
