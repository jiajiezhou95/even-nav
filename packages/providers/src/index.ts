import { z } from "zod";
import {
  NavError,
  type ConfirmedTripRequest,
  type Coordinate,
  type EndpointCandidate,
  type Route,
  type RouteLeg,
} from "../../contracts/src/index";
export type Fetcher = typeof fetch;
export interface ProviderDiagnostic {
  stage: "HTTP" | "TRANSPORT" | "SCHEMA";
  httpStatus?: number;
  issuePaths?: string[];
}
export class ProviderError extends NavError {
  constructor(
    message: string,
    public diagnostic: ProviderDiagnostic,
    retryable = false,
  ) {
    super("PROVIDER_UNAVAILABLE", message, retryable);
  }
}
const coordinate = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export const candidateSchema = z
  .object({
    label: z.string().max(500).optional(),
    address: z.string().max(1000).optional(),
    coordinate: coordinate.optional(),
    placeId: z
      .string()
      .regex(/^[\w-]{1,256}$/)
      .optional(),
    evidence: z.enum([
      "DOCUMENTED_FIELD",
      "VERIFIED_LEGACY",
      "INFERRED",
      "USER_INPUT",
    ]),
    source: z.enum([
      "GOOGLE_MAPS_SHARED_LINK",
      "GOOGLE_API_CONTENT",
      "OPEN_DATA",
      "USER_INDEPENDENT_INPUT",
    ]),
    extractedFrom: z.string().max(100),
    coordinateRole: z.enum(["ENDPOINT", "VIEWPORT_ONLY", "UNKNOWN"]),
    usagePolicyId: z.string().max(100).optional(),
  })
  .strict();
export const tripSchema = z
  .object({
    requestVersion: z.number().int().nonnegative(),
    origin: coordinate,
    originPolicy: z.enum([
      "CURRENT_DEVICE_LOCATION",
      "EXPLICIT_SHARED_ORIGIN",
      "MANUAL",
    ]),
    destination: candidateSchema,
    mode: z.enum(["WALK", "DRIVE", "TRANSIT"]),
    departureTime: z.string().datetime({ offset: true }),
    waypoints: z.array(candidateSchema).max(25),
    routeProvider: z.enum(["GOOGLE_ROUTES", "TRANSITOUS", "ORS"]),
    basemapProvider: z.enum(["GOOGLE_TILES", "OPEN_MAP"]),
    userConfirmed: z.literal(true),
    trafficAware: z.boolean().optional(),
  })
  .strict();
export function policyGuard(t: ConfirmedTripRequest) {
  const points = [t.destination, ...t.waypoints];
  if (points.some((p) => p.coordinateRole !== "ENDPOINT" || !p.coordinate))
    throw new NavError("DESTINATION_MISSING", "请先确认准确目的地坐标");
  if (
    t.basemapProvider !== "GOOGLE_TILES" &&
    (t.routeProvider === "GOOGLE_ROUTES" ||
      points.some((p) => p.source.startsWith("GOOGLE")) ||
      t.originPolicy === "EXPLICIT_SHARED_ORIGIN")
  )
    throw new NavError("INVALID_INPUT", "Google 来源内容需要 Google 底图");
  if (
    t.mode === "TRANSIT" &&
    (t.routeProvider !== "TRANSITOUS" || t.waypoints.length)
  )
    throw new NavError(
      "INVALID_INPUT",
      "公共交通暂不支持坐标途经点；请明确修改行程",
    );
  if (t.mode !== "TRANSIT" && t.routeProvider !== "GOOGLE_ROUTES")
    throw new NavError("CONFIG_MISSING", "开放道路供应商未配置");
  if (t.mode !== "DRIVE" && t.trafficAware)
    throw new NavError("INVALID_INPUT", "实时路况仅支持驾驶");
}
export function decodePolyline(encoded: string, precision = 5): Coordinate[] {
  if (encoded.length > 1_000_000 || precision < 0 || precision > 7)
    throw new NavError("PROVIDER_UNAVAILABLE", "路线几何无效");
  let i = 0,
    lat = 0,
    lng = 0;
  const out: Coordinate[] = [];
  const value = () => {
    let result = 0,
      shift = 0,
      b: number;
    do {
      if (i >= encoded.length || shift > 45)
        throw new NavError("PROVIDER_UNAVAILABLE", "路线几何无效");
      b = encoded.charCodeAt(i++) - 63;
      if (b < 0 || b > 63)
        throw new NavError("PROVIDER_UNAVAILABLE", "路线几何无效");
      result += (b & 31) * 2 ** shift;
      shift += 5;
    } while (b >= 32);
    return result % 2 ? -(Math.floor(result / 2) + 1) : result / 2;
  };
  while (i < encoded.length) {
    lat += value();
    lng += value();
    const p = { lat: lat / 10 ** precision, lng: lng / 10 ** precision };
    if (!coordinate.safeParse(p).success)
      throw new NavError("PROVIDER_UNAVAILABLE", "路线几何超出范围");
    out.push(p);
  }
  return out;
}
export async function upstream(
  url: string | URL,
  init: RequestInit = {},
  fetcher: Fetcher = fetch,
): Promise<Response> {
  try {
    const r = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      await r.body?.cancel();
      if (r.status === 429)
        throw new NavError("QUOTA_EXCEEDED", "供应商请求限额已达");
      throw new ProviderError(
        "供应商 HTTP 请求被拒绝",
        { stage: "HTTP", httpStatus: r.status },
        r.status >= 500,
      );
    }
    return r;
  } catch (e) {
    if (e instanceof NavError) throw e;
    throw new ProviderError(
      "供应商网络请求失败或超时",
      { stage: "TRANSPORT" },
      true,
    );
  }
}
export async function boundedJson(r: Response): Promise<unknown> {
  const reader = r.body?.getReader();
  if (!reader) throw new NavError("PROVIDER_UNAVAILABLE", "供应商返回空数据");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4_000_000)
        throw new NavError("PROVIDER_UNAVAILABLE", "供应商数据过大");
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      data.set(c, off);
      off += c.length;
    }
    return JSON.parse(new TextDecoder().decode(data));
  } finally {
    await reader.cancel();
  }
}
const duration = z
  .string()
  .regex(/^\d+(\.\d+)?s$/)
  .transform((v) => Number(v.slice(0, -1)));
const poly = z.object({ encodedPolyline: z.string() });
const gstep = z.object({
  distanceMeters: z.number().nonnegative().default(0),
  staticDuration: duration,
  polyline: poly,
  navigationInstruction: z
    .object({ instructions: z.string(), maneuver: z.string().optional() })
    .optional(),
});
const groad = z.object({
  routes: z
    .array(
      z.object({
        distanceMeters: z.number().nonnegative(),
        duration,
        legs: z
          .array(
            z.object({
              distanceMeters: z.number().nonnegative().default(0),
              duration,
              polyline: poly.optional(),
              steps: z.array(gstep).min(1),
            }),
          )
          .min(1),
      }),
    )
    .max(20)
    .default([]),
});
export const ROAD_FIELD_MASK =
  "routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.navigationInstruction";
export function roadSku(t: ConfirmedTripRequest) {
  return t.trafficAware || t.waypoints.length > 10
    ? "ROUTES_PRO"
    : "ROUTES_ESSENTIALS";
}
export async function googleRoutes(
  t: ConfirmedTripRequest,
  key: string,
  fetcher: Fetcher = fetch,
): Promise<Route[]> {
  policyGuard(t);
  const wp = (c: Coordinate) => ({
    location: { latLng: { latitude: c.lat, longitude: c.lng } },
  });
  const body = {
    origin: wp(t.origin),
    destination: wp(t.destination.coordinate!),
    intermediates: t.waypoints.map((p) => wp(p.coordinate!)),
    travelMode: t.mode,
    computeAlternativeRoutes: t.waypoints.length === 0,
    languageCode: "ja",
    units: "METRIC",
    ...(t.mode === "DRIVE"
      ? {
          routingPreference: t.trafficAware
            ? "TRAFFIC_AWARE"
            : "TRAFFIC_UNAWARE",
        }
      : {}),
    ...(t.trafficAware ? { departureTime: t.departureTime } : {}),
  };
  const parsed = groad.safeParse(
    await boundedJson(
      await upstream(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": ROAD_FIELD_MASK,
          },
          body: JSON.stringify(body),
        },
        fetcher,
      ),
    ),
  );
  if (!parsed.success)
    throw new NavError("PROVIDER_UNAVAILABLE", "路线响应格式无效");
  if (!parsed.data.routes.length)
    throw new NavError("NO_ROUTE", "没有可用道路路线");
  return parsed.data.routes.slice(0, 3).map((r) => ({
    id: crypto.randomUUID(),
    provider: "GOOGLE_ROUTES",
    basemapProvider: "GOOGLE_TILES",
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    distanceMeters: r.distanceMeters,
    durationSeconds: r.duration,
    warnings:
      t.mode === "WALK"
        ? ["步行路线为 Beta，可能缺少人行道或步行路径；请留意现场安全。"]
        : [],
    attribution: ["Google Maps"],
    legs: r.legs.map((l) => {
      const steps = l.steps.map((s) => ({
        instruction: s.navigationInstruction?.instructions ?? "沿路线前进",
        maneuver: s.navigationInstruction?.maneuver,
        geometry: decodePolyline(s.polyline.encodedPolyline),
        distanceMeters: s.distanceMeters,
        durationSeconds: s.staticDuration,
      }));
      return {
        mode: t.mode as "WALK" | "DRIVE",
        distanceMeters: l.distanceMeters,
        durationSeconds: l.duration,
        geometry: l.polyline
          ? decodePolyline(l.polyline.encodedPolyline)
          : steps.flatMap((s) => s.geometry),
        steps,
      };
    }),
  }));
}
const mpoly = z.object({
  points: z.string(),
  precision: z.number().int().min(0).max(7),
});
const place = z.object({
  name: z.string().optional(),
  track: z.string().optional(),
});
const mleg = z.object({
  mode: z.string(),
  startTime: z.string().datetime({ offset: true }),
  endTime: z.string().datetime({ offset: true }),
  duration: z.number().nonnegative(),
  distance: z.number().nonnegative().optional(),
  from: place,
  to: place,
  legGeometry: mpoly,
  steps: z
    .array(
      z.object({
        relativeDirection: z.string(),
        streetName: z.string(),
        distance: z.number().nonnegative(),
        polyline: mpoly,
      }),
    )
    .optional(),
  realTime: z.boolean(),
  routeShortName: z.string().optional(),
  displayName: z.string().optional(),
  headsign: z.string().optional(),
  interlineWithPreviousLeg: z.boolean().optional(),
  cancelled: z.boolean().optional(),
  loopedCalendarSince: z.string().optional(),
});
const mresponse = z.object({
  itineraries: z
    .array(
      z.object({
        duration: z.number().nonnegative(),
        legs: z.array(mleg).min(1),
      }),
    )
    .default([]),
});
const railModes = [
  "TRAM",
  "SUBWAY",
  "RAIL",
  "HIGHSPEED_RAIL",
  "LONG_DISTANCE",
  "NIGHT_RAIL",
  "REGIONAL_FAST_RAIL",
  "REGIONAL_RAIL",
  "SUBURBAN",
  "METRO",
];
export async function transitRoutes(
  t: ConfirmedTripRequest,
  userAgent: string,
  fetcher: Fetcher = fetch,
): Promise<Route[]> {
  policyGuard(t);
  const u = new URL("https://api.transitous.org/api/v6/plan");
  u.search = new URLSearchParams({
    fromPlace: `${t.origin.lat},${t.origin.lng}`,
    toPlace: `${t.destination.coordinate!.lat},${t.destination.coordinate!.lng}`,
    time: t.departureTime,
    transitModes: railModes.join(","),
    directModes: "",
    preTransitModes: "WALK",
    postTransitModes: "WALK",
    detailedLegs: "true",
    detailedTransfers: "true",
    useRoutedTransfers: "true",
    joinInterlinedLegs: "false",
    numItineraries: "3",
    maxItineraries: "3",
  }).toString();
  const p = mresponse.safeParse(
    await boundedJson(
      await upstream(u, { headers: { "User-Agent": userAgent } }, fetcher),
    ),
  );
  if (!p.success)
    throw new ProviderError("公共交通响应格式无效", {
      stage: "SCHEMA",
      issuePaths: p.error.issues
        .slice(0, 8)
        .map((issue) =>
          issue.path
            .map((part) =>
              typeof part === "number" ? "[]" : String(part).slice(0, 48),
            )
            .join("."),
        ),
    });
  const routes: Route[] = [];
  for (const it of p.data.itineraries) {
    if (
      !it.legs.some((l) => railModes.includes(l.mode)) ||
      it.legs.some((l) => l.cancelled || l.loopedCalendarSince)
    )
      continue;
    const legs: RouteLeg[] = [];
    let previous = Date.parse(t.departureTime);
    let valid = true;
    for (const l of it.legs) {
      const start = Date.parse(l.startTime),
        end = Date.parse(l.endTime);
      if (
        start < previous ||
        end < start ||
        Math.abs((end - start) / 1000 - l.duration) > 1
      ) {
        valid = false;
        break;
      }
      if (start > previous && !l.interlineWithPreviousLeg)
        legs.push({
          mode: "WAIT",
          startTime: new Date(previous).toISOString(),
          endTime: l.startTime,
          durationSeconds: (start - previous) / 1000,
          distanceMeters: 0,
          geometry: [],
          steps: [],
          to: l.from.name,
        });
      const walking = l.mode === "WALK";
      const geometry = decodePolyline(
        l.legGeometry.points,
        l.legGeometry.precision,
      );
      if (
        walking &&
        l.duration > 0 &&
        (!l.steps?.length || geometry.length < 2)
      ) {
        valid = false;
        break;
      }
      if (!walking && !railModes.includes(l.mode)) {
        valid = false;
        break;
      }
      legs.push({
        mode: walking
          ? legs.some((x) => x.mode === "RIDE")
            ? "TRANSFER"
            : "WALK"
          : "RIDE",
        geometry,
        distanceMeters: l.distance ?? 0,
        durationSeconds: l.duration,
        startTime: l.startTime,
        endTime: l.endTime,
        line: l.displayName ?? l.routeShortName,
        headsign: l.headsign,
        from: l.from.name,
        to: l.to.name,
        platform: l.from.track,
        realtime: l.realTime,
        staySeated: l.interlineWithPreviousLeg,
        steps: (l.steps ?? []).map((s) => ({
          instruction: `${s.relativeDirection} ${s.streetName}`.trim(),
          maneuver: s.relativeDirection,
          geometry: decodePolyline(s.polyline.points, s.polyline.precision),
          distanceMeters: s.distance,
          durationSeconds: 0,
        })),
      });
      previous = end;
    }
    if (!valid) continue;
    const last = legs.at(-1);
    if (last?.mode === "TRANSFER") last.mode = "WALK";
    routes.push({
      id: crypto.randomUUID(),
      provider: "TRANSITOUS",
      basemapProvider: t.basemapProvider,
      fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      legs,
      distanceMeters: legs.reduce((n, l) => n + l.distanceMeters, 0),
      durationSeconds: legs.reduce((n, l) => n + l.durationSeconds, 0),
      warnings: [
        "时刻与日本运营商覆盖尚需真实请求核验；无实时字段不代表准点。",
      ],
      attribution: [
        "Transitous https://transitous.org/sources/",
        "© OpenStreetMap contributors",
      ],
    });
    if (routes.length === 3) break;
  }
  if (!routes.length)
    throw new NavError(
      "NO_ROUTE",
      "没有包含完整步行指示、有效班次的铁路门到门路线",
    );
  return routes;
}
export function enrichmentSku(
  c: EndpointCandidate,
): "DETAILS" | "GEOCODING" | "TEXT_SEARCH" {
  return c.placeId ? "DETAILS" : c.address ? "GEOCODING" : "TEXT_SEARCH";
}
export async function enrichDestination(
  c: EndpointCandidate,
  key: string,
  fetcher: Fetcher = fetch,
): Promise<EndpointCandidate[]> {
  if (c.coordinate && c.coordinateRole === "ENDPOINT") return [c];
  if (c.placeId) {
    const p = z
      .object({
        id: z.string(),
        formattedAddress: z.string().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }),
      })
      .safeParse(
        await boundedJson(
          await upstream(
            `https://places.googleapis.com/v1/places/${encodeURIComponent(c.placeId)}`,
            {
              headers: {
                "X-Goog-Api-Key": key,
                "X-Goog-FieldMask": "id,formattedAddress,location",
              },
            },
            fetcher,
          ),
        ),
      );
    if (!p.success) throw new NavError("PROVIDER_UNAVAILABLE", "地点响应无效");
    return [
      {
        ...c,
        address: p.data.formattedAddress,
        coordinate: coordinate.parse({
          lat: p.data.location.latitude,
          lng: p.data.location.longitude,
        }),
        source: "GOOGLE_API_CONTENT",
        evidence: "DOCUMENTED_FIELD",
        coordinateRole: "ENDPOINT",
        extractedFrom: "places-details-v1",
        usagePolicyId: "google-places",
      },
    ];
  }
  if (!c.address && c.label) {
    const p = z
      .object({
        places: z
          .array(
            z.object({
              id: z.string(),
              displayName: z.object({ text: z.string() }).optional(),
              formattedAddress: z.string().optional(),
              location: z.object({
                latitude: z.number(),
                longitude: z.number(),
              }),
            }),
          )
          .default([]),
      })
      .safeParse(
        await boundedJson(
          await upstream(
            "https://places.googleapis.com/v1/places:searchText",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": key,
                "X-Goog-FieldMask":
                  "places.id,places.displayName,places.formattedAddress,places.location",
              },
              body: JSON.stringify({
                textQuery: c.label,
                languageCode: "ja",
                regionCode: "JP",
                pageSize: 5,
              }),
            },
            fetcher,
          ),
        ),
      );
    if (!p.success)
      throw new NavError("PROVIDER_UNAVAILABLE", "地点搜索响应无效");
    if (!p.data.places.length)
      throw new NavError("DESTINATION_MISSING", "未找到目的地");
    return p.data.places
      .slice(0, 5)
      .map((x) => ({
        label: x.displayName?.text ?? c.label,
        address: x.formattedAddress,
        placeId: x.id,
        coordinate: coordinate.parse({
          lat: x.location.latitude,
          lng: x.location.longitude,
        }),
        source: "GOOGLE_API_CONTENT",
        evidence: "DOCUMENTED_FIELD",
        coordinateRole: "ENDPOINT",
        extractedFrom: "places-text-search-v1",
        usagePolicyId: "google-places",
      }));
  }
  const query = c.address ?? c.label;
  if (!query) throw new NavError("DESTINATION_MISSING", "缺少目的地");
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  u.search = new URLSearchParams({
    address: query,
    language: "ja",
    region: "jp",
    key,
  }).toString();
  const p = z
    .object({
      status: z.string(),
      results: z.array(
        z.object({
          formatted_address: z.string(),
          place_id: z.string(),
          geometry: z.object({ location: coordinate }),
          partial_match: z.boolean().optional(),
        }),
      ),
    })
    .safeParse(await boundedJson(await upstream(u, {}, fetcher)));
  if (!p.success || !["OK", "ZERO_RESULTS"].includes(p.data.status))
    throw new NavError("PROVIDER_UNAVAILABLE", "地点补全失败");
  if (!p.data.results.length)
    throw new NavError("DESTINATION_MISSING", "未找到目的地");
  return p.data.results
    .slice(0, 5)
    .map((x) => ({
      label: c.label,
      address: x.formatted_address,
      placeId: x.place_id,
      coordinate: x.geometry.location,
      source: "GOOGLE_API_CONTENT",
      evidence: x.partial_match ? "INFERRED" : "DOCUMENTED_FIELD",
      coordinateRole: "ENDPOINT",
      extractedFrom: "geocoding-v3",
      usagePolicyId: "google-geocoding",
    }));
}
