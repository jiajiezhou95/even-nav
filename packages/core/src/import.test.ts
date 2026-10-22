import { describe, expect, it } from "vitest";
import {
  parseSharedInput as parse,
  validateMapsUrl,
  parseCoordinate,
  normalizeSharedText,
} from "./import";
const search = (q: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const dir = (extra: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=10%2C20&${extra}`;
describe("documented import formats", () => {
  it.each([
    "架空駅",
    "测试公园",
    "Space Name",
    "C++ Store",
    "8Q7X+P2",
    "A&B",
    "A/B",
    "100% Place",
  ])("preserves encoded label %s", (label) =>
    expect(parse(search(label)).destinationCandidates[0].label).toBe(label),
  );
  it.each([
    ["walking", "WALK"],
    ["driving", "DRIVE"],
    ["transit", "TRANSIT"],
  ])("maps mode %s", (input, expected) =>
    expect(parse(dir(`travelmode=${input}`)).modeHint).toBe(expected),
  );
  it.each(["bicycling", "two-wheeler", "flying"])(
    "unsupported mode %s is not driving",
    (mode) => {
      const r = parse(dir(`travelmode=${mode}`));
      expect(r.modeHint).toBeUndefined();
      expect(r.warnings.length).toBeGreaterThan(0);
    },
  );
  it("does not default a mode", () =>
    expect(parse(dir("")).modeHint).toBeUndefined());
  it("preserves place ID", () =>
    expect(
      parse(`${search("Sample")}&query_place_id=synthetic_123`)
        .destinationCandidates[0].placeId,
    ).toBe("synthetic_123"));
  it("retains ID-only destination for enrichment", () =>
    expect(
      parse(
        "https://www.google.com/maps/dir/?api=1&destination_place_id=synthetic",
      ).destinationCandidates[0].placeId,
    ).toBe("synthetic"));
  it("preserves original origin separately", () => {
    const r = parse(dir("origin=1%2C2"));
    expect(r.originCandidate?.coordinate).toEqual({ lat: 1, lng: 2 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it.each(["Current Location", "My Location", "現在地", "当前位置", ""])(
    "dynamic origin %s",
    (origin) =>
      expect(
        parse(dir(`origin=${encodeURIComponent(origin)}`)).originCandidate,
      ).toBeUndefined(),
  );
  it("retains all ordered waypoints", () =>
    expect(
      parse(dir("waypoints=1%2C2%7C3%2C4%7C5%2C6")).waypoints.map(
        (p) => p.coordinate,
      ),
    ).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
      { lat: 5, lng: 6 },
    ]));
  it("matches waypoint IDs by position", () =>
    expect(
      parse(dir("waypoints=A%7CB&waypoint_place_ids=idA%7CidB")).waypoints[1]
        .placeId,
    ).toBe("idB"));
  it("rejects mismatched waypoint IDs", () =>
    expect(() =>
      parse(dir("waypoints=A%7CB&waypoint_place_ids=idA")),
    ).toThrow());
  it("rejects empty waypoint", () =>
    expect(() => parse(dir("waypoints=A%7C"))).toThrow());
  it("reports avoid options not applied", () =>
    expect(parse(dir("avoid=tolls")).warnings.join()).toContain("未应用"));
  it("does not inherit historical time", () =>
    expect(parse(dir("departure_time=0")).warnings.join()).toContain("现在"));
  it("does not import Google itinerary", () =>
    expect(
      parse(dir("skid=foo&dir_action=navigate"))
        .selectedGoogleItineraryImported,
    ).toBe(false));
  it("accepts share text containing exactly one Maps URL", () =>
    expect(
      parse(`架空目的地\n${search("Sample")}`).destinationCandidates[0].label,
    ).toBe("Sample"));
  it("ignores unrelated URL if exactly one supported URL", () =>
    expect(
      parse(`https://example.org/info\n${search("Sample")}`)
        .destinationCandidates[0].label,
    ).toBe("Sample"));
  it("rejects two Maps URLs", () =>
    expect(() => parse(`${search("A")}\n${search("B")}`)).toThrow(/多个/));
  it("rejects duplicate destination parameter", () =>
    expect(() => parse(dir("destination=30%2C40"))).toThrow(/重复/));
  it("rejects conflicting legacy fields", () =>
    expect(() => parse(dir("daddr=other"))).toThrow(/混合/));
});
describe("coordinate semantics", () => {
  it.each(["0,0", "90,180", "-90,-180", "-10.5,20.25", " 1 ， 2 "])(
    "accepts bounded coordinates %s",
    (value) => expect(parseCoordinate(value)).toBeDefined(),
  );
  it.each([
    "91,0",
    "0,181",
    "-91,0",
    "0,-181",
    "139,35",
    "NaN,0",
    "Infinity,0",
  ])("rejects invalid coordinates %s", (value) =>
    expect(() => parse(value)).toThrow(),
  );
  it.each([
    "https://www.google.com/maps/@10,20,15z",
    "https://www.google.com/maps/?center=10,20",
    "https://maps.google.com/?ll=10,20",
    "comgooglemaps://?center=10,20",
    "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=10,20",
  ])("viewport is not endpoint %s", (value) =>
    expect(() => parse(value)).toThrow(/目的地/),
  );
  it("query endpoint wins over viewport", () =>
    expect(
      parse(`${search("10,20")}&center=30,40`).destinationCandidates[0]
        .coordinate,
    ).toEqual({ lat: 10, lng: 20 }));
  it("path coordinates are untrusted hints", () =>
    expect(
      parse("https://www.google.com/maps/place/10,20/@30,40,15z")
        .destinationCandidates[0].coordinate,
    ).toBeUndefined());
  it("does not decode arbitrary private data", () =>
    expect(() =>
      parse("https://www.google.com/maps/?data=!3d10!4d20"),
    ).toThrow());
  it("manual coordinate is independent input", () =>
    expect(parse("10,20").destinationCandidates[0].source).toBe(
      "USER_INDEPENDENT_INPUT",
    ));
  it("shared coordinate stays Google sourced", () =>
    expect(parse(search("10,20")).destinationCandidates[0].source).toBe(
      "GOOGLE_MAPS_SHARED_LINK",
    ));
  it("never recursively decodes", () =>
    expect(parse(search("%2BPlace")).destinationCandidates[0].label).toBe(
      "%2BPlace",
    ));
});
describe("legacy and iOS", () => {
  it.each([
    ["w", "WALK"],
    ["d", "DRIVE"],
    ["r", "TRANSIT"],
  ])("legacy dirflg %s", (flag, mode) =>
    expect(
      parse(`https://maps.google.com/?saddr=A&daddr=B&dirflg=${flag}`).modeHint,
    ).toBe(mode),
  );
  it.each(["walking", "driving", "transit"])("iOS mode %s", (mode) =>
    expect(
      parse(`comgooglemaps://?saddr=A&daddr=B&directionsmode=${mode}`).modeHint,
    ).toBeDefined(),
  );
  it("iOS search keeps center distinct", () =>
    expect(
      parse("comgooglemaps://?q=Sample&center=10,20").destinationCandidates[0]
        .coordinate,
    ).toBeUndefined());
  it("legacy search", () =>
    expect(
      parse("https://maps.google.com/?q=Sample").destinationCandidates[0].label,
    ).toBe("Sample"));
  it.each([
    "https://maps.app.goo.gl/Synthetic",
    "https://goo.gl/maps/Synthetic",
  ])("short URL requests resolver %s", (url) =>
    expect(() => parse(url)).toThrow(/安全展开/),
  );
});
describe("input and URL security", () => {
  it.each([
    "http://www.google.com/maps/",
    "https://www.google.com.evil.test/maps/",
    "https://evilgoogle.com/maps/",
    "https://www.google.com@evil.test/maps/",
    "https://user:pass@www.google.com/maps/",
    "https://127.0.0.1/maps/",
    "https://[::1]/maps/",
    "https://localhost/maps/",
    "https://www.google.com:444/maps/",
    "https://www.google.com/url?url=x",
    "https://goo.gl/other/abc",
    "https://maps.app.goo.gl/abc/def",
    "https://www.google.com/maps/%2Fsecret",
    "https://www.google.com/maps/%ZZ",
    "https://www.google.com/maps/\\evil",
    "https://www.google.com./maps/",
  ])("rejects unsafe URL %s", (url) =>
    expect(() => validateMapsUrl(url)).toThrow(),
  );
  it.each([
    "https://www.google.com/maps/search/?api=1&query=A",
    "https://www.google.co.jp/maps/?q=A",
    "https://maps.google.co.jp/?q=A",
    "https://www.google.com:443/maps/?q=A",
  ])("allows exact Maps host/path %s", (url) =>
    expect(validateMapsUrl(url).protocol).toBe("https:"),
  );
  it("rejects nested redirect parameter", () =>
    expect(() => parse(`${search("A")}&url=https://127.0.0.1/`)).toThrow(
      /嵌套/,
    ));
  it("iOS scheme never allowed for HTTP resolver", () =>
    expect(() => validateMapsUrl("comgooglemaps://?q=A")).toThrow());
  it("rejects empty input", () => expect(() => parse("　 \n")).toThrow());
  it("rejects byte excess", () =>
    expect(() => parse("駅".repeat(3000))).toThrow(/8 KiB/));
  it("rejects controls", () => expect(() => parse("A\u0000B")).toThrow());
  it("normalizes CRLF", () =>
    expect(normalizeSharedText(" A\r\nB ")).toBe("A\nB"));
  it("does not expose raw URL in errors", () => {
    try {
      parse("https://secret.test/private");
    } catch (error) {
      expect(String(error)).not.toContain("secret.test");
    }
  });
  it("tracking fields do not alter endpoint identity", () =>
    expect(parse(`${search("A")}&g_st=private`).destinationCandidates).toEqual(
      parse(search("A")).destinationCandidates,
    ));
});

describe("iOS desktop URL scheme", () => {
  it("parses documented desktop scheme without network", () =>
    expect(
      parse(
        "comgooglemapsurl://www.google.com/maps/search/?api=1&query=Example",
      ).destinationCandidates[0].label,
    ).toBe("Example"));
  it("does not allow custom scheme to evade host allowlist", () =>
    expect(() =>
      parse("comgooglemapsurl://127.0.0.1/maps/?q=Example"),
    ).toThrow());
  it("preserves plus signs in inferred path labels", () =>
    expect(
      parse("https://www.google.com/maps/place/8Q7X%2BP2/")
        .destinationCandidates[0].label,
    ).toBe("8Q7X+P2"));
});

describe("canonical long URL regressions (synthetic, no network)", () => {
  it("allows encoded slashes only in opaque final Google data tail", () => {
    const value =
      "https://www.google.com/maps/place/Synthetic+Museum/@10,20,15z/data=!4m2!3m1!16s%2Fm%2Fsynthetic";
    expect(validateMapsUrl(value).pathname).toContain("%2Fm%2F");
    const r = parse(value);
    expect(r.destinationCandidates[0]).toMatchObject({
      label: "Synthetic+Museum",
      evidence: "INFERRED",
      coordinateRole: "UNKNOWN",
    });
    expect(r.destinationCandidates[0].coordinate).toBeUndefined();
    expect(r.warnings.join()).toContain("未解码");
  });
  it("extracts path direction labels independently of viewport and opaque data", () => {
    const r = parse(
      "https://www.google.com/maps/dir/SyntheticOrigin/SyntheticDestination/@10,20,15z/data=!16s%2Fm%2Fsynthetic",
    );
    expect(r.sourceKind).toBe("DIRECTIONS_LINK");
    expect(r.originCandidate?.label).toBe("SyntheticOrigin");
    expect(r.destinationCandidates[0]).toMatchObject({
      label: "SyntheticDestination",
      evidence: "INFERRED",
      coordinateRole: "UNKNOWN",
    });
    expect(r.destinationCandidates[0].coordinate).toBeUndefined();
    expect(r.modeHint).toBeUndefined();
    expect(r.selectedGoogleItineraryImported).toBe(false);
  });
  it("preserves arbitrarily many ordered waypoint labels", () => {
    const r = parse(
      "https://www.google.com/maps/dir/Origin/Way1/Way2/Way3/Destination/",
    );
    expect(r.waypoints.map((p) => p.label)).toEqual(["Way1", "Way2", "Way3"]);
    expect(r.destinationCandidates[0].label).toBe("Destination");
  });
  it("supports empty dynamic origin", () =>
    expect(
      parse("https://www.google.com/maps/dir//Destination/@10,20,15z")
        .originCandidate,
    ).toBeUndefined());
  it("recognizes named dynamic origin", () =>
    expect(
      parse("https://www.google.com/maps/dir/Current%20Location/Destination/")
        .originCandidate,
    ).toBeUndefined());
  it("decodes multilingual labels once", () =>
    expect(
      parse(
        "https://www.google.com/maps/dir/Origin/%E6%9E%B6%E7%A9%BA%E9%A7%85%252B/",
      ).destinationCandidates[0].label,
    ).toBe("架空駅%2B"));
  it("does not trust coordinates in nonpublic direction path", () => {
    const r = parse("https://www.google.com/maps/dir/1,2/3,4/5,6/@7,8,15z");
    for (const p of [
      r.originCandidate!,
      ...r.waypoints,
      ...r.destinationCandidates,
    ]) {
      expect(p.coordinate).toBeUndefined();
      expect(p.evidence).toBe("INFERRED");
    }
  });
  it("does not treat absent path destination as viewport endpoint", () =>
    expect(() =>
      parse(
        "https://www.google.com/maps/dir/Origin/@10,20,15z/data=!16s%2Fm%2Fsynthetic",
      ),
    ).toThrow(/目的地/));
  it("rejects empty intermediate path waypoint", () =>
    expect(() =>
      parse("https://www.google.com/maps/dir/Origin//Destination/"),
    ).toThrow(/为空/));
  it.each([
    "https://www.google.com/maps%2Fplace/Sample/data=!16s%2Fm%2Fid",
    "https://www.google.com/maps/place%2FSample/data=!16s%2Fm%2Fid",
    "https://www.google.com/maps/place/%2FSample/data=!16s%2Fm%2Fid",
    "https://www.google.com/maps/place/%252FSample/data=!16s%2Fm%2Fid",
    "https://www.google.com/maps/place/Sample/data=!16s%2Fm%2Fid/next",
    "https://www.google.com/maps/place/Sample/data=!16s%2Fm%2Fid/../Other",
    "https://www.google.com/maps/place/Sample/../Other/data=!16s%2Fm%2Fid",
    "https://www.google.com/maps/place/Sample/%2e%2e/Other/data=!16s%2Fm%2Fid",
    "https://www.google.com/maps/place/Sample/data=!16s%2F%2e%2e%2Fid",
    "https://www.google.com/maps/place/Sample/data=!16s%5Cm%5Cid",
    "https://www.google.com/maps/data=!16s%2Fm%2Fid",
    "https://www.google.com.evil.test/maps/place/Sample/data=!16s%2Fm%2Fid",
  ])("still rejects root/path smuggling %s", (value) =>
    expect(() => validateMapsUrl(value)).toThrow(),
  );
});
