import {
  isCoordinate,
  NavError,
  type Coordinate,
} from "../../contracts/src/index";
const R = 6371008.8;
const radians = (n: number) => (n * Math.PI) / 180;
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const dlat = radians(b.lat - a.lat),
    dlng = radians(b.lng - a.lng);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(dlng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function fromGeoJSON(position: number[]): Coordinate {
  const c = { lng: position[0], lat: position[1] };
  if (position.length < 2 || !isCoordinate(c))
    throw new NavError("INVALID_INPUT", "GeoJSON 坐标无效");
  return c;
}
export function toGeoJSON(c: Coordinate): [number, number] {
  if (!isCoordinate(c)) throw new NavError("INVALID_INPUT", "坐标无效");
  return [c.lng, c.lat];
}
export function worldPixel(
  c: Coordinate,
  zoom: number,
): { x: number; y: number } {
  if (!isCoordinate(c) || !Number.isInteger(zoom) || zoom < 0 || zoom > 22)
    throw new NavError("INVALID_INPUT", "投影参数无效");
  const size = 256 * 2 ** zoom,
    lat = radians(Math.max(-85.05112878, Math.min(85.05112878, c.lat)));
  return {
    x: ((c.lng + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size,
  };
}
export function geometryLength(points: Coordinate[]): number {
  return points
    .slice(1)
    .reduce((sum, p, i) => sum + distanceMeters(points[i], p), 0);
}
export interface RouteMatch {
  coordinate: Coordinate;
  distanceMeters: number;
  alongMeters: number;
  segmentIndex: number;
}
/** Match only the active leg, optionally restrict plausible progress to avoid loop jumps. */
export function matchGeometry(
  point: Coordinate,
  line: Coordinate[],
  minAlong = 0,
  maxAlong = Infinity,
): RouteMatch | undefined {
  let best: RouteMatch | undefined,
    prefix = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      length = distanceMeters(a, b);
    const cos = Math.cos(radians(point.lat));
    const dx = (b.lng - a.lng) * cos,
      dy = b.lat - a.lat;
    const px = (point.lng - a.lng) * cos,
      py = point.lat - a.lat;
    const t = Math.max(
      0,
      Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)),
    );
    const alongMeters = prefix + t * length;
    const coordinate = {
      lat: a.lat + t * (b.lat - a.lat),
      lng: a.lng + t * (b.lng - a.lng),
    };
    const distance = distanceMeters(point, coordinate);
    if (
      alongMeters >= minAlong &&
      alongMeters <= maxAlong &&
      (!best || distance < best.distanceMeters)
    )
      best = {
        coordinate,
        distanceMeters: distance,
        alongMeters,
        segmentIndex: i - 1,
      };
    prefix += length;
  }
  if (line.length === 1 && minAlong === 0)
    return {
      coordinate: line[0],
      distanceMeters: distanceMeters(point, line[0]),
      alongMeters: 0,
      segmentIndex: 0,
    };
  return best;
}
