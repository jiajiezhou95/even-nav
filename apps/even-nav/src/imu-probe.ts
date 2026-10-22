import {
  ImuReportPace,
  OsEventTypeList,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";

export type ImuProbePhase =
  "still" | "left" | "right" | "nod" | "tilt" | "phone";
export interface ImuProbeSample {
  /** Milliseconds since this session started, not wall time or sensor time. */
  receivedAt: number;
  phase: ImuProbePhase;
  x: number;
  y: number;
  z: number;
}
interface Range {
  min: number;
  max: number;
}
export interface ImuProbeSnapshot {
  status: "idle" | "starting" | "recording" | "stopped" | "error";
  phase: ImuProbePhase;
  startedAt: number | null; // 0 once started; no absolute timestamps exported.
  stoppedAt: number | null; // Elapsed milliseconds at stop.
  error: string | null;
  mayBeEnabled: boolean;
  samples: ImuProbeSample[];
  summary: {
    count: number;
    rateHz: number | null;
    axes: { x: Range | null; y: Range | null; z: Range | null };
    magnitude: Range | null;
  };
}

/** Public SDK diagnostics only. XYZ semantics are unknown; never infer yaw. */
export function createImuProbe(options: {
  bridge: Pick<EvenAppBridge, "imuControl" | "onEvenHubEvent">;
  now?: () => number;
  maxDurationMs?: number;
  maxSamples?: number;
  onChange?: () => void;
}) {
  const now = options.now ?? Date.now;
  const bounded = (
    value: number | undefined,
    fallback: number,
    ceiling: number,
  ) =>
    value !== undefined && Number.isFinite(value)
      ? Math.max(1, Math.min(ceiling, Math.floor(value)))
      : fallback;
  const duration = bounded(options.maxDurationMs, 60_000, 60_000);
  const limit = bounded(options.maxSamples, 6000, 6000);
  let status: ImuProbeSnapshot["status"] = "idle";
  let phase: ImuProbePhase = "still";
  let samples: ImuProbeSample[] = [];
  let startedAt: number | null = null;
  let stoppedAt: number | null = null;
  let error: string | null = null;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingStart: Promise<boolean> | undefined;
  let pendingStop: Promise<void> | undefined;
  let mayBeEnabled = false;
  const notify = () => options.onChange?.();
  const fail = (message: string) => {
    error = message;
    status = "error";
  };
  function detach() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
  }
  function stop(): Promise<void> {
    if (pendingStop) return pendingStop;
    if (status !== "starting" && status !== "recording" && !mayBeEnabled)
      return Promise.resolve();
    status = "stopped";
    stoppedAt = now();
    detach();
    const starting = pendingStart;
    pendingStop = (async () => {
      // A late successful start must be followed by a stop, never leak reporting.
      if (starting) await starting.catch(() => false);
      try {
        if (!(await options.bridge.imuControl(false))) {
          fail(
            "IMU stop was not acknowledged. Reporting may still be enabled; retry Stop.",
          );
        } else {
          mayBeEnabled = false;
          error = null;
        }
      } catch {
        fail("IMU stop failed. Reporting may still be enabled; retry Stop.");
      } finally {
        pendingStop = undefined;
        notify();
      }
    })();
    notify();
    return pendingStop;
  }
  async function start(): Promise<boolean> {
    if (pendingStop) await pendingStop;
    if (pendingStart || status === "recording" || mayBeEnabled) return false;
    samples = [];
    error = null;
    startedAt = now();
    stoppedAt = null;
    status = "starting";
    // Caller guarantees that the glasses startup page has succeeded.
    try {
      unsubscribe = options.bridge.onEvenHubEvent((event) => {
        if (status !== "recording") return;
        const receivedAt = Math.max(0, now() - (startedAt ?? now()));
        if (receivedAt >= duration) {
          void stop();
          return;
        }
        const sys = event.sysEvent;
        if (sys?.eventType !== OsEventTypeList.IMU_DATA_REPORT) return;
        const xyz = sys.imuData;
        if (
          !xyz ||
          ![xyz.x, xyz.y, xyz.z].every(
            (value) => typeof value === "number" && Number.isFinite(value),
          )
        )
          return;
        samples.push({
          receivedAt,
          phase,
          x: xyz.x!,
          y: xyz.y!,
          z: xyz.z!,
        });
        if (samples.length >= limit) void stop();
        else notify();
      });
      timer = setTimeout(() => void stop(), duration);
      mayBeEnabled = true;
      pendingStart = options.bridge.imuControl(true, ImuReportPace.P100);
      notify();
      const enabled = await pendingStart;
      if (status !== "starting") return false;
      if (!enabled) {
        mayBeEnabled = false;
        fail("IMU start was not acknowledged.");
        detach();
        return false;
      }
      status = "recording";
      return true;
    } catch {
      if (status === "starting") {
        fail("IMU start failed.");
        detach();
        pendingStart = undefined;
        if (mayBeEnabled) {
          await stop();
          if (!mayBeEnabled) fail("IMU start failed; reporting was stopped.");
        }
      }
      return false;
    } finally {
      pendingStart = undefined;
      notify();
    }
  }
  function snapshot(): ImuProbeSnapshot {
    const range = (values: number[]): Range | null =>
      values.length
        ? { min: Math.min(...values), max: Math.max(...values) }
        : null;
    const elapsed =
      samples.length > 1
        ? samples[samples.length - 1]!.receivedAt - samples[0]!.receivedAt
        : 0;
    return {
      status,
      phase,
      startedAt: startedAt === null ? null : 0,
      stoppedAt:
        stoppedAt === null
          ? null
          : Math.max(0, stoppedAt - (startedAt ?? stoppedAt)),
      error,
      mayBeEnabled,
      samples: samples.map((sample) => ({ ...sample })),
      summary: {
        count: samples.length,
        rateHz: elapsed > 0 ? ((samples.length - 1) * 1000) / elapsed : null,
        axes: {
          x: range(samples.map((sample) => sample.x)),
          y: range(samples.map((sample) => sample.y)),
          z: range(samples.map((sample) => sample.z)),
        },
        magnitude: range(
          samples.map((sample) => Math.hypot(sample.x, sample.y, sample.z)),
        ),
      },
    };
  }
  return {
    start,
    stop,
    snapshot,
    setPhase(value: ImuProbePhase) {
      if (!["still", "left", "right", "nod", "tilt", "phone"].includes(value))
        return;
      phase = value;
      notify();
    },
  };
}
