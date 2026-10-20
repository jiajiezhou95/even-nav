import { estimate, pricingDate, pricingSource, type Sku } from "./costs";
const usage: Partial<Record<Sku, number>> = {
  routesEssentials: 160,
  routesPro: 0,
  tiles: 30_000,
  detailsEssentials: 20,
  geocoding: 20,
  textSearchPro: 10,
  staticMaps: 0,
  autocomplete: 0,
  dynamicMaps: 0,
};
const rows = Object.entries(usage).map(([sku, units]) => ({
  sku,
  units,
  estimatedUSD: estimate(sku as Sku, units),
}));
console.log(
  JSON.stringify(
    {
      scenario: "personal-100-trips",
      assumption:
        "No other usage on the billing account; estimates, not actual bills",
      pricingDate,
      pricingSource,
      rows,
      googleEstimatedUSD: rows.reduce((n, r) => n + r.estimatedUSD, 0),
      transitousQueries: 40,
      otherCosts:
        "Worker CPU/requests and Durable Object storage billed separately; Transitous access required; no SLA",
    },
    null,
    2,
  ),
);
