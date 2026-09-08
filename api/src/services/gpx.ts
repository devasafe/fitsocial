import type { TrackPoint } from "./trackProcessing.js";

// Parser mínimo de GPX (trackpoints). Fase 3a: entrada de track testável sem GPS
// nativo — o usuário sobe um .gpx exportado de outro app/relógio.

const TRKPT = /<trkpt\b([^>]*?)\s*\/>|<trkpt\b([^>]*?)>([\s\S]*?)<\/trkpt>/g;

export function parseGpx(xml: string): TrackPoint[] {
  const raw: { lat: number; lng: number; ele?: number; epoch?: number }[] = [];
  let m: RegExpExecArray | null;
  TRKPT.lastIndex = 0;
  while ((m = TRKPT.exec(xml))) {
    const attrs = m[1] ?? m[2] ?? "";
    const inner = m[3] ?? "";
    const lat = Number(/lat="([-\d.]+)"/.exec(attrs)?.[1]);
    const lng = Number(/lon="([-\d.]+)"/.exec(attrs)?.[1]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const ele = /<ele>([-\d.]+)<\/ele>/.exec(inner)?.[1];
    const time = /<time>([^<]+)<\/time>/.exec(inner)?.[1];
    raw.push({
      lat,
      lng,
      ele: ele != null ? Number(ele) : undefined,
      epoch: time ? Date.parse(time) / 1000 : undefined,
    });
  }

  const t0 = raw.find((r) => r.epoch != null)?.epoch;
  return raw.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    ele: r.ele,
    t: r.epoch != null && t0 != null ? Math.round(r.epoch - t0) : undefined,
  }));
}
