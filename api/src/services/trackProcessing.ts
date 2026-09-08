// Processamento de track de GPS (Fase 3a). A "regra que separa app bom de ruim"
// (docs/ESPORTES.md §5.3): o melhor 5 km é o trecho de 5 km mais rápido dentro de
// qualquer percurso — janela deslizante sobre os pontos, não o tempo total.

export interface TrackPoint {
  lat: number;
  lng: number;
  t?: number; // segundos (epoch ou relativo)
  ele?: number; // metros
}

export interface Split {
  km: number;
  timeSec: number;
}

export interface Effort {
  distanceM: number;
  timeSec: number;
}

export interface TrackSummary {
  distanceM: number;
  elapsedTimeSec: number;
  elevationGainM: number;
  splits: Split[];
  polyline: string;
  bestEfforts: Effort[];
}

const R = 6_371_000; // raio da Terra em metros

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function cumulative(points: TrackPoint[]): { dist: number[]; time: number[] } {
  const dist = [0];
  const t0 = points[0]?.t ?? 0;
  const time = [0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    dist.push(dist[i - 1] + haversineM(prev.lat, prev.lng, p.lat, p.lng));
    time.push((p.t ?? t0) - t0);
  }
  return { dist, time };
}

/** Menor tempo de um trecho que cobre `targetM` metros. null se o percurso é menor. */
export function bestEffort(points: TrackPoint[], targetM: number): Effort | null {
  if (points.length < 2) return null;
  const { dist, time } = cumulative(points);
  if (dist[dist.length - 1] < targetM) return null;

  let best = Infinity;
  let i = 0;
  for (let j = 0; j < points.length; j++) {
    while (i < j && dist[j] - dist[i] >= targetM) {
      best = Math.min(best, time[j] - time[i]);
      i++;
    }
  }
  return best === Infinity ? null : { distanceM: targetM, timeSec: Math.round(best) };
}

const EFFORT_TARGETS = [1000, 5000, 10000, 21100, 42200];

function timeAtDistance(dist: number[], time: number[], target: number): number {
  for (let i = 1; i < dist.length; i++) {
    if (dist[i] >= target) {
      const span = dist[i] - dist[i - 1] || 1;
      const frac = (target - dist[i - 1]) / span;
      return time[i - 1] + (time[i] - time[i - 1]) * frac;
    }
  }
  return time[time.length - 1];
}

export function processTrack(points: TrackPoint[]): TrackSummary {
  if (points.length < 2) {
    return { distanceM: 0, elapsedTimeSec: 0, elevationGainM: 0, splits: [], polyline: "", bestEfforts: [] };
  }

  const { dist, time } = cumulative(points);
  const distanceM = dist[dist.length - 1];
  const elapsedTimeSec = time[time.length - 1];

  let elevationGainM = 0;
  for (let i = 1; i < points.length; i++) {
    const d = (points[i].ele ?? 0) - (points[i - 1].ele ?? 0);
    if (d > 0) elevationGainM += d;
  }

  const splits: Split[] = [];
  const fullKm = Math.floor(distanceM / 1000);
  for (let km = 1; km <= fullKm; km++) {
    const tEnd = timeAtDistance(dist, time, km * 1000);
    const tStart = timeAtDistance(dist, time, (km - 1) * 1000);
    splits.push({ km, timeSec: Math.round(tEnd - tStart) });
  }

  const bestEfforts: Effort[] = [];
  for (const target of EFFORT_TARGETS) {
    if (target > distanceM) break;
    const e = bestEffort(points, target);
    if (e) bestEfforts.push(e);
  }

  return {
    distanceM: Math.round(distanceM),
    elapsedTimeSec: Math.round(elapsedTimeSec),
    elevationGainM: Math.round(elevationGainM),
    splits,
    polyline: encodePolyline(points),
    bestEfforts,
  };
}

// ---- Polyline (algoritmo padrão do Google) ----

function encodeSigned(num: number): string {
  let n = num < 0 ? ~(num << 1) : num << 1;
  let out = "";
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  out += String.fromCharCode(n + 63);
  return out;
}

export function encodePolyline(points: TrackPoint[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += encodeSigned(lat - lastLat) + encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}
