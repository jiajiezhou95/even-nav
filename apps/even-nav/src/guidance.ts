import type {
  NavigationState,
  TransitAction,
} from "../../../packages/core/src/navigation";
import type { Mode } from "../../../packages/contracts/src/index";
import { staleInstruction } from "./freshness";
import { geometryLength } from "../../../packages/core/src/geometry";
import { departureText } from "./transit-departure";

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
export const transitActionLabels: Record<TransitAction, string> = {
  BOARDED: "已上车",
  ALIGHTED: "已下车",
  TRANSFER_COMPLETED: "完成换乘",
  STAY_SEATED: "确认直通",
};

export function transitPhaseDetail(state: NavigationState): string {
  const leg = state.route?.legs[state.legIndex];
  if (!leg) return "";
  if (
    leg.mode === "WALK" &&
    state.route?.legs.some((item) => item.mode === "RIDE")
  )
    return `步行至${leg.to || "下一站点"} · 本段 ${Math.round(leg.distanceMeters)}米`;
  if (!["WAIT", "RIDE", "TRANSFER"].includes(leg.mode)) return "";
  const ride =
    leg.mode === "WAIT" ? state.route?.legs[state.legIndex + 1] : leg;
  const alighting = leg.mode === "WAIT" ? ride?.to : leg.to;
  return [
    leg.line || ride?.line,
    (leg.headsign || ride?.headsign) &&
      `方向 ${leg.headsign || ride?.headsign}`,
    leg.from && `${leg.mode === "TRANSFER" ? "从" : "上车站 "}${leg.from}`,
    alighting && `${leg.mode === "TRANSFER" ? "前往" : "下车站 "}${alighting}`,
    (leg.platform || (leg.mode === "WAIT" ? ride?.platform : undefined)) &&
      `${leg.platform || ride?.platform}站台`,
    leg.mode === "TRANSFER" && `换乘步行 ${Math.round(leg.distanceMeters)}米`,
    leg.staySeated && "直通无需下车",
  ]
    .filter(Boolean)
    .join(" · ");
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
  if (leg.mode === "WAIT") {
    const ride = state.route?.legs[state.legIndex + 1];
    return {
      ...plain(`候车 ${leg.line || ride?.line || "公共交通"}`),
      icon: "transport",
      distance: [
        leg.headsign || ride?.headsign,
        (leg.platform || ride?.platform) &&
          `${leg.platform || ride?.platform}站台`,
      ]
        .filter(Boolean)
        .join(" · "),
      next: `上车 ${leg.from || ride?.from || "请确认站名"}`,
      stale,
    };
  }
  if (leg.mode === "RIDE")
    return {
      ...plain(
        `${state.boarded ? "乘坐" : "待上车"} ${leg.line || "公共交通"}`,
      ),
      icon: "transport",
      distance: [
        leg.headsign && `往${leg.headsign}`,
        leg.platform && `${leg.platform}站台`,
      ]
        .filter(Boolean)
        .join(" · "),
      next:
        state.boarded &&
        state.route?.legs[state.legIndex + 1]?.mode === "RIDE" &&
        state.route.legs[state.legIndex + 1].staySeated
          ? "直通无需下车"
          : `${state.boarded ? "下车" : "上车"} ${(state.boarded ? leg.to : leg.from) || "请确认站名"}`,
      stale,
    };
  if (leg.mode === "TRANSFER")
    return {
      ...plain(`换乘${leg.to ? ` ${leg.to}` : ""}`),
      distance: `剩余 ${Math.round(Math.max(0, leg.distanceMeters - state.progressMeters))}米`,
      next:
        [leg.line, leg.platform && `${leg.platform}站台`]
          .filter(Boolean)
          .join(" · ") || "到达后确认完成换乘",
      stale,
    };
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
    state.route?.legs[state.legIndex]?.steps[state.stepIndex]?.instruction ||
    transitPhaseDetail(state)
  );
}

/** Estimate each remaining segment independently; waiting is never scaled by distance. */
export function estimatedArrival(
  state: NavigationState,
  mode: Mode,
  now = Date.now(),
): number | undefined {
  if (
    state.paused ||
    state.phase !== "NAVIGATING" ||
    !state.route ||
    !Number.isFinite(now)
  )
    return;
  const valid = (n: number) => Number.isFinite(n) && n >= 0;
  if (
    !Number.isInteger(state.legIndex) ||
    state.legIndex < 0 ||
    state.legIndex >= state.route.legs.length
  )
    return;
  const stale = state.locationStale || guidanceView(state, mode, now).stale;
  let cursor = stale ? state.location?.timestamp : now;
  if (cursor === undefined || !valid(cursor) || cursor > now) return;
  for (let index = state.legIndex; index < state.route.legs.length; index++) {
    const leg = state.route.legs[index];
    const current = index === state.legIndex;
    if (!valid(leg.durationSeconds)) return;
    if (leg.mode === "WAIT" || leg.mode === "RIDE") {
      const start =
        leg.startTime === undefined ? undefined : Date.parse(leg.startTime);
      const end =
        leg.endTime === undefined ? undefined : Date.parse(leg.endTime);
      if (
        (start !== undefined && !valid(start)) ||
        (end !== undefined && !valid(end)) ||
        (start !== undefined && end !== undefined && end < start)
      )
        return;
      // A missed departure or an unconfirmed arrival cannot produce a reliable ETA.
      if (end !== undefined) {
        if (
          cursor > end ||
          (!current &&
            leg.mode === "RIDE" &&
            start !== undefined &&
            cursor > start)
        )
          return;
        cursor = end;
      } else {
        if (start !== undefined) {
          if (!current && cursor > start) return;
          cursor = Math.max(cursor, start);
        }
        cursor += leg.durationSeconds * 1000;
      }
    } else if (current && leg.steps.length) {
      if (
        !Number.isInteger(state.stepIndex) ||
        state.stepIndex < 0 ||
        state.stepIndex >= leg.steps.length ||
        !valid(state.stepRemainingMeters)
      )
        return;
      const step = leg.steps[state.stepIndex];
      const length = step.geometry.length
        ? geometryLength(step.geometry)
        : step.distanceMeters;
      if (!valid(length) || !valid(step.durationSeconds)) return;
      let seconds =
        step.durationSeconds *
        (length > 0 ? Math.min(1, state.stepRemainingMeters / length) : 1);
      for (const future of leg.steps.slice(state.stepIndex + 1)) {
        if (!valid(future.durationSeconds)) return;
        seconds += future.durationSeconds;
      }
      cursor += seconds * 1000;
    } else {
      if (
        current &&
        (!valid(state.progressMeters) || !valid(leg.distanceMeters))
      )
        return;
      const fraction =
        current && leg.distanceMeters > 0
          ? Math.max(0, 1 - state.progressMeters / leg.distanceMeters)
          : 1;
      cursor += leg.durationSeconds * fraction * 1000;
    }
  }
  return cursor >= now && Number.isFinite(new Date(cursor).getTime())
    ? cursor
    : undefined;
}

function clockText(timestamp: number | undefined): string {
  if (
    timestamp === undefined ||
    !Number.isFinite(new Date(timestamp).getTime())
  )
    return "--:--";
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Existing tick updates the clock and dot; retained progress is never extrapolated. */
export function hudStatus(
  state: NavigationState,
  mode: Mode,
  now = Date.now(),
): string {
  const meters = state.remainingMeters;
  const distance =
    !Number.isFinite(meters) || meters < 0
      ? "--"
      : meters >= 1000
        ? `${(meters / 1000).toFixed(1)} km`
        : `${Math.round(meters)} m`;
  const total = `总剩余 ${distance}  现在${clockText(now)}`;
  if (state.paused) return `${total}\n预计到达 --:-- · 已暂停`;
  if (state.phase === "ARRIVED") return `${total}\n已到达`;
  if (state.phase !== "NAVIGATING") return `${total}\n预计到达 --:--`;
  const arrival = `预计到达 ${clockText(estimatedArrival(state, mode, now))}`;
  const status =
    guidanceView(state, mode, now).stale || state.locationStale
      ? `${total}\n${arrival} ${Math.floor(now / 1000) % 2 ? "●" : " "} 更新定位中`
      : `${total}\n${arrival}`;
  const departure = mode === "TRANSIT" ? departureText(state, now) : "";
  const withDeparture = departure
    ? `${departure}\n${status.replace("\n", "  ")}`
    : status;
  return state.transitPrompt
    ? `${withDeparture}\n${state.transitPrompt.message} · 双击菜单`
    : withDeparture;
}
