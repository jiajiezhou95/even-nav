import type { NavigationState } from "../../../packages/core/src/navigation";
import type { Mode } from "../../../packages/contracts/src/index";
import { staleInstruction } from "./freshness";

const actions: Record<string, string> = {
  TURN_LEFT: "向左转",
  LEFT: "向左转",
  TURN_RIGHT: "向右转",
  RIGHT: "向右转",
  TURN_SLIGHT_LEFT: "稍向左转",
  SLIGHTLY_LEFT: "稍向左转",
  TURN_SLIGHT_RIGHT: "稍向右转",
  SLIGHTLY_RIGHT: "稍向右转",
  TURN_SHARP_LEFT: "向左急转",
  HARD_LEFT: "向左急转",
  TURN_SHARP_RIGHT: "向右急转",
  HARD_RIGHT: "向右急转",
  UTURN_LEFT: "向左掉头",
  UTURN_RIGHT: "向右掉头",
  STRAIGHT: "继续直行",
  CONTINUE: "继续直行",
  RAMP_LEFT: "从左侧上匝道",
  RAMP_RIGHT: "从右侧上匝道",
  FORK_LEFT: "岔路靠左",
  FORK_RIGHT: "岔路靠右",
  MERGE: "并入道路",
  ROUNDABOUT_LEFT: "环岛向左",
  ROUNDABOUT_RIGHT: "环岛向右",
  CIRCLE_CLOCKWISE: "顺时针绕行环岛",
  CIRCLE_COUNTERCLOCKWISE: "逆时针绕行环岛",
  FERRY: "乘坐渡轮",
  FERRY_TRAIN: "乘坐列车渡轮",
  ELEVATOR: "乘坐电梯",
  DEPART: "沿路线前行",
  NAME_CHANGE: "沿道路继续",
};
const specialActions = new Set([
  "RAMP_LEFT",
  "RAMP_RIGHT",
  "MERGE",
  "ROUNDABOUT_LEFT",
  "ROUNDABOUT_RIGHT",
  "CIRCLE_CLOCKWISE",
  "CIRCLE_COUNTERCLOCKWISE",
  "FERRY",
  "FERRY_TRAIN",
  "ELEVATOR",
]);
function cue(maneuver: string | undefined): string | undefined {
  if (!maneuver || !Object.hasOwn(actions, maneuver)) return;
  return actions[maneuver];
}
export type ManeuverIcon =
  "none" | "straight" | "left" | "right" | "uturn" | "roundabout" | "transport";
export function iconForManeuver(maneuver?: string): ManeuverIcon {
  if (!maneuver || !Object.hasOwn(actions, maneuver)) return "straight";
  if (maneuver.includes("UTURN")) return "uturn";
  if (maneuver.includes("ROUNDABOUT") || maneuver.includes("CIRCLE"))
    return "roundabout";
  if (["FERRY", "FERRY_TRAIN", "ELEVATOR"].includes(maneuver))
    return "transport";
  return maneuver.includes("LEFT") || maneuver === "LEFT"
    ? "left"
    : maneuver.includes("RIGHT") || maneuver === "RIGHT"
      ? "right"
      : "straight";
}
export interface GuidanceView {
  action: string;
  icon: ManeuverIcon;
  distance?: string;
  next?: string;
  nextIcon?: ManeuverIcon;
  stale: boolean;
}

/** A single structured action, never clauses extracted from provider prose. */
export function guidanceView(
  state: NavigationState,
  mode: Mode,
  now = Date.now(),
): GuidanceView {
  const plain = (action: string): GuidanceView => ({
    action,
    icon: "none",
    stale: false,
  });
  if (state.phase === "ARRIVED") return plain("已到达目的地附近");
  if (state.phase === "ENDED") return plain("导航已结束");
  if (state.paused) return plain("导航已暂停");
  const leg = state.route?.legs[state.legIndex];
  const stale =
    state.phase === "NAVIGATING" &&
    Boolean(staleInstruction(state.location?.timestamp, mode, now));
  if (!leg) return plain("等待选择路线");
  if (leg.mode === "WAIT")
    return {
      ...plain(`候车${leg.line ? ` ${leg.line}` : ""}`),
      icon: "transport",
      stale,
    };
  if (leg.mode === "RIDE")
    return {
      ...plain(`乘坐 ${leg.line || "公共交通"}`),
      icon: "transport",
      next: leg.to || leg.headsign || "请确认下车站",
      stale,
    };
  if (leg.mode === "TRANSFER")
    return { ...plain(`换乘${leg.to ? ` ${leg.to}` : ""}`), stale };
  const step = leg.steps[state.stepIndex];
  const maneuver = step?.maneuver;
  // A maneuver belongs to the start of its step. Remaining distance is to its END.
  // Only the next step's maneuver can be described as an upcoming boundary.
  const action =
    maneuver === "STRAIGHT" || maneuver === "CONTINUE"
      ? "直行"
      : maneuver && specialActions.has(maneuver)
        ? cue(maneuver)!
        : "沿路线前行";
  const icon =
    maneuver && specialActions.has(maneuver)
      ? iconForManeuver(maneuver)
      : "straight";
  if (!step || !Number.isFinite(state.stepRemainingMeters))
    return { action, icon, stale };
  const meters = Math.max(0, state.stepRemainingMeters);
  const distance =
    meters >= 1000
      ? `${(meters / 1000).toFixed(1)} km`
      : `${Math.round(meters)} m`;
  const nextManeuver = leg.steps[state.stepIndex + 1]?.maneuver;
  const next =
    nextManeuver &&
    !["DEPART", "NAME_CHANGE", "STRAIGHT", "CONTINUE"].includes(nextManeuver)
      ? cue(nextManeuver)
      : undefined;
  return {
    action,
    icon,
    stale,
    distance: `本段剩余 ${distance}`,
    next,
    nextIcon: next ? iconForManeuver(nextManeuver) : undefined,
  };
}
export function conciseInstruction(
  state: NavigationState,
  mode: Mode,
  now = Date.now(),
): string {
  const view = guidanceView(state, mode, now);
  return `${view.action}${view.distance ? `\n${view.distance}` : ""}${view.next ? `\n\n下一步：${view.next}` : ""}`;
}

export function currentStepDetail(state: NavigationState): string {
  return (
    state.route?.legs[state.legIndex]?.steps[state.stepIndex]?.instruction || ""
  );
}

/** Existing tick drives the dot; retained numbers are never extrapolated. */
export function hudStatus(
  state: NavigationState,
  mode: Mode,
  now = Date.now(),
): string {
  const meters = Math.max(0, state.remainingMeters);
  const total = `总剩余 ${meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`}`;
  if (state.paused) return `${total}\n已暂停`;
  if (state.phase === "ARRIVED") return `${total}\n已到达`;
  if (state.phase !== "NAVIGATING") return total;
  return guidanceView(state, mode, now).stale
    ? `${total}\n${Math.floor(now / 1000) % 2 ? "●" : " "} 更新定位中`
    : total;
}
