import type { Route } from "../../../packages/contracts/src/index";
import type { HudRouteStep } from "./hud-menu";
import { transitLineLabel } from "./transit-departure";

export function isTransitOverview(route: Route) {
  return (
    route.provider === "TRANSITOUS" ||
    route.legs.some((leg) => ["WAIT", "RIDE", "TRANSFER"].includes(leg.mode))
  );
}
function clock(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "";
}
function stationAccessOverview(leg: Route["legs"][number]): string[] {
  const seen = new Set<string>();
  return [leg.fromStop, leg.toStop].flatMap((stop) => {
    const access = stop?.stationAccess;
    if (!access?.gateways.length || seen.has(access.nodeId)) return [];
    seen.add(access.nodeId);
    if (access.selectedGateway) {
      const selected = access.selectedGateway;
      return [
        `${stop?.name ? `${stop.name} · ` : ""}建议${selected.reference === "WALK_ORIGIN" ? "入口" : "出口"}：${selected.name}（直线最近 ${Math.round(selected.distanceMeters)}米）`,
      ];
    }
    return [
      `${stop?.name ? `${stop.name} · ` : ""}可选出入口（NAVITIME）`,
      ...new Set(access.gateways.map((gateway) => gateway.name)),
    ];
  });
}
/** Segment-level information only: walking turn instructions remain in live navigation. */
export function transitLegOverview(leg: Route["legs"][number]): string {
  const from = leg.fromStop?.name || leg.from;
  const to = leg.toStop?.name || leg.to;
  const minutes = `${Math.ceil(leg.durationSeconds / 60)}分钟`;
  const platform = leg.fromStop?.platform || leg.platform;
  const platformText = platform
    ? `${platform}站台`
    : leg.fromStop?.scheduledPlatform
      ? `计划${leg.fromStop.scheduledPlatform}站台`
      : "";
  const departure = clock(
    leg.mode === "WAIT"
      ? leg.endTime ||
          leg.fromStop?.departureTime ||
          leg.fromStop?.scheduledDepartureTime
      : leg.fromStop?.departureTime ||
          leg.startTime ||
          leg.fromStop?.scheduledDepartureTime,
  );
  const arrival = clock(
    leg.toStop?.arrivalTime || leg.endTime || leg.toStop?.scheduledArrivalTime,
  );
  if (leg.mode === "WALK" || leg.mode === "TRANSFER")
    return [
      `${leg.mode === "TRANSFER" ? "换乘步行" : "步行"} ${Math.round(leg.distanceMeters)}米 · ${minutes}`,
      [from, to].filter(Boolean).join(" → "),
      ...new Set(
        leg.steps
          .map((step) => step.instruction)
          .filter((text) =>
            /入口|出口|出入口|出站|入站|改札|entrance|\bexit\b/i.test(text),
          ),
      ),
      ...stationAccessOverview(leg),
    ]
      .filter(Boolean)
      .join("\n");
  if (leg.mode === "WAIT")
    return [
      `候车 ${transitLineLabel(leg.line)} · ${minutes}`,
      from || to,
      [platformText, departure && `出发 ${departure}`]
        .filter(Boolean)
        .join(" · "),
      ...stationAccessOverview(leg),
    ]
      .filter(Boolean)
      .join("\n");
  const stops = leg.intermediateStops?.map((stop, index) => {
    const at = clock(stop.arrivalTime || stop.scheduledArrivalTime);
    return [
      stop.name || `未命名站点${index + 1}`,
      at,
      stop.platform
        ? `${stop.platform}站台`
        : stop.scheduledPlatform
          ? `计划${stop.scheduledPlatform}站台`
          : "",
      stop.cancelled && "停靠取消",
    ]
      .filter(Boolean)
      .join(" · ");
  });
  return [
    `乘坐 ${transitLineLabel(leg.line)}${leg.headsign ? ` · 往${leg.headsign}` : ""} · ${minutes}`,
    `${from || "上车站未提供"}${platformText ? ` · ${platformText}` : ""}${departure ? ` · 出发 ${departure}` : ""}`,
    stops === undefined
      ? "中途站未提供"
      : stops.length
        ? `途经停靠站：\n${stops.join("\n")}`
        : "无中途停靠站",
    `${to || "下车站未提供"}${arrival ? ` · 到达 ${arrival}` : ""}`,
    leg.staySeated ? "直通无需下车" : "",
    leg.realtime ? "包含实时更新" : "时刻表时间（无实时延误数据）",
    ...stationAccessOverview(leg),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Preserve provider-normalized instructions and every transit leg, including step-less legs. */
export function routeOverviewSteps(
  route: Route,
  legIndex: number,
  stepIndex: number,
): HudRouteStep[] {
  if (isTransitOverview(route))
    return route.legs.map((leg, index) => ({
      text: `${transitLegOverview(leg)}${index === route.legs.length - 1 ? "\n未显示的站台或出入口尚未匹配到可靠信息" : ""}`,
      current: index === legIndex,
    }));
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
