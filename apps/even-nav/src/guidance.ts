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
  const arrow = maneuver.includes("LEFT")
    ? "←"
    : maneuver.includes("RIGHT")
      ? "→"
      : "↑";
  return `${arrow} ${actions[maneuver]}`;
}

/** A single structured action, never clauses extracted from provider prose. */
export function conciseInstruction(
  state: NavigationState,
  mode: Mode,
  now = Date.now(),
): string {
  if (state.phase === "ARRIVED") return "已到达目的地附近";
  if (state.phase === "ENDED") return "导航已结束";
  if (state.paused) return "导航已暂停";
  const leg = state.route?.legs[state.legIndex];
  const stale = staleInstruction(state.location?.timestamp, mode, now);
  if (state.phase === "NAVIGATING" && stale)
    return leg?.mode === "RIDE" || leg?.mode === "WAIT"
      ? "定位过期\n请手动确认乘车进度"
      : stale;
  if (!leg) return "等待选择路线";
  if (leg.mode === "WAIT") return `候车${leg.line ? ` ${leg.line}` : ""}`;
  if (leg.mode === "RIDE")
    return `乘坐 ${leg.line || "公共交通"}\n${leg.to || leg.headsign || "请确认下车站"}`;
  if (leg.mode === "TRANSFER") return `换乘${leg.to ? ` ${leg.to}` : ""}`;
  const step = leg.steps[state.stepIndex];
  const maneuver = step?.maneuver;
  // A maneuver belongs to the start of its step. Remaining distance is to its END.
  // Only the next step's maneuver can be described as an upcoming boundary.
  const action =
    maneuver === "STRAIGHT" || maneuver === "CONTINUE"
      ? "↑ 直行"
      : maneuver && specialActions.has(maneuver)
        ? cue(maneuver)!
        : "↑ 沿路线前行";
  if (!step || !Number.isFinite(state.stepRemainingMeters)) return action;
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
  return `${action}\n本段剩余 ${distance}${next ? `\n下一步：${next}` : ""}`;
}

export function currentStepDetail(state: NavigationState): string {
  return (
    state.route?.legs[state.legIndex]?.steps[state.stepIndex]?.instruction || ""
  );
}
