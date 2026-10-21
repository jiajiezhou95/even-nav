import { describe, it, expect, vi } from "vitest";
import { enrichNavitime, NAVITIME_HOST } from "./navitime";
import { NavError, type Route } from "../../contracts/src/index";
const a = { id: "a", name: "Station A", coord: { lat: 35, lon: 139 } };
const b = { id: "b", name: "Station B", coord: { lat: 35.01, lon: 139.01 } };
const line = {
  id: "line",
  name: "Test line",
  company: { name: "Test rail" },
  nodes: [a, b],
};
const search = () => ({
  count: { total: 1, offset: 0 },
  items: [structuredClone(line)],
  unit: { datum: "wgs84", coord_unit: "degree" },
});
const routes = (): Route[] => [
  {
    id: "r",
    provider: "TRANSITOUS",
    basemapProvider: "GOOGLE_TILES",
    fetchedAt: "2026-10-21T00:00:00Z",
    expiresAt: "2026-10-21T00:01:00Z",
    distanceMeters: 1000,
    durationSeconds: 300,
    warnings: [],
    attribution: [],
    legs: [
      {
        mode: "RIDE",
        line: line.name,
        agency: line.company.name,
        fromStop: {
          name: a.name,
          coordinate: { lat: 35, lng: 139 },
          platform: "4",
        },
        toStop: { name: b.name, coordinate: { lat: 35.01, lng: 139.01 } },
        platform: "4",
        geometry: [
          { lat: 35, lng: 139 },
          { lat: 35.01, lng: 139.01 },
        ],
        steps: [],
        distanceMeters: 1000,
        durationSeconds: 300,
      },
    ],
  },
];
function gateway(url: URL) {
  const station = url.searchParams.get("node") === "a" ? a : b;
  return {
    count: { total: 1, offset: 0 },
    node: station,
    link: { id: "line" },
    items: [{ name: "A1", coord: station.coord, getoff: "1・6" }],
    unit: { datum: "wgs84", coord_unit: "degree" },
  };
}
describe("NAVITIME optional free Transport enrichment", () => {
  it("caps the whole response at 15 upstream requests even across many rides", async () => {
    const input = routes();
    input[0]!.legs = Array.from({ length: 6 }, (_, i) => ({
      ...structuredClone(input[0]!.legs[0]!),
      line: `Line ${i}`,
    }));
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname === "/transport_link") {
        const result = search();
        result.items[0]!.name = url.searchParams.get("word")!;
        result.items[0]!.id = result.items[0]!.name.replace(" ", "_");
        return Response.json(result);
      }
      const result = gateway(url);
      result.link.id = url.searchParams.get("link")!;
      return Response.json(result);
    });
    const reserve = vi.fn(async () => {});
    const result = await enrichNavitime(input, "synthetic", reserve, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(15);
    expect(reserve).toHaveBeenCalledTimes(15);
    expect(result[0]!.navitime?.exits).toBe("PARTIAL");
  });
  it.each(["truncated", "units"])(
    "rejects %s gateway metadata",
    async (kind) => {
      const fetcher = vi.fn(async (raw: string | URL | Request) => {
        const url = new URL(String(raw));
        if (url.pathname === "/transport_link") return Response.json(search());
        const data = gateway(url);
        if (kind === "truncated") data.count.total = 101;
        else data.unit.coord_unit = "millisec";
        return Response.json(data);
      });
      const result = await enrichNavitime(
        routes(),
        "synthetic",
        async () => {},
        fetcher,
      );
      expect(result[0]!.legs[0]!.fromStop?.stationAccess).toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("does nothing without key, including quota", async () => {
    const fetcher = vi.fn(),
      reserve = vi.fn();
    const result = await enrichNavitime(routes(), undefined, reserve, fetcher);
    expect(result[0]!.navitime?.exits).toBe("NOT_CONFIGURED");
    expect(fetcher).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });
  it("maps exact identity, preserves all routing/platform data, reserves each call, never recommends exits/cars", async () => {
    const input = routes(),
      reserve = vi.fn(async () => {});
    const fetcher = vi.fn(
      async (raw: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(raw));
        expect(url.hostname).toBe(NAVITIME_HOST);
        expect(init?.headers).toEqual({
          "X-RapidAPI-Key": "synthetic",
          "X-RapidAPI-Host": NAVITIME_HOST,
        });
        expect(init?.redirect).toBe("manual");
        expect(reserve.mock.calls.length).toBe(fetcher.mock.calls.length);
        return Response.json(
          url.pathname === "/transport_link" ? search() : gateway(url),
        );
      },
    );
    const result = await enrichNavitime(input, "synthetic", reserve, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(result[0]!.navitime).toEqual({
      exits: "AVAILABLE",
      platforms: "NOT_INCLUDED_IN_FREE_TRANSPORT",
    });
    const stop = result[0]!.legs[0]!.fromStop!;
    expect(stop.platform).toBe("4");
    expect(stop.stationAccess).toMatchObject({
      source: "NAVITIME",
      selection: "UNSELECTED_CANDIDATES",
      gateways: [{ name: "A1", directions: ["up", "down"] }],
    });
    expect(JSON.stringify(stop.stationAccess)).not.toContain("getoff");
    expect(result[0]!.legs[0]!.geometry).toEqual(input[0]!.legs[0]!.geometry);
    expect(input[0]!.legs[0]!.fromStop!.stationAccess).toBeUndefined();
  });
  it.each([
    "operator",
    "station",
    "distance",
    "ambiguous",
    "truncated",
    "malformed",
  ])("rejects %s identities without gateway calls", async (kind) => {
    const data = search();
    if (kind === "operator") data.items[0]!.company.name = "Other rail";
    if (kind === "station") data.items[0]!.nodes[0]!.name = "Other station";
    if (kind === "distance") data.items[0]!.nodes[0]!.coord.lat = 36;
    if (kind === "ambiguous") {
      data.items.push(structuredClone(line));
      data.count.total = 2;
    }
    if (kind === "truncated") data.count.total = 2;
    const fetcher = vi.fn(async () =>
      Response.json(kind === "malformed" ? {} : data),
    );
    const result = await enrichNavitime(
      routes(),
      "synthetic",
      async () => {},
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result[0]!.legs[0]!.fromStop!.stationAccess).toBeUndefined();
  });
  it("stops before fetch when quota is denied", async () => {
    const fetcher = vi.fn();
    const result = await enrichNavitime(
      routes(),
      "synthetic",
      async () => {
        throw new NavError("QUOTA_EXCEEDED", "synthetic");
      },
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(result[0]!.navitime?.exits).toBe("LIMIT_REACHED");
  });
  it.each([401, 403, 429, 500, 302])(
    "fails soft with no retries for HTTP %d",
    async (status) => {
      const fetcher = vi.fn(async () => new Response(null, { status }));
      const result = await enrichNavitime(
        routes(),
        "synthetic",
        async () => {},
        fetcher,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result[0]!.legs).toEqual(routes()[0]!.legs);
    },
  );
  it("does not attach partially fetched direction data or mismatched node response", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname === "/transport_link") return Response.json(search());
      const data = gateway(url);
      data.node = { ...data.node, id: "wrong" };
      return Response.json(data);
    });
    const result = await enrichNavitime(
      routes(),
      "synthetic",
      async () => {},
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result[0]!.legs[0]!.fromStop?.stationAccess).toBeUndefined();
  });
});
