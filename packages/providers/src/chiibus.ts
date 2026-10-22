import { unzipSync, strFromU8 } from "fflate";
import {
  isCoordinate,
  type ConfirmedTripRequest,
  type Coordinate,
  type Route,
  type RouteLeg,
  type RouteStop,
} from "../../contracts/src/index";

type Row = Record<string, string>;
type Stop = { id: string; name: string; coordinate: Coordinate };
type Call = {
  stop: Stop;
  arrival: number;
  departure: number;
  pickup: boolean;
  dropoff: boolean;
  headsign?: string;
  shapeIndex: number;
};
type Trip = {
  id: string;
  route: string;
  name: string;
  service: string;
  headsign?: string;
  shape: Coordinate[];
  calls: Call[];
};
export type ChiibusFeed = {
  start: string;
  end: string;
  agency: string;
  trips: Trip[];
  calendars: Row[];
  exceptions: Row[];
};
const URL = "https://gtfs-jp.buskita.com/fxc/gtfs.zip";
const FILES = [
  "agency.txt",
  "routes.txt",
  "trips.txt",
  "stops.txt",
  "stop_times.txt",
  "shapes.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "feed_info.txt",
];
const MAX_ZIP = 1024 * 1024;
const MAX_RAW = 12 * 1024 * 1024;
const DAY = 86400000;
const JST = 9 * 3600000;
function invalid(): never {
  throw new Error("Invalid Chiibus GTFS feed");
}
function csv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const pushField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const pushRow = () => {
    pushField();
    if (row.some(Boolean)) rows.push(row);
    row = [];
  };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === '"') {
      if (field || closed) invalid();
      quoted = true;
    } else if (c === ",") pushField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      if (closed) invalid();
      field += c;
    }
  }
  if (quoted) invalid();
  if (field || row.length || closed) pushRow();
  const headers = rows.shift();
  if (
    !headers?.length ||
    new Set(headers).size !== headers.length ||
    headers.some(
      (h) => !h || ["__proto__", "constructor", "prototype"].includes(h),
    )
  )
    invalid();
  return rows.map((r) => {
    if (r.length !== headers.length) invalid();
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}
function dateKey(ms: number) {
  return new Date(ms + JST).toISOString().slice(0, 10).replaceAll("-", "");
}
function dateValid(s: string) {
  if (!/^\d{8}$/.test(s)) return false;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const n = Date.parse(iso);
  return Number.isFinite(n) && new Date(n).toISOString().startsWith(iso);
}
function seconds(s: string) {
  const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(s);
  if (!m || +m[1] > 47) invalid();
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}
function coordinate(lat: string, lng: string) {
  if (!lat?.trim() || !lng?.trim()) invalid();
  const c = { lat: +lat, lng: +lng };
  if (!isCoordinate(c)) invalid();
  return c;
}
function meters(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180,
    p = (b.lat - a.lat) * rad,
    q = (b.lng - a.lng) * rad;
  return (
    12742000 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(p / 2) ** 2 +
            Math.cos(a.lat * rad) *
              Math.cos(b.lat * rad) *
              Math.sin(q / 2) ** 2,
        ),
      ),
    )
  );
}
function length(points: Coordinate[]) {
  return points.slice(1).reduce((n, p, i) => n + meters(points[i], p), 0);
}
function integer(s: string) {
  if (!/^\d+$/.test(s)) invalid();
  return +s;
}
// Match the whole ordered stop sequence: a greedy nearest point can jump to
// the closing occurrence of a loop and discard all following stops.
function alignStops(stops: Stop[], shape: Coordinate[]): number[] | undefined {
  let costs = new Float64Array(shape.length).fill(Infinity);
  const parents: Int32Array[] = [];
  for (let i = 0; i < stops.length; i++) {
    const next = new Float64Array(shape.length).fill(Infinity);
    const parent = new Int32Array(shape.length).fill(-1);
    let best = Infinity,
      index = -1;
    for (let j = 0; j < shape.length; j++) {
      if (j && costs[j - 1] < best) {
        best = costs[j - 1];
        index = j - 1;
      }
      const d = meters(stops[i].coordinate, shape[j]);
      if (d <= 250 && (i === 0 || index >= 0)) {
        next[j] = d * d + (i === 0 ? 0 : best);
        parent[j] = index;
      }
    }
    costs = next;
    parents.push(parent);
  }
  let end = -1,
    best = Infinity;
  for (let i = 0; i < costs.length; i++)
    if (costs[i] < best) {
      best = costs[i];
      end = i;
    }
  if (end < 0) return;
  const result = new Array<number>(stops.length);
  for (let i = stops.length - 1; i >= 0; i--) {
    result[i] = end;
    end = parents[i][end];
  }
  return result;
}
export function parseChiibusFeed(zip: Uint8Array): ChiibusFeed {
  if (!zip.length || zip.length > MAX_ZIP) invalid();
  let raw = 0;
  const files = unzipSync(zip, {
    filter: (f) => {
      raw += f.originalSize;
      if (raw > MAX_RAW || f.originalSize > MAX_RAW) invalid();
      return FILES.includes(f.name);
    },
  });
  const read = (n: string, required = true) => {
    if (!files[n]) {
      if (required) invalid();
      return [];
    }
    return csv(strFromU8(files[n]));
  };
  const info = read("feed_info.txt")[0];
  if (
    !info ||
    !dateValid(info.feed_start_date) ||
    !dateValid(info.feed_end_date) ||
    info.feed_start_date > info.feed_end_date
  )
    invalid();
  const agencies = read("agency.txt");
  const agency = agencies.find((a) => a.agency_timezone === "Asia/Tokyo");
  if (!agency?.agency_name) invalid();
  const routes = new Map(
    read("routes.txt")
      .filter(
        (r) => ["00001", "00006"].includes(r.route_id) && r.route_type === "3",
      )
      .map((r) => [r.route_id, r]),
  );
  const stops = new Map<string, Stop>();
  for (const r of read("stops.txt")) {
    if (!r.stop_id || !r.stop_name || stops.has(r.stop_id)) invalid();
    stops.set(r.stop_id, {
      id: r.stop_id,
      name: r.stop_name,
      coordinate: coordinate(r.stop_lat, r.stop_lon),
    });
  }
  const shapes = new Map<string, { sequence: number; point: Coordinate }[]>();
  for (const r of read("shapes.txt")) {
    const list = shapes.get(r.shape_id) ?? [];
    list.push({
      sequence: integer(r.shape_pt_sequence),
      point: coordinate(r.shape_pt_lat, r.shape_pt_lon),
    });
    shapes.set(r.shape_id, list);
  }
  const geometry = new Map<string, Coordinate[]>();
  for (const [id, points] of shapes) {
    points.sort((a, b) => a.sequence - b.sequence);
    if (points.some((p, i) => i > 0 && p.sequence === points[i - 1].sequence))
      invalid();
    geometry.set(
      id,
      points.map((p) => p.point),
    );
  }
  const selected = read("trips.txt").filter((t) => routes.has(t.route_id));
  const ids = new Set(selected.map((t) => t.trip_id));
  if (ids.size !== selected.length) invalid();
  const times = new Map<string, Row[]>();
  for (const r of read("stop_times.txt"))
    if (ids.has(r.trip_id)) {
      const list = times.get(r.trip_id) ?? [];
      list.push(r);
      times.set(r.trip_id, list);
    }
  const trips: Trip[] = [];
  const alignments = new Map<string, number[]>();
  for (const t of selected) {
    const shape = geometry.get(t.shape_id);
    if (!shape || shape.length < 2) continue;
    const rr = (times.get(t.trip_id) ?? []).sort(
      (a, b) => integer(a.stop_sequence) - integer(b.stop_sequence),
    );
    const calls: Call[] = [];
    const pattern = `${t.shape_id}/${rr.map((r) => r.stop_id).join("|")}`;
    const alignment =
      alignments.get(pattern) ??
      alignStops(
        rr.map((r) => {
          const s = stops.get(r.stop_id);
          if (!s) invalid();
          return s;
        }),
        shape,
      );
    if (!alignment) continue;
    for (const [i, r] of rr.entries()) {
      if (i && integer(r.stop_sequence) === integer(rr[i - 1].stop_sequence))
        invalid();
      const stop = stops.get(r.stop_id);
      if (!stop) invalid();
      const arrival = seconds(r.arrival_time),
        departure = seconds(r.departure_time);
      if (departure < arrival || (i && arrival < calls[i - 1].departure))
        invalid();
      const best = alignment[i];
      calls.push({
        stop,
        arrival,
        departure,
        pickup: !r.pickup_type || r.pickup_type === "0",
        dropoff: !r.drop_off_type || r.drop_off_type === "0",
        headsign: r.stop_headsign || undefined,
        shapeIndex: best,
      });
    }
    const route = routes.get(t.route_id)!;
    alignments.set(
      pattern,
      calls.map((c) => c.shapeIndex),
    );
    if (calls.length >= 2)
      trips.push({
        id: t.trip_id,
        route: t.route_id,
        name: route.route_long_name || route.route_short_name,
        service: t.service_id,
        headsign: t.trip_headsign || undefined,
        shape,
        calls,
      });
  }
  const calendars = read("calendar.txt", false),
    exceptions = read("calendar_dates.txt", false);
  if (!calendars.length && !exceptions.length) invalid();
  for (const c of calendars)
    if (
      !dateValid(c.start_date) ||
      !dateValid(c.end_date) ||
      [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ].some((d) => !["0", "1"].includes(c[d]))
    )
      invalid();
  for (const e of exceptions)
    if (!dateValid(e.date) || !["1", "2"].includes(e.exception_type)) invalid();
  return {
    start: info.feed_start_date,
    end: info.feed_end_date,
    agency: agency.agency_name,
    trips,
    calendars,
    exceptions,
  };
}
const loads = new WeakMap<
  typeof fetch,
  { at: number; feed?: ChiibusFeed; pending?: Promise<ChiibusFeed> }
>();
export async function loadChiibusFeed(
  fetcher: typeof fetch = fetch,
  cacheKey: typeof fetch = fetcher,
): Promise<ChiibusFeed> {
  let state = loads.get(cacheKey);
  if (!state) {
    state = { at: 0 };
    loads.set(cacheKey, state);
  }
  const today = dateKey(Date.now());
  if (
    state.feed &&
    Date.now() - state.at < DAY &&
    today >= state.feed.start &&
    today <= state.feed.end
  )
    return state.feed;
  if (state.pending) return state.pending;
  const entry = state;
  entry.pending = (async () => {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetcher(URL, {
        // Workers supports manual/follow, not the browser's error mode.
        // The status check below rejects redirects without following them.
        redirect: "manual",
        signal: controller.signal,
      });
      if (
        !response.ok ||
        +(response.headers.get("content-length") || 0) > MAX_ZIP ||
        !response.body
      )
        invalid();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_ZIP) {
            await reader.cancel();
            invalid();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const feed = parseChiibusFeed(bytes);
      if (today < feed.start || today > feed.end) invalid();
      entry.feed = feed;
      entry.at = Date.now();
      return feed;
    } finally {
      clearTimeout(timer);
      entry.pending = undefined;
    }
  })();
  return entry.pending;
}
export function chiibusEligible(t: ConfirmedTripRequest): boolean {
  const inside = (p: Coordinate | undefined) =>
    !!p &&
    isCoordinate(p) &&
    p.lat >= 35.64 &&
    p.lat <= 35.685 &&
    p.lng >= 139.705 &&
    p.lng <= 139.765;
  return (
    t.mode === "TRANSIT" &&
    t.basemapProvider === "GOOGLE_TILES" &&
    !t.waypoints.length &&
    inside(t.origin) &&
    inside(t.destination.coordinate)
  );
}
function active(feed: ChiibusFeed, service: string, midnight: number) {
  const day = dateKey(midnight);
  if (day < feed.start || day > feed.end) return false;
  const ex = feed.exceptions.find(
    (e) => e.service_id === service && e.date === day,
  );
  if (ex) return ex.exception_type === "1";
  const weekday = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][new Date(midnight + JST).getUTCDay()];
  return feed.calendars.some(
    (c) =>
      c.service_id === service &&
      day >= c.start_date &&
      day <= c.end_date &&
      c[weekday] === "1",
  );
}
type Option = {
  trip: Trip;
  i: number;
  j: number;
  base: number;
  departure: number;
  arrival: number;
  access: number;
  egress: number;
  score: number;
};
function validWalk(route: Route) {
  return (
    route.provider === "GOOGLE_ROUTES" &&
    route.legs.length > 0 &&
    route.legs.every(
      (l) =>
        l.mode === "WALK" &&
        l.geometry.length >= 2 &&
        l.geometry.every(isCoordinate) &&
        Number.isFinite(l.distanceMeters) &&
        l.distanceMeters >= 0 &&
        l.steps.every(
          (s) =>
            (s.geometry.length > 0 || s.distanceMeters === 0) &&
            s.geometry.every(isCoordinate) &&
            Number.isFinite(s.durationSeconds) &&
            s.durationSeconds >= 0 &&
            Number.isFinite(s.distanceMeters) &&
            s.distanceMeters >= 0,
        ) &&
        Number.isFinite(l.durationSeconds) &&
        l.durationSeconds >= 0,
    ) &&
    Number.isFinite(route.durationSeconds) &&
    route.durationSeconds >= 0
  );
}
function stampWalk(
  route: Route,
  start: number,
  from: string | undefined,
  to: string | undefined,
): RouteLeg[] {
  let time = start;
  return route.legs.map((leg, i) => {
    const end = time + leg.durationSeconds * 1000;
    const copy = {
      ...leg,
      from: i === 0 ? from : leg.from,
      to: i === route.legs.length - 1 ? to : leg.to,
      startTime: new Date(time).toISOString(),
      endTime: new Date(end).toISOString(),
    };
    time = end;
    return copy;
  });
}
export async function planChiibusRoutes(
  t: ConfirmedTripRequest,
  feed: ChiibusFeed,
  walk: (from: Coordinate, to: Coordinate) => Promise<Route>,
): Promise<Route[]> {
  if (!chiibusEligible(t)) return [];
  const start = Date.parse(t.departureTime);
  if (
    !Number.isFinite(start) ||
    dateKey(start) < feed.start ||
    dateKey(start) > feed.end ||
    dateKey(Date.now()) > feed.end
  )
    return [];
  const destination = t.destination.coordinate!,
    midnight = Math.floor((start + JST) / DAY) * DAY - JST,
    options: Option[] = [];
  const accessDistances = new Map<string, number>(),
    egressDistances = new Map<string, number>();
  const distanceTo = (
    stop: Stop,
    point: Coordinate,
    cache: Map<string, number>,
  ) => {
    let d = cache.get(stop.id);
    if (d === undefined) {
      d = meters(stop.coordinate, point);
      cache.set(stop.id, d);
    }
    return d;
  };
  for (const base of [midnight - DAY, midnight, midnight + DAY])
    for (const trip of feed.trips) {
      if (!active(feed, trip.service, base)) continue;
      for (let i = 0; i < trip.calls.length - 1; i++) {
        const a = trip.calls[i];
        if (!a.pickup) continue;
        const access = distanceTo(a.stop, t.origin, accessDistances);
        if (access > 1200) continue;
        const departure = base + a.departure * 1000;
        if (
          departure < start + (access / 1.4) * 1000 + 60000 ||
          departure > start + 3 * 3600000
        )
          continue;
        for (let j = i + 1; j < trip.calls.length; j++) {
          const b = trip.calls[j];
          if (!b.dropoff) continue;
          const egress = distanceTo(b.stop, destination, egressDistances);
          if (egress > 1200) continue;
          const arrival = base + b.arrival * 1000;
          options.push({
            trip,
            i,
            j,
            base,
            departure,
            arrival,
            access,
            egress,
            score:
              (arrival - start) / 1000 + egress / 1.2 + (access + egress) / 2,
          });
        }
      }
    }
  const routes: Route[] = [],
    walks = new Map<string, Promise<Route>>();
  const getWalk = (a: Coordinate, b: Coordinate) => {
    const key = `${a.lat},${a.lng}/${b.lat},${b.lng}`;
    let pending = walks.get(key);
    if (!pending) {
      pending = walk(a, b);
      walks.set(key, pending);
    }
    return pending;
  };
  for (const line of ["00001", "00006"]) {
    const ranked = options
      .filter((o) => o.trip.route === line)
      .sort((a, b) => a.score - b.score);
    const best = ranked[0];
    if (!best) continue;
    try {
      const from = best.trip.calls[best.i].stop,
        to = best.trip.calls[best.j].stop;
      const first = await getWalk(t.origin, from.coordinate);
      if (!validWalk(first)) continue;
      const feasible = ranked
        .filter(
          (o) =>
            o.trip.calls[o.i].stop.id === from.id &&
            o.trip.calls[o.j].stop.id === to.id &&
            o.departure >=
              start +
                first.legs.reduce((n, l) => n + l.durationSeconds, 0) * 1000 +
                60000,
        )
        .sort((a, b) => a.arrival - b.arrival)[0];
      if (!feasible) continue;
      const last = await getWalk(to.coordinate, destination);
      if (!validWalk(last)) continue;
      const { trip, i, j, base, departure, arrival } = feasible;
      const calls = trip.calls;
      const stop = (c: Call): RouteStop => ({
        name: c.stop.name,
        coordinate: c.stop.coordinate,
        arrivalTime: new Date(base + c.arrival * 1000).toISOString(),
        departureTime: new Date(base + c.departure * 1000).toISOString(),
        scheduledArrivalTime: new Date(base + c.arrival * 1000).toISOString(),
        scheduledDepartureTime: new Date(
          base + c.departure * 1000,
        ).toISOString(),
      });
      const shape = trip.shape.slice(
        calls[i].shapeIndex,
        calls[j].shapeIndex + 1,
      );
      if (shape.length < 2) continue;
      const firstLegs = stampWalk(first, start, undefined, from.name),
        walkEnd =
          start + first.legs.reduce((n, l) => n + l.durationSeconds, 0) * 1000;
      const ride: RouteLeg = {
        mode: "RIDE",
        transitMode: "BUS",
        geometry: shape,
        steps: [],
        distanceMeters: length(shape),
        durationSeconds: (arrival - departure) / 1000,
        startTime: new Date(departure).toISOString(),
        endTime: new Date(arrival).toISOString(),
        line: trip.name,
        headsign: calls[i].headsign || trip.headsign,
        agency: feed.agency,
        from: from.name,
        to: to.name,
        fromStop: stop(calls[i]),
        toStop: stop(calls[j]),
        intermediateStops: calls.slice(i + 1, j).map(stop),
        realtime: false,
      };
      const legs: RouteLeg[] = [
        ...firstLegs,
        {
          mode: "WAIT",
          transitMode: "BUS",
          geometry: [from.coordinate],
          steps: [],
          distanceMeters: 0,
          durationSeconds: (departure - walkEnd) / 1000,
          startTime: new Date(walkEnd).toISOString(),
          endTime: new Date(departure).toISOString(),
          from: from.name,
          to: from.name,
          line: trip.name,
          headsign: ride.headsign,
          fromStop: ride.fromStop,
          toStop: ride.fromStop,
          realtime: false,
        },
        ride,
        ...stampWalk(last, arrival, to.name, t.destination.label),
      ];
      routes.push({
        id: `chiibus-${trip.id}-${dateKey(base)}-${i}-${j}`,
        provider: "CHIIBUS_GTFS",
        basemapProvider: "GOOGLE_TILES",
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120000).toISOString(),
        legs,
        distanceMeters: legs.reduce((n, l) => n + l.distanceMeters, 0),
        durationSeconds: legs.reduce((n, l) => n + l.durationSeconds, 0),
        warnings: [],
        attribution: [
          ...new Set([feed.agency, ...first.attribution, ...last.attribution]),
        ],
      });
    } catch {
      /* A missing verified walking connection omits this candidate. */
    }
  }
  return routes.sort((a, b) => a.durationSeconds - b.durationSeconds);
}
