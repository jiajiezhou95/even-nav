import {
  NavError,
  isCoordinate,
  type Coordinate,
  type EndpointCandidate,
  type ImportedIntent,
  type Mode,
} from "../../contracts/src/index";

export const MAX_SHARED_INPUT_BYTES = 8192;
export function normalizeSharedText(input: string): string {
  if (
    typeof input !== "string" ||
    new TextEncoder().encode(input).length > MAX_SHARED_INPUT_BYTES ||
    !input.trim()
  )
    throw new NavError("INVALID_INPUT", "输入为空或超过 8 KiB");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(input))
    throw new NavError("INVALID_INPUT", "输入包含控制字符");
  return input.trim().replace(/\r\n?/g, "\n");
}
/** Network allowlist: custom schemes are deliberately never accepted here. */
export function validateMapsUrl(input: string): URL {
  if (
    new TextEncoder().encode(input).length > MAX_SHARED_INPUT_BYTES ||
    /[\\\u0000-\u0020]/u.test(input) ||
    /%(?![\da-f]{2})/i.test(input)
  )
    throw new NavError("UNSAFE_URL", "链接格式不安全");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new NavError("INVALID_INPUT", "链接无效");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new NavError("UNSAFE_URL", "仅支持无凭据的 HTTPS Maps 链接");
  const host = url.hostname;
  const path = url.pathname;
  // URL normalizes dot segments. Inspect the original path before allowing any
  // request so an apparently safe normalized root cannot hide path traversal.
  const rawPath = input.match(/^https:\/\/[^/?#]+([^?#]*)/i)?.[1] || "/";
  if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(rawPath))
    throw new NavError("UNSAFE_URL", "路径包含不安全的段");
  const valid =
    host === "maps.app.goo.gl"
      ? /^\/[A-Za-z0-9_-]+\/?$/.test(path)
      : host === "goo.gl"
        ? /^\/maps\/[A-Za-z0-9_-]+\/?$/.test(path)
        : [
            "www.google.com",
            "maps.google.com",
            "www.google.co.jp",
            "maps.google.co.jp",
          ].includes(host) &&
          (/^\/maps(?:\/|$)/.test(path) ||
            (host.startsWith("maps.") && path === "/"));
  // Canonical Google place/directions URLs contain opaque /data=!…!16s%2Fm%2F…
  // tails. Encoded slashes there are data, never an endpoint or a nested URL.
  // Permit this only in one final data segment, after a literal Maps route root.
  const opaqueTail = /^\/maps\/(?:place|dir)\/.+\/data=[^/]+$/.test(path);
  const structuralPath = opaqueTail
    ? path.slice(0, path.lastIndexOf("/data="))
    : path;
  if (
    !valid ||
    /%(?:2f|5c|2e|25(?:2f|5c|2e))/i.test(structuralPath) ||
    /%(?:5c|2e)/i.test(path)
  )
    throw new NavError("UNSAFE_URL", "域名或路径不在 Maps 允许列表");
  return url;
}
export function isShortMapsUrl(url: URL): boolean {
  return url.hostname === "maps.app.goo.gl" || url.hostname === "goo.gl";
}
export function parseCoordinate(text: string): Coordinate | undefined {
  const match =
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[,，]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(
      text,
    );
  if (!match) return undefined;
  const point = { lat: Number(match[1]), lng: Number(match[2]) };
  if (!isCoordinate(point))
    throw new NavError("INVALID_INPUT", "纬度或经度超出范围");
  return point;
}
function endpoint(
  value: string | null,
  field: string,
  evidence: EndpointCandidate["evidence"],
  placeId?: string | null,
): EndpointCandidate | undefined {
  const label = value?.trim();
  if (!label && !placeId) return undefined;
  if (placeId && !/^[A-Za-z0-9_-]{1,255}$/.test(placeId))
    throw new NavError("INVALID_INPUT", "地点 ID 格式无效");
  const coordinate = label ? parseCoordinate(label) : undefined;
  if (
    label &&
    !coordinate &&
    /^(?:[+\-\d.]+|NaN|Infinity)\s*[,，]\s*(?:[+\-\d.]+|NaN|Infinity)$/i.test(
      label,
    )
  )
    throw new NavError("INVALID_INPUT", "坐标格式无效");
  return {
    ...(label ? { label } : {}),
    ...(coordinate ? { coordinate } : {}),
    ...(placeId ? { placeId } : {}),
    evidence,
    source: "GOOGLE_MAPS_SHARED_LINK",
    extractedFrom: field,
    coordinateRole: "ENDPOINT",
  };
}
const dynamicOrigin =
  /^(?:current location|my location|現在地|当前位置|目前位置)$/i;
function inferredPathEndpoint(
  segment: string,
  field: string,
): EndpointCandidate | undefined {
  let label: string;
  try {
    label = decodeURIComponent(segment).trim();
  } catch {
    throw new NavError("INVALID_INPUT", "地点名称编码无效");
  }
  if (!label) return undefined;
  // Do not interpret numeric-looking path labels as verified coordinates.
  return {
    label,
    evidence: "INFERRED",
    source: "GOOGLE_MAPS_SHARED_LINK",
    extractedFrom: field,
    coordinateRole: "UNKNOWN",
  };
}
export function extractCandidateMapsUrl(text: string): string | undefined {
  const all =
    text.match(/(?:https?:\/\/|comgooglemaps(?:url)?:\/\/)[^\s<>"“”]+/gi) ?? [];
  const accepted = all.filter((value) => {
    try {
      if (/^comgooglemaps:\/\//i.test(value)) return true;
      validateMapsUrl(value.replace(/^comgooglemapsurl:\/\//i, "https://"));
      return true;
    } catch {
      return false;
    }
  });
  if (accepted.length > 1)
    throw new NavError(
      "AMBIGUOUS_DESTINATION",
      "发现多个 Maps 链接，请选择一个",
    );
  if (accepted.length === 1) return accepted[0];
  if (all.length) {
    validateMapsUrl(all[0]!);
    throw new NavError("UNSUPPORTED_LINK", "不支持此链接");
  }
  return undefined;
}
export function parseSharedInput(input: string): ImportedIntent {
  const text = normalizeSharedText(input);
  const result: ImportedIntent = {
    importId: crypto.randomUUID(),
    sourceKind: "TEXT",
    destinationCandidates: [],
    waypoints: [],
    warnings: [],
    selectedGoogleItineraryImported: false,
  };
  const candidate = extractCandidateMapsUrl(text)?.replace(
    /^comgooglemapsurl:\/\//i,
    "https://",
  );
  if (!candidate) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text))
      throw new NavError("UNSUPPORTED_LINK", "不支持此链接格式");
    const coordinate = parseCoordinate(text);
    if (!coordinate && /^(?:NaN|Infinity|[+\-\d.]+)\s*[,，]/i.test(text))
      throw new NavError("INVALID_INPUT", "坐标格式无效");
    result.sourceKind = coordinate ? "COORDINATES" : "TEXT";
    result.destinationCandidates = [
      {
        ...(coordinate ? { coordinate } : { label: text }),
        source: "USER_INDEPENDENT_INPUT",
        evidence: "USER_INPUT",
        coordinateRole: "ENDPOINT",
        extractedFrom: coordinate ? "manual-coordinate" : "manual-text",
      },
    ];
    return result;
  }
  const ios = /^comgooglemaps:\/\//i.test(candidate);
  const url = ios ? new URL(candidate) : validateMapsUrl(candidate);
  if (ios && (url.hostname || url.pathname || url.username || url.password))
    throw new NavError("UNSAFE_URL", "不支持该 iOS scheme 结构");
  if (!ios && isShortMapsUrl(url))
    throw new NavError(
      "LINK_RESOLUTION_BLOCKED",
      "短链接需要已配置的安全展开服务",
      true,
      "粘贴完整 Maps URL 或配置个人后端",
    );
  const p = url.searchParams;
  for (const key of [
    "query",
    "query_place_id",
    "destination",
    "destination_place_id",
    "origin",
    "origin_place_id",
    "q",
    "daddr",
    "saddr",
    "travelmode",
    "dirflg",
    "directionsmode",
    "waypoints",
    "waypoint_place_ids",
  ])
    if (p.getAll(key).length > 1)
      throw new NavError("AMBIGUOUS_DESTINATION", "链接包含重复的行程字段");
  if (["continue", "url", "link"].some((key) => p.has(key)))
    throw new NavError("UNSUPPORTED_LINK", "不支持嵌套跳转链接");
  const official = !ios && p.get("api") === "1";
  const legacy = p.has("daddr") || p.has("saddr");
  if (official && (p.has("daddr") || p.has("q")))
    throw new NavError("AMBIGUOUS_DESTINATION", "链接混合了不同端点格式");
  const evidence = official || ios ? "DOCUMENTED_FIELD" : "VERIFIED_LEGACY";
  let destination: EndpointCandidate | undefined;
  if ((official && /^\/maps\/dir\/?$/.test(url.pathname)) || legacy) {
    result.sourceKind = "DIRECTIONS_LINK";
    const df = official ? "destination" : "daddr";
    const of = official ? "origin" : "saddr";
    destination = endpoint(
      p.get(df),
      df,
      evidence,
      official ? p.get("destination_place_id") : undefined,
    );
    const origin = p.get(of);
    if (origin && !dynamicOrigin.test(origin.trim()))
      result.originCandidate = endpoint(
        origin,
        of,
        evidence,
        official ? p.get("origin_place_id") : undefined,
      );
    if (result.originCandidate)
      result.warnings.push("原起点仅供参考；默认从当前手机位置出发");
    const mode = p.get(
      official ? "travelmode" : ios ? "directionsmode" : "dirflg",
    );
    const modes: Record<string, Mode> = {
      walking: "WALK",
      driving: "DRIVE",
      transit: "TRANSIT",
      w: "WALK",
      d: "DRIVE",
      r: "TRANSIT",
    };
    if (mode) {
      if (modes[mode]) result.modeHint = modes[mode];
      else result.warnings.push("不支持的出行模式，请重新选择");
    }
    if (official && p.has("waypoints")) {
      const waypoints = p.get("waypoints")!.split("|");
      const ids = p.get("waypoint_place_ids")?.split("|");
      if (
        waypoints.some((v) => !v.trim()) ||
        (ids && ids.length !== waypoints.length)
      )
        throw new NavError("INVALID_INPUT", "途经点与 ID 数量不匹配");
      result.waypoints = waypoints.map((v, i) =>
        endpoint(v, "waypoints", evidence, ids?.[i])!,
      );
      result.warnings.push("已保留途经点；查询前需确认路由服务支持范围");
    }
  } else if (official && /^\/maps\/search\/?$/.test(url.pathname)) {
    result.sourceKind = "PLACE_LINK";
    destination = endpoint(
      p.get("query"),
      "query",
      evidence,
      p.get("query_place_id"),
    );
  } else if ((ios || !official) && p.has("q")) {
    result.sourceKind = "PLACE_LINK";
    destination = endpoint(p.get("q"), "q", evidence);
  } else if (!official && /^\/maps\/dir\//.test(url.pathname)) {
    const segments = url.pathname.slice("/maps/dir/".length).split("/");
    const metadata = segments.findIndex(
      (segment) => segment.startsWith("@") || segment.startsWith("data="),
    );
    const endpoints = metadata < 0 ? segments : segments.slice(0, metadata);
    // A trailing slash is not an extra destination. Empty original origins are
    // supported; empty intermediate/destination segments remain ambiguous.
    if (endpoints.at(-1) === "") endpoints.pop();
    if (endpoints.length >= 2) {
      if (endpoints.slice(1).some((segment) => !segment))
        throw new NavError(
          "AMBIGUOUS_DESTINATION",
          "路径中的目的地或途经点为空",
        );
      result.sourceKind = "DIRECTIONS_LINK";
      destination = inferredPathEndpoint(
        endpoints.at(-1)!,
        "directions-path-destination-v1",
      );
      const origin = inferredPathEndpoint(
        endpoints[0],
        "directions-path-origin-v1",
      );
      if (origin && !dynamicOrigin.test(origin.label!))
        result.originCandidate = origin;
      result.waypoints = endpoints
        .slice(1, -1)
        .map((segment) =>
          inferredPathEndpoint(segment, "directions-path-waypoint-v1")!,
        );
      result.warnings.push(
        "非公开路线长链接仅提取名称提示，需补全并确认落点；未导入原路线或时刻",
      );
      if (result.originCandidate)
        result.warnings.push("原起点仅供参考；默认从当前手机位置出发");
      if (result.waypoints.length)
        result.warnings.push("已保留途经点；查询前需确认路由服务支持范围");
    }
  } else if (/^\/maps\/place\/[^/]+/.test(url.pathname)) {
    result.sourceKind = "PLACE_LINK";
    destination = inferredPathEndpoint(
      url.pathname.split("/")[3],
      "place-path-label-v1",
    );
    result.warnings.push("非公开长链接仅提取名称提示，需补全并确认落点");
  }
  if (!destination)
    throw new NavError(
      "DESTINATION_MISSING",
      "链接没有可识别目的地；地图中心不是目的地",
    );
  if (["center", "ll"].some((key) => p.has(key)) || url.pathname.includes("/@"))
    result.warnings.push("地图视口坐标未作为目的地使用");
  if (
    url.pathname.includes("/data=") ||
    ["data", "geocode", "ftid", "cid", "skid"].some((key) => p.has(key))
  )
    result.warnings.push("未解码内部标识或原行程");
  if (p.has("avoid"))
    result.warnings.push("避让条件未应用：请在重新规划时确认");
  if (["departure_time", "arrival_time", "time"].some((key) => p.has(key)))
    result.warnings.push("链接时刻未应用：默认现在出发");
  result.destinationCandidates = [destination];
  return result;
}
