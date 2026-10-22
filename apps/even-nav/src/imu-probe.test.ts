import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvenAppBridge, EvenHubEvent } from "@evenrealities/even_hub_sdk";
import { createImuProbe } from "./imu-probe";

function harness(
  options: {
    maxSamples?: number;
    maxDurationMs?: number;
    now?: () => number;
  } = {},
) {
  let listener: ((event: EvenHubEvent) => void) | undefined;
  const unsubscribe = vi.fn(() => {
    listener = undefined;
  });
  const imuControl = vi.fn(async () => true);
  const bridge = {
    imuControl,
    onEvenHubEvent: vi.fn((callback) => {
      listener = callback;
      return unsubscribe;
    }),
  } as unknown as Pick<EvenAppBridge, "imuControl" | "onEvenHubEvent">;
  const probe = createImuProbe({ bridge, ...options });
  return {
    probe,
    imuControl,
    unsubscribe,
    emit(data: unknown, eventType = 8) {
      listener?.({ sysEvent: { eventType, imuData: data } } as EvenHubEvent);
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("bounded public SDK XYZ probe", () => {
  it("keeps only finite XYZ, phase and elapsed receive time with independent snapshots", async () => {
    vi.useFakeTimers();
    const h = harness();
    expect(await h.probe.start()).toBe(true);
    for (const value of [
      null,
      {},
      { x: 0, y: 1 },
      { x: "1", y: 2, z: 3 },
      { x: NaN, y: 0, z: 1 },
      { x: Infinity, y: 1, z: 0 },
    ])
      h.emit(value);
    h.emit({ x: 1, y: 2, z: 3 }, 0);
    h.emit({ x: 3, y: 4, z: 0, latitude: 35 });
    vi.advanceTimersByTime(100);
    h.probe.setPhase("phone");
    h.emit({ x: 0, y: 0, z: 1 });
    const snapshot = h.probe.snapshot();
    expect(snapshot.samples).toEqual([
      { x: 3, y: 4, z: 0, receivedAt: 0, phase: "still" },
      { x: 0, y: 0, z: 1, receivedAt: 100, phase: "phone" },
    ]);
    expect(snapshot.summary).toEqual({
      count: 2,
      rateHz: 10,
      axes: {
        x: { min: 0, max: 3 },
        y: { min: 0, max: 4 },
        z: { min: 0, max: 1 },
      },
      magnitude: { min: 1, max: 5 },
    });
    snapshot.samples[0]!.x = 999;
    expect(h.probe.snapshot().samples[0]!.x).toBe(3);
    await h.probe.stop();
    h.emit({ x: 2, y: 3, z: 4 });
    expect(h.probe.snapshot().samples).toHaveLength(2);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });
  it("stops at the sample bound and allows a new empty session", async () => {
    const h = harness({ maxSamples: 1 });
    await h.probe.start();
    h.emit({ x: 0, y: 0, z: 0 });
    await h.probe.stop();
    expect(h.imuControl).toHaveBeenLastCalledWith(false);
    expect(h.probe.snapshot().status).toBe("stopped");
    await h.probe.start();
    expect(h.probe.snapshot().samples).toEqual([]);
    await h.probe.stop();
  });
  it("caps duration at 60 seconds and detaches on automatic stop", async () => {
    vi.useFakeTimers();
    const h = harness({ maxDurationMs: 900_000 });
    await h.probe.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.probe.snapshot().status).toBe("stopped");
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.imuControl).toHaveBeenLastCalledWith(false);
  });
  it("stops a late successful enable after manual stop during startup", async () => {
    const h = harness();
    let resolve!: (value: boolean) => void;
    h.imuControl.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const starting = h.probe.start();
    const stopping = h.probe.stop();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    resolve(true);
    expect(await starting).toBe(false);
    await stopping;
    expect(h.imuControl).toHaveBeenLastCalledWith(false);
    expect(h.probe.snapshot().status).toBe("stopped");
  });
  it("handles start and stop failures without unhandled rejection or listener leaks", async () => {
    const h = harness();
    h.imuControl.mockResolvedValueOnce(false);
    expect(await h.probe.start()).toBe(false);
    expect(h.probe.snapshot().status).toBe("error");
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    await h.probe.start();
    h.imuControl.mockRejectedValueOnce(
      new Error("host details must not be exported"),
    );
    await h.probe.stop();
    expect(h.probe.snapshot().error).toBe(
      "IMU stop failed. Reporting may still be enabled; retry Stop.",
    );
    expect(await h.probe.start()).toBe(false);
    await h.probe.stop();
    expect(h.probe.snapshot().status).toBe("stopped");
    expect(h.probe.snapshot().error).toBeNull();
  });
  it("allows a manual stop retry after negative acknowledgement", async () => {
    const h = harness();
    await h.probe.start();
    h.imuControl.mockResolvedValueOnce(false);
    await h.probe.stop();
    expect(h.probe.snapshot().error).toContain("retry Stop");
    expect(h.probe.snapshot().mayBeEnabled).toBe(true);
    expect(await h.probe.start()).toBe(false);
    await h.probe.stop();
    expect(h.imuControl).toHaveBeenCalledTimes(3);
    expect(h.probe.snapshot().status).toBe("stopped");
    expect(h.probe.snapshot().mayBeEnabled).toBe(false);
  });
  it("rejects samples past the deadline even when the timer has not fired", async () => {
    let time = 0;
    const h = harness({ now: () => time });
    await h.probe.start();
    h.emit({ x: 1, y: 2, z: 3 });
    time = 60_000;
    h.emit({ x: 4, y: 5, z: 6 });
    await h.probe.stop();
    expect(h.probe.snapshot().samples).toHaveLength(1);
    expect(h.probe.snapshot().status).toBe("stopped");
    expect(h.imuControl).toHaveBeenLastCalledWith(false);
  });
  it("attempts one disable after an uncertain rejected start", async () => {
    const h = harness();
    h.imuControl.mockRejectedValueOnce(new Error("lost acknowledgement"));
    expect(await h.probe.start()).toBe(false);
    expect(h.imuControl).toHaveBeenCalledTimes(2);
    expect(h.imuControl).toHaveBeenLastCalledWith(false);
    expect(h.probe.snapshot().error).toBe(
      "IMU start failed; reporting was stopped.",
    );
  });
});
