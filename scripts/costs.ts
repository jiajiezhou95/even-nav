export const pricingDate = "2026-10-20";
export const pricingSource =
  "https://developers.google.com/maps/billing-and-pricing/pricing";
type Tier = readonly [number, number];
export interface Price {
  free: number;
  tiers: readonly Tier[];
}
const ordinary = (free: number, rates: number[]): Price => ({
  free,
  tiers: [100_000, 500_000, 1_000_000, 5_000_000, Infinity].map(
    (cap, i) => [cap, rates[i]] as const,
  ),
});
export const prices = {
  routesEssentials: ordinary(10_000, [5, 4, 3, 1.5, 0.38]),
  routesPro: ordinary(5_000, [10, 8, 6, 3, 0.75]),
  tiles: {
    free: 100_000,
    tiers: [
      [1_000_000, 0.6],
      [5_000_000, 0.48],
      [10_000_000, 0.36],
      [50_000_000, 0.18],
      [Infinity, 0.045],
    ],
  } as Price,
  geocoding: ordinary(10_000, [5, 4, 3, 1.5, 0.38]),
  detailsEssentials: ordinary(10_000, [5, 4, 3, 1.5, 0.38]),
  detailsPro: ordinary(5_000, [17, 13.6, 10.2, 5.1, 1.28]),
  textSearchPro: ordinary(5_000, [32, 25.6, 19.2, 9.6, 2.4]),
  staticMaps: ordinary(10_000, [2, 1.6, 1.2, 0.6, 0.15]),
  autocomplete: ordinary(10_000, [2.83, 2.27, 1.7, 0.85, 0.21]),
  dynamicMaps: ordinary(10_000, [7, 5.6, 4.2, 2.1, 0.53]),
};
export type Sku = keyof typeof prices;
export function estimate(
  sku: Sku,
  units: number,
  existingAccountUnits = 0,
): number {
  if (
    ![units, existingAccountUnits].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw new Error("Counts must be nonnegative safe integers");
  const cumulative = (count: number) => {
    const price = prices[sku];
    let lower = price.free;
    let total = 0;
    for (const [upper, rate] of price.tiers) {
      total += (Math.max(0, Math.min(count, upper) - lower) / 1000) * rate;
      lower = upper;
    }
    return total;
  };
  return (
    Math.round(
      (cumulative(existingAccountUnits + units) -
        cumulative(existingAccountUnits)) *
        10000,
    ) / 10000
  );
}
