import { describe, it, expect } from "vitest";
import { parseGpx } from "./gpx.js";

const SAMPLE = `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lat="-22.9711" lon="-43.1822"><ele>5</ele><time>2026-01-10T10:00:00Z</time></trkpt>
  <trkpt lat="-22.9720" lon="-43.1830"><ele>7</ele><time>2026-01-10T10:00:30Z</time></trkpt>
  <trkpt lat="-22.9731" lon="-43.1840"/>
</trkseg></trk></gpx>`;

describe("parseGpx", () => {
  it("extrai lat/lng/ele/tempo dos trackpoints", () => {
    const pts = parseGpx(SAMPLE);
    expect(pts).toHaveLength(3);
    expect(pts[0].lat).toBeCloseTo(-22.9711);
    expect(pts[0].lng).toBeCloseTo(-43.1822);
    expect(pts[0].ele).toBe(5);
    // tempo relativo em segundos (o primeiro vira 0)
    expect(pts[1].t! - pts[0].t!).toBe(30);
  });

  it("ignora XML sem trackpoints", () => {
    expect(parseGpx("<gpx></gpx>")).toHaveLength(0);
  });
});
