import type { Route } from "../../../packages/contracts/src/index";
import type { HudRouteStep } from "./hud-menu";

/** Preserve provider-normalized instructions and every transit leg, including step-less legs. */
export function routeOverviewSteps(
  route: Route,
  legIndex: number,
  stepIndex: number,
): HudRouteStep[] {
  return route.legs.flatMap((leg, index) => {
    const mode = {
      WALK: "步行",
      DRIVE: "驾驶",
      WAIT: "候车",
      RIDE: "乘车",
      TRANSFER: "换乘",
    }[leg.mode];
    const transit = !["WALK", "DRIVE"].includes(leg.mode);
    const summary = [
      mode,
      leg.line,
      leg.headsign && `往${leg.headsign}`,
      [leg.from, leg.to].filter(Boolean).join(" → "),
      leg.platform && `${leg.platform}站台`,
      leg.staySeated && "直通无需下车",
    ]
      .filter(Boolean)
      .join(" · ");
    if (!leg.steps.length)
      return [{ text: summary, current: index === legIndex }];
    return leg.steps.map((step, position) => ({
      text: [
        transit && summary,
        step.instruction,
        `${Math.round(step.distanceMeters)}米`,
      ]
        .filter(Boolean)
        .join(" · "),
      current: index === legIndex && position === stepIndex,
    }));
  });
}
