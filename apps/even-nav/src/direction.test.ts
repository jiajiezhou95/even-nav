import { describe, it, expect } from "vitest";
import { movementBearing, movementBearingFromHistory } from "./direction";

const previous = {
  coordinate: { lat: 35, lng: 139 },
  timestamp: 10000,
  accuracyMeters: 5,
};
const current = {
  coordinate: { lat: 35.0002, lng: 139 },
  timestamp: 15000,
  accuracyMeters: 5,
  heading: 180,
};
describe("direction of accepted GPS movement only", () => {
  it("derives north/east from measured displacement, ignoring an unsupported heading interpretation", () => {
    expect(movementBearing(previous, current, "WALK", 15000)).toBeCloseTo(0);
    expect(
      movementBearing(
        previous,
        { ...current, coordinate: { lat: 35, lng: 139.0002 } },
        "WALK",
        15000,
      ),
    ).toBeCloseTo(90, 2);
  });
  it("hides stationary and uncertainty-sized movement", () => {
    expect(
      movementBearing(
        previous,
        { ...current, coordinate: previous.coordinate },
        "WALK",
        15000,
      ),
    ).toBeUndefined();
    expect(
      movementBearing(
        previous,
        { ...current, accuracyMeters: 25 },
        "WALK",
        15000,
      ),
    ).toBeUndefined();
  });
  it("requires known accuracy and rejects poor accuracy, long gaps and implausible speed", () => {
    expect(
      movementBearing(
        previous,
        { ...current, accuracyMeters: undefined },
        "WALK",
        15000,
      ),
    ).toBeUndefined();
    expect(
      movementBearing(
        previous,
        { ...current, accuracyMeters: 40 },
        "WALK",
        15000,
      ),
    ).toBeUndefined();
    expect(
      movementBearing(
        previous,
        { ...current, timestamp: 41000 },
        "WALK",
        41000,
      ),
    ).toBeUndefined();
    expect(
      movementBearing(
        previous,
        { ...current, timestamp: 11000 },
        "WALK",
        11000,
      ),
    ).toBeUndefined();
  });
  it("accumulates one-meter-per-second walking until uncertainty clears, then hides immediately on stopping", () => {
    const history = Array.from({ length: 25 }, (_, i) => ({
      coordinate: { lat: 35 + i * 0.000009, lng: 139 },
      timestamp: 10000 + i * 1000,
      accuracyMeters: 8,
    }));
    expect(
      movementBearingFromHistory(history.slice(0, 10), "WALK", 19000),
    ).toBeUndefined();
    expect(movementBearingFromHistory(history, "WALK", 34000)).toBeCloseTo(0);
    expect(
      movementBearingFromHistory(
        [...history, { ...history.at(-1)!, timestamp: 35000 }],
        "WALK",
        35000,
      ),
    ).toBeUndefined();
    expect(movementBearingFromHistory(history, "WALK", 39001)).toBeUndefined();
  });
  it("hides stale, future, nonmonotonic and malformed fixes", () => {
    expect(movementBearing(previous, current, "WALK", 20001)).toBeUndefined();
    expect(movementBearing(previous, current, "DRIVE", 18001)).toBeUndefined();
    expect(movementBearing(previous, current, "WALK", 14999)).toBeUndefined();
    expect(
      movementBearing(
        previous,
        { ...current, timestamp: 10000 },
        "WALK",
        15000,
      ),
    ).toBeUndefined();
    expect(
      movementBearing(previous, { ...current, timestamp: NaN }, "WALK", 15000),
    ).toBeUndefined();
    expect(
      movementBearing(
        previous,
        { ...current, coordinate: { lat: 99, lng: 139 } },
        "WALK",
        15000,
      ),
    ).toBeUndefined();
  });
});
