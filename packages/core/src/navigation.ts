import {
  NavError,
  isCoordinate,
  type Coordinate,
  type ImportedIntent,
  type Route,
} from "../../contracts/src/index";
import { distanceMeters, geometryLength, matchGeometry } from "./geometry";
export interface LocationFix {
  coordinate: Coordinate;
  timestamp: number;
  accuracyMeters?: number;
  speedMps?: number;
  heading?: number;
}
export type NavigationPhase =
  | "EMPTY"
  | "IMPORTING"
  | "DESTINATION_CONFIRMATION"
  | "PLANNING"
  | "ROUTE_SELECTION"
  | "NAVIGATING"
  | "ARRIVED"
  | "ENDED";
export interface NavigationState {
  phase: NavigationPhase;
  version: number;
  intent?: ImportedIntent;
  routes: Route[];
  route?: Route;
  legIndex: number;
  stepIndex: number;
  progressMeters: number;
  remainingMeters: number;
  location?: LocationFix;
  locationStale: boolean;
  offRoute: boolean;
  replanNeeded: boolean;
  paused: boolean;
  boarded: boolean;
}
export interface NavigationConfig {
  staleMs: number;
  maxAccuracyMeters: number;
  previewMaxAgeMs: number;
  originMovementMeters: number;
  offRouteMeters: number;
  offRouteSamples: number;
  replanCooldownMs: number;
  arrivalMeters: number;
}
export const DEFAULT_NAVIGATION_CONFIG: NavigationConfig = {
  staleMs: 15000,
  maxAccuracyMeters: 50,
  previewMaxAgeMs: 120000,
  originMovementMeters: 100,
  offRouteMeters: 60,
  offRouteSamples: 3,
  replanCooldownMs: 60000,
  arrivalMeters: 15,
};
export class NavigationSession {
  private state: NavigationState = {
    phase: "EMPTY",
    version: 0,
    routes: [],
    legIndex: 0,
    stepIndex: 0,
    progressMeters: 0,
    remainingMeters: 0,
    locationStale: true,
    offRoute: false,
    replanNeeded: false,
    paused: false,
    boarded: false,
  };
  private controller = new AbortController();
  private origin?: Coordinate;
  private farSamples = 0;
  private lastReplan = -Infinity;
  readonly config: NavigationConfig;
  constructor(config: Partial<NavigationConfig> = {}) {
    this.config = { ...DEFAULT_NAVIGATION_CONFIG, ...config };
  }
  get snapshot(): NavigationState {
    return structuredClone(this.state);
  }
  beginRequest(phase: "IMPORTING" | "PLANNING"): {
    version: number;
    signal: AbortSignal;
  } {
    this.controller.abort();
    this.controller = new AbortController();
    this.state = {
      ...this.state,
      version: this.state.version + 1,
      phase,
      replanNeeded: false,
    };
    if (phase === "IMPORTING") {
      this.state.routes = [];
      delete this.state.route;
      delete this.state.intent;
    }
    return { version: this.state.version, signal: this.controller.signal };
  }
  cancel(): void {
    this.controller.abort();
    this.state.version++;
    this.state.phase = this.state.route
      ? "NAVIGATING"
      : this.state.intent
        ? "DESTINATION_CONFIRMATION"
        : "EMPTY";
  }
  acceptImport(version: number, intent: ImportedIntent): boolean {
    if (
      version !== this.state.version ||
      this.controller.signal.aborted ||
      this.state.phase !== "IMPORTING"
    )
      return false;
    this.state = {
      ...this.state,
      phase: "DESTINATION_CONFIRMATION",
      intent: structuredClone(intent),
    };
    return true;
  }
  acceptRoutes(version: number, routes: Route[], origin: Coordinate): boolean {
    if (
      version !== this.state.version ||
      this.controller.signal.aborted ||
      this.state.phase !== "PLANNING"
    )
      return false;
    if (!routes.length || !isCoordinate(origin))
      throw new NavError("NO_ROUTE", "没有可用路线");
    for (const route of routes) {
      if (
        !route.legs.length ||
        !Number.isFinite(Date.parse(route.fetchedAt)) ||
        !Number.isFinite(Date.parse(route.expiresAt)) ||
        route.legs.some(
          (leg) =>
            !Number.isFinite(leg.distanceMeters) ||
            leg.distanceMeters < 0 ||
            leg.geometry.some((p) => !isCoordinate(p)),
        )
      )
        throw new NavError("NO_ROUTE", "路线数据无效");
    }
    this.origin = { ...origin };
    this.state = {
      ...this.state,
      phase: "ROUTE_SELECTION",
      routes: structuredClone(routes.slice(0, 3)),
    };
    return true;
  }
  start(routeId: string, fix: LocationFix, now = Date.now()): void {
    const route = this.state.routes.find((r) => r.id === routeId);
    if (this.state.phase !== "ROUTE_SELECTION" || !route)
      throw new NavError("NO_ROUTE", "请先选择实际返回的路线");
    if (!this.validFix(fix, now))
      throw new NavError("LOCATION_UNAVAILABLE", "需要新的可靠手机定位");
    const nextRide = route.legs.find((l) => l.mode === "RIDE");
    if (
      now >= Date.parse(route.expiresAt) ||
      now - Date.parse(route.fetchedAt) > this.config.previewMaxAgeMs ||
      (this.origin &&
        distanceMeters(this.origin, fix.coordinate) >
          this.config.originMovementMeters) ||
      (nextRide?.startTime && now > Date.parse(nextRide.startTime))
    ) {
      this.state.replanNeeded = true;
      throw new NavError(
        "NO_ROUTE",
        "预览已过期、起点移动或列车已发车，请重新查询",
      );
    }
    this.controller.abort();
    this.controller = new AbortController();
    this.state = {
      ...this.state,
      version: this.state.version + 1,
      phase: "NAVIGATING",
      route: structuredClone(route),
      legIndex: 0,
      stepIndex: 0,
      progressMeters: 0,
      remainingMeters: route.distanceMeters,
      location: structuredClone(fix),
      locationStale: false,
      offRoute: false,
      replanNeeded: false,
      paused: false,
      boarded: false,
    };
    this.farSamples = 0;
    this.lastReplan = -Infinity;
  }
  private validFix(fix: LocationFix, now: number): boolean {
    return (
      isCoordinate(fix.coordinate) &&
      Number.isFinite(fix.timestamp) &&
      fix.timestamp <= now + 5000 &&
      now - fix.timestamp <= this.config.staleMs &&
      (fix.accuracyMeters === undefined ||
        (Number.isFinite(fix.accuracyMeters) &&
          fix.accuracyMeters >= 0 &&
          fix.accuracyMeters <= this.config.maxAccuracyMeters))
    );
  }
  refreshHealth(now = Date.now()): void {
    this.state.locationStale =
      !this.state.location ||
      now - this.state.location.timestamp > this.config.staleMs;
    if (this.state.route && now >= Date.parse(this.state.route.expiresAt))
      this.state.replanNeeded = true;
    const leg = this.state.route?.legs[this.state.legIndex];
    if (leg?.mode === "WAIT" && leg.endTime && now > Date.parse(leg.endTime))
      this.state.replanNeeded = true;
  }
  updateLocation(fix: LocationFix, now = Date.now()): boolean {
    this.refreshHealth(now);
    if (
      this.state.phase !== "NAVIGATING" ||
      this.state.paused ||
      !this.validFix(fix, now)
    )
      return false;
    const previous = this.state.location;
    if (previous && fix.timestamp <= previous.timestamp) return false;
    const dt = previous ? (fix.timestamp - previous.timestamp) / 1000 : 0;
    const leg = this.state.route!.legs[this.state.legIndex];
    const maxSpeed = leg.mode === "WALK" || leg.mode === "TRANSFER" ? 12 : 100;
    if (
      previous &&
      dt > 0 &&
      distanceMeters(previous.coordinate, fix.coordinate) > maxSpeed * dt + 100
    )
      return false;
    this.state.location = structuredClone(fix);
    this.state.locationStale = false;
    // Train movement never proves boarding/alighting; the user explicitly confirms these boundaries.
    if (leg.mode === "RIDE" || leg.mode === "WAIT") return true;
    const match = matchGeometry(
      fix.coordinate,
      leg.geometry,
      Math.max(0, this.state.progressMeters - 30),
      this.state.progressMeters + Math.max(150, maxSpeed * dt + 50),
    );
    const far = !match || match.distanceMeters > this.config.offRouteMeters;
    this.farSamples = far
      ? this.farSamples + 1
      : match.distanceMeters < this.config.offRouteMeters * 0.6
        ? 0
        : this.farSamples;
    this.state.offRoute = this.farSamples >= this.config.offRouteSamples;
    if (
      this.state.offRoute &&
      now - this.lastReplan >= this.config.replanCooldownMs
    ) {
      this.state.replanNeeded = true;
      this.lastReplan = now;
    }
    if (far || !match) return true;
    this.state.progressMeters = Math.max(
      this.state.progressMeters,
      match.alongMeters,
    );
    let cumulative = 0;
    this.state.stepIndex = 0;
    for (let i = 0; i < leg.steps.length; i++) {
      cumulative +=
        geometryLength(leg.steps[i].geometry) || leg.steps[i].distanceMeters;
      this.state.stepIndex = i;
      if (cumulative > this.state.progressMeters) break;
    }
    this.state.remainingMeters =
      Math.max(0, geometryLength(leg.geometry) - this.state.progressMeters) +
      this.state
        .route!.legs.slice(this.state.legIndex + 1)
        .reduce((n, l) => n + l.distanceMeters, 0);
    const end = leg.geometry.at(-1);
    if (
      leg.mode !== "TRANSFER" &&
      end &&
      geometryLength(leg.geometry) - this.state.progressMeters <=
        this.config.arrivalMeters &&
      distanceMeters(fix.coordinate, end) <= this.config.arrivalMeters
    )
      this.advance();
    return true;
  }
  private advance(): void {
    this.state.legIndex++;
    this.state.boarded = false;
    this.state.progressMeters = 0;
    this.state.stepIndex = 0;
    this.farSamples = 0;
    this.state.offRoute = false;
    if (this.state.legIndex >= this.state.route!.legs.length) {
      this.state.legIndex = this.state.route!.legs.length - 1;
      this.state.phase = "ARRIVED";
      this.state.remainingMeters = 0;
      this.controller.abort();
    }
  }
  confirmTransit(action: "BOARDED" | "ALIGHTED" | "TRANSFER_COMPLETED"): void {
    if (this.state.phase !== "NAVIGATING" || this.state.paused)
      throw new NavError("INVALID_INPUT", "当前不在活动导航中");
    const leg = this.state.route!.legs[this.state.legIndex];
    if (
      action === "BOARDED" &&
      leg.mode === "WAIT" &&
      this.state.route!.legs[this.state.legIndex + 1]?.mode === "RIDE"
    ) {
      this.advance();
      this.state.boarded = true;
    } else if (action === "BOARDED" && leg.mode === "RIDE")
      this.state.boarded = true;
    else if (
      (action === "ALIGHTED" && leg.mode === "RIDE" && this.state.boarded) ||
      (action === "TRANSFER_COMPLETED" && leg.mode === "TRANSFER")
    )
      this.advance();
    else
      throw new NavError(
        "INVALID_INPUT",
        "确认动作与当前行程阶段不匹配，请先确认上车",
      );
  }
  pause(): void {
    if (this.state.phase === "NAVIGATING") this.state.paused = true;
  }
  resume(now = Date.now()): void {
    this.state.paused = false;
    this.refreshHealth(now);
  }
  end(): void {
    this.controller.abort();
    this.state.version++;
    this.state.phase = "ENDED";
    this.state.paused = false;
  }
}
export function replayLocations(
  session: NavigationSession,
  fixes: LocationFix[],
): NavigationState[] {
  return fixes.map((fix) => {
    session.updateLocation(fix, fix.timestamp);
    return session.snapshot;
  });
}
