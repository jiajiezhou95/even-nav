export type Mode = "WALK" | "DRIVE" | "TRANSIT";
export interface Coordinate {
  lat: number;
  lng: number;
}
export type DataSource =
  | "GOOGLE_MAPS_SHARED_LINK"
  | "GOOGLE_API_CONTENT"
  | "OPEN_DATA"
  | "USER_INDEPENDENT_INPUT";
export interface EndpointCandidate {
  label?: string;
  address?: string;
  coordinate?: Coordinate;
  placeId?: string;
  evidence: "DOCUMENTED_FIELD" | "VERIFIED_LEGACY" | "INFERRED" | "USER_INPUT";
  source: DataSource;
  extractedFrom: string;
  coordinateRole: "ENDPOINT" | "VIEWPORT_ONLY" | "UNKNOWN";
  usagePolicyId?: string;
}
export interface ImportedIntent {
  importId: string;
  sourceKind: "PLACE_LINK" | "DIRECTIONS_LINK" | "COORDINATES" | "TEXT";
  destinationCandidates: EndpointCandidate[];
  originCandidate?: EndpointCandidate;
  modeHint?: Mode;
  waypoints: EndpointCandidate[];
  warnings: string[];
  selectedGoogleItineraryImported: false;
}
export interface ConfirmedTripRequest {
  requestVersion: number;
  origin: Coordinate;
  originPolicy: "CURRENT_DEVICE_LOCATION" | "EXPLICIT_SHARED_ORIGIN" | "MANUAL";
  destination: EndpointCandidate;
  mode: Mode;
  departureTime: string;
  waypoints: EndpointCandidate[];
  routeProvider: "GOOGLE_ROUTES" | "TRANSITOUS" | "ORS";
  basemapProvider: "GOOGLE_TILES" | "OPEN_MAP";
  userConfirmed: true;
  trafficAware?: boolean;
}
export interface RouteStep {
  instruction: string;
  geometry: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
  maneuver?: string;
}
export interface StationAccess {
  source: "NAVITIME";
  fetchedAt: string;
  nodeId: string;
  lineId: string;
  selection: "UNSELECTED_CANDIDATES" | "NEAREST_STRAIGHT_LINE";
  /** Geometric proximity only; not a verified accessible or shortest walking path. */
  selectedGateway?: {
    name: string;
    coordinate: Coordinate;
    directions: ("up" | "down")[];
    distanceMeters: number;
    reference: "WALK_ORIGIN" | "WALK_DESTINATION";
  };
  gateways: {
    name: string;
    coordinate: Coordinate;
    directions: ("up" | "down")[];
  }[];
}
export interface NavitimeStatus {
  exits:
    | "NOT_CONFIGURED"
    | "NO_MATCH"
    | "AVAILABLE"
    | "PARTIAL"
    | "UNAVAILABLE"
    | "LIMIT_REACHED";
  platforms: "NOT_INCLUDED_IN_FREE_TRANSPORT";
}
export interface RouteStop {
  stationAccess?: StationAccess;
  name?: string;
  coordinate?: Coordinate;
  platform?: string;
  scheduledPlatform?: string;
  arrivalTime?: string;
  departureTime?: string;
  scheduledArrivalTime?: string;
  scheduledDepartureTime?: string;
  cancelled?: boolean;
}
export interface RouteLeg {
  mode: "WALK" | "DRIVE" | "WAIT" | "RIDE" | "TRANSFER";
  geometry: Coordinate[];
  steps: RouteStep[];
  distanceMeters: number;
  durationSeconds: number;
  startTime?: string;
  endTime?: string;
  line?: string;
  headsign?: string;
  agency?: string;
  from?: string;
  to?: string;
  platform?: string;
  fromStop?: RouteStop;
  toStop?: RouteStop;
  intermediateStops?: RouteStop[];
  realtime?: boolean;
  staySeated?: boolean;
}
export interface Route {
  navitime?: NavitimeStatus;
  id: string;
  provider: "GOOGLE_ROUTES" | "TRANSITOUS" | "ORS";
  basemapProvider: "GOOGLE_TILES" | "OPEN_MAP";
  fetchedAt: string;
  expiresAt: string;
  legs: RouteLeg[];
  distanceMeters: number;
  durationSeconds: number;
  warnings: string[];
  attribution: string[];
}
export type ErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_LINK"
  | "UNSAFE_URL"
  | "REDIRECT_LOOP"
  | "LINK_TIMEOUT"
  | "LINK_RESOLUTION_BLOCKED"
  | "DESTINATION_MISSING"
  | "AMBIGUOUS_DESTINATION"
  | "CONFIG_MISSING"
  | "AUTH_FAILED"
  | "QUOTA_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "NO_ROUTE"
  | "LOCATION_UNAVAILABLE"
  | "DISPLAY_DISCONNECTED";
export class NavError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryable = false,
    public fallback = "请检查输入或使用手动坐标",
  ) {
    super(message);
    this.name = "NavError";
  }
}
export function isCoordinate(v: unknown): v is Coordinate {
  if (!v || typeof v !== "object") return false;
  const p = v as Coordinate;
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}
