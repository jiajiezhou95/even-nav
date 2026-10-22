import {
  NavError,
  isCoordinate,
  type Coordinate,
  type ImportedIntent,
  type Route,
} from "../../contracts/src/index";
import { distanceMeters, geometryLength, matchGeometry } from "./geometry";
import { inferTransitAction } from "./transit-inference";
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
  /** Distance to the end of the current step; stale fixes never advance it. */
  stepRemainingMeters: number;
  location?: LocationFix;
  locationStale: boolean;
  offRoute: boolean;
  /** Confirmed walking against the route; distinct from leaving its geometry. */
  wrongWay?: boolean;
  replanNeeded: boolean;
  paused: boolean;
  boarded: boolean;
  transitPrompt?: TransitPrompt;
}
export type TransitAction =
  "BOARDED" | "ALIGHTED" | "TRANSFER_COMPLETED" | "STAY_SEATED";

export interface TransitPrompt {
  id: string;
  action: TransitAction;
  message: string;
}

/** Manual override remains available even when automatic evidence is inconclusive. */
export function availableTransitAction(
  state: NavigationState,
): TransitAction | undefined {
  if (state.phase !== "NAVIGATING" || state.paused) return undefined;
  const leg = state.route?.legs[state.legIndex];
  const next = state.route?.legs[state.legIndex + 1];
  if (leg?.mode === "WAIT" && next?.mode === "RIDE") return "BOARDED";
  if (leg?.mode === "TRANSFER") return "TRANSFER_COMPLETED";
  if (leg?.mode !== "RIDE") return undefined;
  if (!state.boarded) return "BOARDED";
  return next?.mode === "RIDE" && next.staySeated ? "STAY_SEATED" : "ALIGHTED";
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
function firstStepMeters(leg: Route["legs"][number] | undefined): number {
  const step = leg?.steps[0];
  return step
    ? step.geometry.length
      ? geometryLength(step.geometry)
      : step.distanceMeters
    : 0;
}
export class NavigationSession {
  private state: NavigationState = {
    phase: "EMPTY",
    version: 0,
    routes: [],
    legIndex: 0,
    stepIndex: 0,
    progressMeters: 0,
    remainingMeters: 0,
    stepRemainingMeters: 0,
    locationStale: true,
    offRoute: false,
    wrongWay: false,
    replanNeeded: false,
    paused: false,
    boarded: false,
  };
  private controller = new AbortController();
  private origin?: Coordinate;
  private farSamples = 0;
  private farSince = 0;
  private lastDeviationFix = 0;
  private backwardSince = 0;
  private backwardSamples = 0;
  private wrongWayAnchor = 0;
  private forwardSince = 0;
  private forwardSamples = 0;
  private lastReplan = -Infinity;
  private missedDeparture = false;
  private offRouteReplanNeeded = false;
  private transitSamples: LocationFix[] = [];
  private clockNow = 0;
  private stageStartedAt = 0;
  private promptKey = "";
  private promptCount = 0;
  private nextPromptAt = 0;
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
    this.resetTransitEvidence();
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
      this.state.stepRemainingMeters = 0;
    }
    return { version: this.state.version, signal: this.controller.signal };
  }
  cancel(): void {
    this.controller.abort();
    this.resetTransitEvidence();
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
    const previewExpired =
      now >= Date.parse(route.expiresAt) ||
      now - Date.parse(route.fetchedAt) > this.config.previewMaxAgeMs;
    const originMoved = Boolean(
      this.origin &&
      distanceMeters(this.origin, fix.coordinate) >
        this.config.originMovementMeters,
    );
    const departed = Boolean(
      nextRide?.startTime && now > Date.parse(nextRide.startTime),
    );
    if (previewExpired || originMoved || departed) {
      this.state.replanNeeded = true;
      throw new NavError(
        "NO_ROUTE",
        previewExpired
          ? "路线预览时间已失效，请重新查询"
          : originMoved
            ? "当前定位与查询起点相差较大，请按当前位置重新查询"
            : "所选班次已发车，请查询下一班",
        true,
        "",
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
      stepRemainingMeters: firstStepMeters(route.legs[0]),
      location: structuredClone(fix),
      locationStale: false,
      offRoute: false,
      wrongWay: false,
      replanNeeded: false,
      paused: false,
      boarded: false,
    };
    this.resetMotionEvidence();
    this.lastReplan = -Infinity;
    this.missedDeparture = false;
    this.offRouteReplanNeeded = false;
    this.clockNow = now;
    this.resetTransitEvidence();
    this.transitSamples = fix.timestamp <= now ? [structuredClone(fix)] : [];
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
    this.clockNow = now;
    this.state.locationStale =
      !this.state.location ||
      now - this.state.location.timestamp > this.config.staleMs;
    if (this.state.locationStale) this.transitSamples = [];
    // Provider TTL governs preview freshness, not a journey already underway.
    if (this.state.phase === "NAVIGATING") {
      if (this.missedDeparture)
        this.state.replanNeeded = this.offRouteReplanNeeded;
      const legs = this.state.route!.legs;
      const leg = legs[this.state.legIndex];
      const nextRide = legs
        .slice(this.state.legIndex)
        .find((item) => item.mode === "RIDE");
      const departure =
        nextRide?.startTime ?? (leg.mode === "WAIT" ? leg.endTime : undefined);
      this.missedDeparture =
        !this.state.boarded && !!departure && now > Date.parse(departure);
      if (this.missedDeparture) this.state.replanNeeded = true;
    } else if (this.state.phase === "ROUTE_SELECTION") {
      if (this.state.routes.some((route) => now >= Date.parse(route.expiresAt)))
        this.state.replanNeeded = true;
    }
    this.updateTransitPrompt(now);
  }
  updateLocation(fix: LocationFix, now = Date.now()): boolean {
    this.refreshHealth(now);
    if (
      this.state.phase !== "NAVIGATING" ||
      this.state.paused ||
      !this.validFix(fix, now)
    ) {
      this.transitSamples = [];
      this.resetMotionEvidence();
      return false;
    }
    const previous = this.state.location;
    if (previous && fix.timestamp <= previous.timestamp) return false;
    const dt = previous ? (fix.timestamp - previous.timestamp) / 1000 : 0;
    let leg = this.state.route!.legs[this.state.legIndex];
    if (fix.timestamp > now && leg.mode !== "RIDE" && leg.mode !== "WAIT") {
      this.resetMotionEvidence();
      return false;
    }
    const maxSpeed = leg.mode === "WALK" || leg.mode === "TRANSFER" ? 12 : 100;
    if (
      previous &&
      dt > 0 &&
      distanceMeters(previous.coordinate, fix.coordinate) > maxSpeed * dt + 100
    ) {
      this.transitSamples = [];
      this.resetMotionEvidence();
      return false;
    }
    this.state.location = structuredClone(fix);
    this.state.locationStale = false;
    if (
      fix.timestamp <= now &&
      fix.accuracyMeters !== undefined &&
      fix.accuracyMeters <= 20
    ) {
      this.transitSamples.push(structuredClone(fix));
      this.transitSamples = this.transitSamples
        .filter((sample) => sample.timestamp >= now - 60000)
        .slice(-61);
    } else this.transitSamples = [];
    const inferred = inferTransitAction(this.state, this.transitSamples, now);
    if (inferred && inferred === availableTransitAction(this.state)) {
      this.confirmTransit(inferred);
      leg = this.state.route!.legs[this.state.legIndex];
    }
    if (leg.mode === "RIDE" || leg.mode === "WAIT") {
      if (
        leg.mode === "RIDE" &&
        this.state.boarded &&
        fix.timestamp <= now &&
        dt > 0 &&
        (!previous ||
          distanceMeters(previous.coordinate, fix.coordinate) / dt <= 70) &&
        fix.accuracyMeters !== undefined &&
        fix.accuracyMeters <= 20
      ) {
        const railMatch = matchGeometry(
          fix.coordinate,
          leg.geometry,
          Math.max(0, this.state.progressMeters - 30),
          this.state.progressMeters + Math.max(150, 70 * dt),
        );
        if (railMatch && railMatch.distanceMeters <= 25) {
          this.state.progressMeters = Math.max(
            this.state.progressMeters,
            railMatch.alongMeters,
          );
          this.state.remainingMeters =
            Math.max(
              0,
              leg.distanceMeters *
                (1 -
                  this.state.progressMeters /
                    Math.max(1, geometryLength(leg.geometry))),
            ) +
            this.state
              .route!.legs.slice(this.state.legIndex + 1)
              .reduce((n, item) => n + item.distanceMeters, 0);
        }
      }
      return true;
    }
    const walking = leg.mode === "WALK" || leg.mode === "TRANSFER";
    const matchWindow = walking
      ? Math.max(60, Math.min(150, maxSpeed * dt + 30))
      : Math.max(150, maxSpeed * dt + 50);
    const match = matchGeometry(
      fix.coordinate,
      leg.geometry,
      Math.max(0, this.state.progressMeters - matchWindow),
      // Sparse but valid updates can cover more than 150 m. Keep the original
      // speed/time forward bound; only the new reverse search has a fixed cap.
      this.state.progressMeters + Math.max(150, maxSpeed * dt + 50),
    );
    const reliable =
      now - fix.timestamp <= 5000 &&
      fix.accuracyMeters !== undefined &&
      fix.accuracyMeters <= 25;
    const threshold = !reliable
      ? this.config.offRouteMeters
      : Math.max(
          walking
            ? Math.min(30, this.config.offRouteMeters)
            : this.config.offRouteMeters,
          2 * (fix.accuracyMeters ?? this.config.maxAccuracyMeters),
        );
    const far = !match || match.distanceMeters > threshold;
    if (!reliable) {
      this.resetMotionEvidence();
    } else {
      if (fix.timestamp - this.lastDeviationFix > this.config.staleMs)
        this.resetMotionEvidence();
      this.lastDeviationFix = fix.timestamp;
      if (far) {
        if (!this.farSamples) this.farSince = fix.timestamp;
        this.farSamples++;
        if (
          this.farSamples >= this.config.offRouteSamples &&
          fix.timestamp - this.farSince >= 4000
        )
          this.state.offRoute = true;
      } else if (match.distanceMeters < threshold * 0.6) {
        this.farSamples = 0;
        this.state.offRoute = false;
        this.offRouteReplanNeeded = false;
        this.state.replanNeeded = this.missedDeparture;
      }
      if (
        this.state.offRoute &&
        now - this.lastReplan >= this.config.replanCooldownMs
      ) {
        this.state.replanNeeded = true;
        this.offRouteReplanNeeded = true;
        this.lastReplan = now;
      }
    }
    if (far || !match) {
      this.backwardSamples = 0;
      this.forwardSamples = 0;
      return true;
    }
    const jitterMeters = Math.max(12, 2 * fix.accuracyMeters!);
    if (reliable && this.state.wrongWay) {
      this.wrongWayAnchor = Math.min(this.wrongWayAnchor, match.alongMeters);
      if (match.alongMeters - this.wrongWayAnchor > jitterMeters) {
        if (!this.forwardSamples) this.forwardSince = fix.timestamp;
        this.forwardSamples++;
        if (
          this.forwardSamples >= 2 &&
          fix.timestamp - this.forwardSince >= 2000
        )
          this.state.wrongWay = false;
      } else this.forwardSamples = 0;
    }
    const backward =
      reliable &&
      walking &&
      this.state.progressMeters - match.alongMeters > jitterMeters;
    if (backward) {
      if (!this.backwardSamples) this.backwardSince = fix.timestamp;
      this.backwardSamples++;
      if (
        this.backwardSamples >= 2 &&
        fix.timestamp - this.backwardSince >= 2000
      ) {
        this.state.progressMeters = match.alongMeters;
        this.state.wrongWay = true;
        this.wrongWayAnchor = match.alongMeters;
        this.forwardSamples = 0;
      }
    } else {
      this.backwardSamples = 0;
      this.state.progressMeters = Math.max(
        this.state.progressMeters,
        match.alongMeters,
      );
    }
    let cumulative = 0;
    this.state.stepIndex = 0;
    for (let i = 0; i < leg.steps.length; i++) {
      cumulative += leg.steps[i].geometry.length
        ? geometryLength(leg.steps[i].geometry)
        : leg.steps[i].distanceMeters;
      this.state.stepIndex = i;
      if (cumulative > this.state.progressMeters) break;
    }
    this.state.stepRemainingMeters = Math.max(
      0,
      cumulative - this.state.progressMeters,
    );
    this.state.remainingMeters =
      Math.max(0, geometryLength(leg.geometry) - this.state.progressMeters) +
      this.state
        .route!.legs.slice(this.state.legIndex + 1)
        .reduce((n, l) => n + l.distanceMeters, 0);
    const end = leg.geometry.at(-1);
    if (
      !inferred &&
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
    this.state.remainingMeters = this.state
      .route!.legs.slice(this.state.legIndex)
      .reduce((meters, leg) => meters + leg.distanceMeters, 0);
    this.state.stepRemainingMeters = firstStepMeters(
      this.state.route!.legs[this.state.legIndex],
    );
    this.resetMotionEvidence();
    this.state.offRoute = false;
    this.state.wrongWay = false;
    this.offRouteReplanNeeded = false;
    this.state.replanNeeded = this.missedDeparture;
    this.resetTransitEvidence();
    if (this.state.location && this.state.location.timestamp <= this.clockNow)
      this.transitSamples = [structuredClone(this.state.location)];
    if (this.state.legIndex >= this.state.route!.legs.length) {
      this.state.legIndex = this.state.route!.legs.length - 1;
      this.state.phase = "ARRIVED";
      this.state.remainingMeters = 0;
      this.controller.abort();
    }
  }
  confirmTransit(action: TransitAction): void {
    if (!action || action !== availableTransitAction(this.state))
      throw new NavError(
        "INVALID_INPUT",
        "确认动作与当前行程阶段不匹配，请先确认上车",
      );
    const leg = this.state.route!.legs[this.state.legIndex];
    if (action === "BOARDED") {
      if (leg.mode === "WAIT") this.advance();
      this.state.boarded = true;
    } else {
      this.advance();
      if (action === "STAY_SEATED") this.state.boarded = true;
    }
    if (this.state.boarded && this.missedDeparture) {
      this.missedDeparture = false;
      this.state.replanNeeded = this.offRouteReplanNeeded;
    }
    this.resetTransitEvidence();
    if (this.state.location && this.state.location.timestamp <= this.clockNow)
      this.transitSamples = [structuredClone(this.state.location)];
  }
  private resetTransitEvidence(): void {
    this.transitSamples = [];
    this.stageStartedAt = this.clockNow;
    this.promptKey = "";
    this.promptCount = 0;
    this.nextPromptAt = 0;
    delete this.state.transitPrompt;
  }
  private resetMotionEvidence(): void {
    this.farSamples = 0;
    this.farSince = 0;
    this.lastDeviationFix = 0;
    this.backwardSamples = 0;
    this.backwardSince = 0;
    this.forwardSamples = 0;
  }
  private updateTransitPrompt(now: number): void {
    const action = availableTransitAction(this.state);
    if (!action) {
      delete this.state.transitPrompt;
      return;
    }
    const key = `${this.state.version}:${this.state.legIndex}:${action}`;
    if (this.promptKey !== key) {
      this.promptKey = key;
      this.promptCount = 0;
      this.nextPromptAt = this.stageStartedAt + 60000;
      delete this.state.transitPrompt;
    }
    if (
      this.state.transitPrompt ||
      now < this.nextPromptAt ||
      this.promptCount >= 2
    )
      return;
    const leg = this.state.route!.legs[this.state.legIndex];
    const boundary = Date.parse(
      (action === "BOARDED" && leg.mode === "RIDE"
        ? leg.startTime
        : leg.endTime) ?? "",
    );
    if (
      Number.isFinite(boundary)
        ? now < boundary
        : now < this.stageStartedAt + 120000
    )
      return;
    const messages: Record<TransitAction, string> = {
      BOARDED: "定位不足以确认：已经上车了吗？",
      ALIGHTED: "定位不足以确认：已经下车了吗？",
      TRANSFER_COMPLETED: "是否已到下一班车的候车位置？",
      STAY_SEATED: "是否已随原车进入下一段线路？",
    };
    this.promptCount++;
    this.state.transitPrompt = {
      id: `${key}:${this.promptCount}`,
      action,
      message: messages[action],
    };
  }
  deferTransitPrompt(now = Date.now()): void {
    if (!this.state.transitPrompt) return;
    delete this.state.transitPrompt;
    this.nextPromptAt = now + 120000;
  }
  pause(): void {
    if (this.state.phase === "NAVIGATING") {
      this.state.paused = true;
      this.resetMotionEvidence();
      this.resetTransitEvidence();
    }
  }
  resume(now = Date.now()): void {
    this.state.paused = false;
    this.clockNow = now;
    this.resetTransitEvidence();
    this.refreshHealth(now);
  }
  end(): void {
    this.controller.abort();
    this.state.version++;
    this.state.phase = "ENDED";
    this.state.stepRemainingMeters = 0;
    this.state.paused = false;
    this.resetTransitEvidence();
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
