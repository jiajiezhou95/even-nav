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
  it("skips train enrichment for numbered bus lines without spending quota", async () => {
    const input = routes();
    input[0].legs[0].transitMode = "BUS";
    input[0].legs[0].line = "42";
    const reserve = vi.fn(async () => {});
    const fetcher = vi.fn(async () => Response.json(search()));
    const [result] = await enrichNavitime(input, "synthetic", reserve, fetcher);
    expect(result.legs).toEqual(input[0].legs);
    expect(result.attribution).not.toContain("NAVITIME JAPAN");
    expect(reserve).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("enriches rail but leaves bus metadata untouched in mixed journeys", async () => {
    const input = routes();
    input[0].legs[0].transitMode = "RAIL";
    const bus = structuredClone(input[0].legs[0]);
    bus.transitMode = "BUS";
    bus.line = "42";
    input[0].legs.unshift(bus);
    const reserve = vi.fn(async () => {});
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      return Response.json(
        url.pathname === "/transport_link" ? search() : gateway(url),
      );
    });
    const [result] = await enrichNavitime(input, "synthetic", reserve, fetcher);
    expect(result.legs[0]).toEqual(bus);
    expect(result.legs[1].fromStop?.stationAccess?.gateways).toHaveLength(1);
    expect(result.legs[1].toStop?.stationAccess?.gateways).toHaveLength(1);
    // One line lookup and both gateway directions at each rail endpoint.
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(reserve).toHaveBeenCalledTimes(5);
  });
  it.each([
    ["市ケ谷", "市ヶ谷"],
    ["菊川(東京都)", "菊川"],
    ["神田(東京都)", "神田"],
  ])(
    "matches exact reviewed station alias %s",
    async (providerName, routeName) => {
      const input = routes();
      input[0]!.legs[0]!.fromStop!.name = routeName;
      const result = await enrichNavitime(
        input,
        "synthetic",
        async () => {},
        async (raw) => {
          const url = new URL(String(raw));
          if (url.pathname === "/transport_link") {
            const data = search();
            data.items[0]!.nodes[0]!.name = providerName;
            return Response.json(data);
          }
          const data = gateway(url);
          data.node = {
            ...data.node,
            name: data.node.id === "a" ? providerName : b.name,
          };
          return Response.json(data);
        },
      );
      expect(result[0]!.navitime?.exits).toBe("AVAILABLE");
    },
  );
  it.each(["東京都交通局", "Other Operator"])(
    "scopes Shinjuku line alias to the reviewed operator: %s",
    async (agency) => {
      const input = routes(),
        ride = input[0]!.legs[0]!;
      ride.line = "新宿線";
      ride.agency = agency;
      const fetcher = vi.fn(async (raw: string | URL | Request) => {
        const url = new URL(String(raw));
        if (url.pathname === "/transport_link") {
          expect(url.searchParams.get("word")).toBe(
            agency === "東京都交通局" ? "都営新宿線" : "新宿線",
          );
          const data = search();
          data.items[0]!.name = "都営新宿線";
          data.items[0]!.company.name = "東京都交通局";
          return Response.json(data);
        }
        return Response.json(gateway(url));
      });
      const result = await enrichNavitime(
        input,
        "synthetic",
        async () => {},
        fetcher,
      );
      expect(result[0]!.navitime?.exits).toBe(
        agency === "東京都交通局" ? "AVAILABLE" : "NO_MATCH",
      );
    },
  );
  it.each(["intermediate", "headsign", "ambiguous", "unrelated headsign"])(
    "discriminates shared lines using independent full-line evidence: %s",
    async (kind) => {
      const input = routes(),
        ride = input[0]!.legs[0]!;
      ride.line = "12345678";
      const mid = {
        id: "m",
        name: "Middle",
        coord: { lat: 35.005, lon: 139.005 },
      };
      ride.intermediateStops = [
        {
          name: mid.name,
          coordinate: { lat: mid.coord.lat, lng: mid.coord.lon },
        },
      ];
      if (kind === "headsign") ride.headsign = "Terminal";
      if (kind === "unrelated headsign") ride.headsign = "Elsewhere";
      const fetcher = vi.fn(async (raw: string | URL | Request) => {
        const url = new URL(String(raw));
        if (url.pathname === "/transport_node") {
          const n = url.searchParams.get("word") === a.name ? a : b;
          return Response.json({
            count: { total: 1, offset: 0 },
            unit: search().unit,
            items: [
              {
                ...n,
                details: [0, 1].map((i) => ({
                  company: line.company,
                  link: { id: `line${i}`, name: `Line ${i}` },
                })),
              },
            ],
          });
        }
        if (url.pathname === "/transport_link") {
          const i = url.searchParams.get("word") === "Line 0" ? 0 : 1;
          const nodes =
            kind === "intermediate" && i === 1 ? [a, b] : [a, mid, b];
          if (i === 0)
            nodes.push({
              id: "terminal",
              name: "Terminal",
              coord: { lat: 35.02, lon: 139.02 },
            });
          return Response.json({
            count: { total: 1, offset: 0 },
            unit: search().unit,
            items: [{ ...line, id: `line${i}`, name: `Line ${i}`, nodes }],
          });
        }
        const data = gateway(url);
        data.link.id = url.searchParams.get("link")!;
        return Response.json(data);
      });
      const result = await enrichNavitime(
        input,
        "synthetic",
        async () => {},
        fetcher,
      );
      const accepted = kind === "intermediate" || kind === "headsign";
      expect(result[0]!.legs[0]!.line).toBe(accepted ? "Line 0" : "12345678");
      expect(result[0]!.navitime?.exits).toBe(
        accepted ? "AVAILABLE" : "NO_MATCH",
      );
      expect(fetcher).toHaveBeenCalledTimes(accepted ? 8 : 4);
    },
  );
  it.each(["東京都", "福井県"])(
    "only accepts the reviewed Tawaramachi locality alias: %s",
    async (locality) => {
      const input = routes();
      input[0]!.legs[0]!.fromStop!.name = "田原町 Tawaramachi";
      const fetcher = vi.fn(async (raw: string | URL | Request) => {
        const url = new URL(String(raw));
        if (url.pathname === "/transport_link") {
          const data = search();
          data.items[0]!.nodes[0]!.name = `田原町(${locality})`;
          return Response.json(data);
        }
        const data = gateway(url);
        data.node = {
          ...data.node,
          name: data.node.id === "a" ? `田原町(${locality})` : b.name,
        };
        return Response.json(data);
      });
      const result = await enrichNavitime(
        input,
        "synthetic",
        async () => {},
        fetcher,
      );
      expect(result[0]!.navitime?.exits).toBe(
        locality === "東京都" ? "AVAILABLE" : "NO_MATCH",
      );
      expect(fetcher).toHaveBeenCalledTimes(locality === "東京都" ? 5 : 1);
    },
  );
  it.each(["reviewed", "wrong alias", "beyond 500m", "duplicate identity"])(
    "uses exact reviewed operator/station aliases with bounded coordinates: %s",
    async (kind) => {
      const input = routes(),
        ride = input[0]!.legs[0]!;
      ride.agency = "都営地下鉄";
      ride.fromStop!.name = "とうきょうスカイツリー";
      // Synthetic representative-point difference: about333m, not private coordinates.
      ride.fromStop!.coordinate = {
        lat: kind === "beyond 500m" ? 35.006 : 35.003,
        lng: 139,
      };
      const fetcher = vi.fn(async (raw: string | URL | Request) => {
        const url = new URL(String(raw));
        if (url.pathname === "/transport_link") {
          const data = search();
          data.items[0]!.company.name = "東京都交通局";
          data.items[0]!.nodes[0]!.name =
            kind === "wrong alias"
              ? "とうきょうスカイツリー[別駅]"
              : "とうきょうスカイツリー[業平橋]";
          if (kind === "duplicate identity")
            data.items[0]!.nodes.push({
              ...data.items[0]!.nodes[0]!,
              id: "duplicate",
            });
          return Response.json(data);
        }
        const data = gateway(url);
        data.node = {
          ...data.node,
          name:
            data.node.id === "a" ? "とうきょうスカイツリー[業平橋]" : b.name,
        };
        return Response.json(data);
      });
      const result = await enrichNavitime(
        input,
        "synthetic",
        async () => {},
        fetcher,
      );
      expect(result[0]!.navitime?.exits).toBe(
        kind === "reviewed" ? "AVAILABLE" : "NO_MATCH",
      );
      expect(fetcher).toHaveBeenCalledTimes(kind === "reviewed" ? 5 : 1);
    },
  );
  it.each([
    "ordered",
    "reverse direction",
    "misordered",
    "ambiguous",
    "wrong stop",
    "missing coord",
    "no intermediates",
    "adjacent no intermediates",
    "reverse adjacent no intermediates",
  ])(
    "verifies through-service physical line independently of train operator: %s",
    async (kind) => {
      const input = routes(),
        ride = input[0]!.legs[0]!;
      ride.line = "87654321";
      ride.agency = "Through Train Operator";
      const mid1 = {
        id: "m1",
        name: "Middle One",
        coord: { lat: 35.003, lon: 139.003 },
      };
      const mid2 = {
        id: "m2",
        name: "Middle Two",
        coord: { lat: 35.007, lon: 139.007 },
      };
      ride.intermediateStops = [mid1, mid2].map((n) => ({
        name: n.name,
        coordinate: { lat: n.coord.lat, lng: n.coord.lon },
      }));
      if (kind === "misordered") ride.intermediateStops.reverse();
      if (kind === "wrong stop") ride.intermediateStops[0]!.name = "Elsewhere";
      if (kind === "missing coord")
        delete ride.intermediateStops[0]!.coordinate;
      if (kind.includes("no intermediates")) ride.intermediateStops = [];
      const fetcher = vi.fn(async (raw: string | URL | Request) => {
        const url = new URL(String(raw));
        if (url.pathname === "/transport_node") {
          const station = url.searchParams.get("word") === a.name ? a : b;
          const details = [
            { company: line.company, link: { id: line.id, name: line.name } },
          ];
          if (kind === "ambiguous")
            details.push({
              company: line.company,
              link: { id: "parallel", name: "Parallel" },
            });
          return Response.json({
            count: { total: 1, offset: 0 },
            unit: search().unit,
            items: [{ ...station, details }],
          });
        }
        if (url.pathname === "/transport_link") {
          const data = search();
          data.items[0]!.nodes = [a, mid1, mid2, b];
          if (kind.includes("adjacent no intermediates"))
            data.items[0]!.nodes = [a, b];
          if (kind === "reverse direction") data.items[0]!.nodes.reverse();
          if (kind === "reverse adjacent no intermediates")
            data.items[0]!.nodes.reverse();
          return Response.json(data);
        }
        return Response.json(gateway(url));
      });
      const result = await enrichNavitime(
        input,
        "synthetic",
        async () => {},
        fetcher,
      );
      const output = result[0]!.legs[0]!;
      expect(output.agency).toBe(ride.agency);
      if (
        [
          "ordered",
          "reverse direction",
          "adjacent no intermediates",
          "reverse adjacent no intermediates",
        ].includes(kind)
      ) {
        expect(output.line).toBe(line.name);
        expect(output.lineOriginal).toBe("87654321");
        expect(result[0]!.navitime?.exits).toBe("AVAILABLE");
        expect(fetcher).toHaveBeenCalledTimes(7);
      } else {
        expect(output.line).toBe("87654321");
        expect(output.fromStop?.stationAccess).toBeUndefined();
        expect(fetcher.mock.calls.length).toBeLessThanOrEqual(
          kind === "ambiguous" ? 4 : 3,
        );
      }
    },
  );
  it("selects access independently for alternative walking approaches without extra provider calls", async () => {
    const input = routes();
    const walk = (lng: number) => ({
      mode: "WALK" as const,
      geometry: [
        { lat: 35, lng },
        { lat: 35, lng: 139 },
      ],
      steps: [],
      distanceMeters: 100,
      durationSeconds: 60,
    });
    input[0]!.legs.unshift(walk(138.99));
    input.push(structuredClone(input[0]!));
    input[1]!.legs[0] = walk(139.01);
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname === "/transport_link") return Response.json(search());
      const data = gateway(url);
      data.count.total = 2;
      data.items = [
        {
          name: "West",
          coord: { lat: data.node.coord.lat, lon: data.node.coord.lon - 0.001 },
          getoff: "",
        },
        {
          name: "East",
          coord: { lat: data.node.coord.lat, lon: data.node.coord.lon + 0.001 },
          getoff: "",
        },
      ];
      return Response.json(data);
    });
    const result = await enrichNavitime(
      input,
      "synthetic",
      async () => {},
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(
      result[0]!.legs[1]!.fromStop?.stationAccess?.selectedGateway?.name,
    ).toBe("West");
    expect(
      result[1]!.legs[1]!.fromStop?.stationAccess?.selectedGateway?.name,
    ).toBe("East");
    expect(
      result[0]!.legs[1]!.toStop?.stationAccess?.selectedGateway,
    ).toBeUndefined();
  });
  it("matches reviewed bilingual Tokyo Metro identity", async () => {
    const input = routes();
    const ride = input[0]!.legs[0]!;
    ride.line = "東京メトロ銀座線 Tokyo Metro Ginza Line";
    ride.agency = "東京メトロ Tokyo Metro";
    ride.fromStop!.name = "外苑前 Gaiemmae";
    ride.toStop!.name = "渋谷 Shibuya";
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname === "/transport_link") {
        expect(url.searchParams.get("word")).toBe("東京メトロ銀座線");
        const result = search();
        result.items[0]!.name = "東京メトロ銀座線";
        result.items[0]!.company.name = "東京地下鉄（メトロ）";
        result.items[0]!.nodes[0]!.name = "外苑前";
        result.items[0]!.nodes[1]!.name = "渋谷";
        return Response.json(result);
      }
      const result = gateway(url);
      result.node = {
        ...result.node,
        name: result.node.id === "a" ? "外苑前" : "渋谷",
      };
      return Response.json(result);
    });
    const result = await enrichNavitime(
      input,
      "synthetic",
      async () => {},
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(result[0]!.legs[0]!.fromStop?.stationAccess?.nodeId).toBe("a");
  });
  it.each([
    "success",
    "empty exits",
    "ambiguous",
    "operator",
    "distance",
    "truncated",
    "different lines",
    "nontrain",
  ])(
    "resolves opaque line IDs with two station identities: %s",
    async (kind) => {
      const input = routes();
      input[0]!.legs[0]!.line = "12345678";
      const reserve = vi.fn(async () => {});
      const fetcher = vi.fn(async (raw: string | URL | Request) => {
        const url = new URL(String(raw));
        if (url.pathname === "/transport_node") {
          expect(url.searchParams.get("options")).toBe("detail");
          expect(url.searchParams.get("type")).toBe("station");
          const station = url.searchParams.get("word") === a.name ? a : b;
          const second = station.id === b.id;
          const details = [
            {
              company: {
                name:
                  second && kind === "operator" ? "Wrong" : line.company.name,
              },
              link: {
                id: second && kind === "different lines" ? "other" : line.id,
                name: line.name,
                type: kind === "nontrain" ? "bus" : "train",
              },
            },
          ];
          if (kind === "ambiguous")
            details.push({
              ...details[0]!,
              link: { id: "parallel", name: "Parallel", type: "train" },
            });
          return Response.json({
            count: { total: kind === "truncated" ? 2 : 1, offset: 0 },
            unit: { datum: "wgs84", coord_unit: "degree" },
            items: [
              {
                ...station,
                coord:
                  kind === "distance" ? { lat: 40, lon: 139 } : station.coord,
                details,
              },
            ],
          });
        }
        if (
          (kind === "operator" || kind === "ambiguous") &&
          url.pathname === "/transport_link"
        ) {
          const data = search();
          data.items[0]!.nodes.splice(1, 0, {
            id: "mid",
            name: "Unreported intermediate",
            coord: { lat: 35.005, lon: 139.005 },
          });
          return Response.json(data);
        }
        expect(url.pathname).toBe("/transport_node/gateway");
        const data = gateway(url);
        if (kind === "empty exits") {
          data.items = [];
          data.count.total = 0;
        }
        return Response.json(data);
      });
      const result = await enrichNavitime(input, "synthetic", reserve, fetcher);
      const ride = result[0]!.legs[0]!;
      if (kind === "success" || kind === "empty exits") {
        expect(fetcher).toHaveBeenCalledTimes(6);
        expect(ride.line).toBe(line.name);
        expect(ride.lineOriginal).toBe("12345678");
        expect(ride.lineNameSource).toBe("NAVITIME");
        expect(result[0]!.attribution).toContain("NAVITIME JAPAN");
        expect(!!ride.fromStop?.stationAccess).toBe(kind === "success");
      } else {
        expect(fetcher.mock.calls.length).toBeLessThanOrEqual(
          kind === "operator" ? 3 : kind === "ambiguous" ? 4 : 2,
        );
        expect(ride.line).toBe("12345678");
        expect(ride.lineNameSource).toBeUndefined();
        expect(ride.fromStop?.stationAccess).toBeUndefined();
      }
      expect(reserve).toHaveBeenCalledTimes(fetcher.mock.calls.length);
      expect(ride.geometry).toEqual(input[0]!.legs[0]!.geometry);
      expect(ride.durationSeconds).toBe(input[0]!.legs[0]!.durationSeconds);
    },
  );
  it.each([undefined, null])(
    "accepts zero matches with items=%s and continues later rides",
    async (items) => {
      const input = routes();
      input[0]!.legs.push({
        ...structuredClone(input[0]!.legs[0]!),
        line: "Other line",
      });
      const fetcher = vi.fn(async () =>
        Response.json({ count: { total: 0, offset: 0 }, items }),
      );
      const result = await enrichNavitime(
        input,
        "synthetic",
        async () => {},
        fetcher,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(result[0]!.navitime?.exits).toBe("NO_MATCH");
    },
  );
  it.each(["日本 Rail 日本", "東京メトロ 別会社", "Other Tokyo Metro"])(
    "does not guess aliases or remove Japanese name segments: %s",
    async (agency) => {
      const input = routes();
      input[0]!.legs[0]!.agency = agency;
      const data = search();
      data.items[0]!.company.name = "東京地下鉄（メトロ）";
      const fetcher = vi.fn(async () => Response.json(data));
      const result = await enrichNavitime(
        input,
        "synthetic",
        async () => {},
        fetcher,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result[0]!.navitime?.exits).toBe("NO_MATCH");
    },
  );
  it("caps the whole response at 20 upstream requests even across many rides", async () => {
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
    expect(fetcher).toHaveBeenCalledTimes(20);
    expect(reserve).toHaveBeenCalledTimes(20);
    expect(result[0]!.navitime?.exits).toBe("PARTIAL");
  });
  it("completes all six endpoints of a three-ride itinerary needing 16 calls", async () => {
    const input = routes();
    input[0]!.legs = Array.from({ length: 3 }, (_, i) => ({
      ...structuredClone(input[0]!.legs[0]!),
      line: i === 2 ? "12345678" : `Line ${i}`,
    }));
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname === "/transport_link") {
        const result = search();
        result.items[0]!.name = url.searchParams.get("word")!;
        result.items[0]!.id = result.items[0]!.name.replace(" ", "_");
        return Response.json(result);
      }
      if (url.pathname === "/transport_node") {
        const station = url.searchParams.get("word") === a.name ? a : b;
        return Response.json({
          count: { total: 1, offset: 0 },
          unit: search().unit,
          items: [
            {
              ...station,
              details: [
                {
                  company: line.company,
                  link: { id: "Line_2", name: "Line 2" },
                },
              ],
            },
          ],
        });
      }
      const result = gateway(url);
      result.link.id = url.searchParams.get("link")!;
      return Response.json(result);
    });
    const reserve = vi.fn(async () => {});
    const result = await enrichNavitime(input, "synthetic", reserve, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(16);
    expect(reserve).toHaveBeenCalledTimes(16);
    expect(result[0]!.navitime?.exits).toBe("AVAILABLE");
    expect(
      result[0]!.legs.every(
        (l) => l.fromStop?.stationAccess && l.toStop?.stationAccess,
      ),
    ).toBe(true);
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
