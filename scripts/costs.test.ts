import { describe, expect, it } from "vitest";
import { estimate } from "./costs";
describe("incremental account-level tiered USD estimates", () => {
  it.each([
    [0, 0],
    [6000, 0],
    [18000, 16],
    [36000, 52],
    [180000, 308],
  ])("static regression %i", (n, c) =>
    expect(estimate("staticMaps", n)).toBe(c),
  );
  it.each([
    [30000, 0],
    [150000, 30],
    [300000, 120],
  ])("tiles regression %i", (n, c) => expect(estimate("tiles", n)).toBe(c));
  it("does not grant another free allowance to a project", () =>
    expect(estimate("routesEssentials", 1000, 10000)).toBe(5));
  it("crosses tiers incrementally", () =>
    expect(estimate("staticMaps", 20000, 90000)).toBe(36));
  it.each([-1, NaN, Infinity, 1.5])("rejects bad count %s", (n) =>
    expect(() => estimate("tiles", n)).toThrow(),
  );
});
