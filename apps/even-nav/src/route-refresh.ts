import type { NavigationState } from "../../../packages/core/src/navigation";
import { distanceMeters } from "../../../packages/core/src/geometry";

function reliable(state: NavigationState, now: number) {
  const fix = state.location;
  return Boolean(
    fix &&
    !state.locationStale &&
    fix.timestamp <= now &&
    now - fix.timestamp <= 5000 &&
    Number.isFinite(fix.accuracyMeters) &&
    fix.accuracyMeters! >= 0 &&
    fix.accuracyMeters! <= 25,
  );
}

export interface RouteRefreshTicket {
  version: number;
  routeId: string;
  legIndex: number;
  origin: { lat: number; lng: number };
  timestamp: number;
}

/** Confirmation belongs to the navigation engine. This bounds provider requests per episode. */
export class OffRouteRefresh {
  private key = "";
  private attempts = 0;
  private lastStarted = -Infinity;
  private previous?: RouteRefreshTicket;

  stopRetries() {
    this.attempts = 3;
  }
  get canRetry() {
    return this.attempts < 3;
  }

  observe(state: NavigationState, now = Date.now()) {
    const key = `${state.version}/${state.route?.id}/${state.legIndex}`;
    if (key !== this.key || (!state.offRoute && reliable(state, now))) {
      this.key = key;
      this.attempts = 0;
      this.lastStarted = -Infinity;
      this.previous = undefined;
    }
  }

  begin(
    state: NavigationState,
    now = Date.now(),
  ): RouteRefreshTicket | undefined {
    this.observe(state, now);
    if (
      !this.eligible(state, now) ||
      this.attempts >= 3 ||
      now - this.lastStarted < 60000
    )
      return;
    const fix = state.location!;
    if (
      this.previous &&
      (fix.timestamp <= this.previous.timestamp ||
        distanceMeters(fix.coordinate, this.previous.origin) < 10)
    )
      return;
    this.attempts++;
    this.lastStarted = now;
    this.previous = {
      version: state.version,
      routeId: state.route!.id,
      legIndex: state.legIndex,
      origin: { ...fix.coordinate },
      timestamp: fix.timestamp,
    };
    return this.previous;
  }

  private eligible(state: NavigationState, now: number) {
    return (
      state.phase === "NAVIGATING" &&
      !state.paused &&
      state.offRoute &&
      ["WALK", "TRANSFER", "DRIVE"].includes(
        state.route?.legs[state.legIndex]?.mode || "",
      ) &&
      reliable(state, now)
    );
  }

  applicable(
    ticket: RouteRefreshTicket,
    state: NavigationState,
    now = Date.now(),
  ) {
    return (
      this.eligible(state, now) &&
      state.version === ticket.version &&
      state.route?.id === ticket.routeId &&
      state.legIndex === ticket.legIndex &&
      distanceMeters(ticket.origin, state.location!.coordinate) <= 50
    );
  }
}
