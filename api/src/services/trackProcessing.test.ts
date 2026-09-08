import { describe, it, expect } from "vitest";
import { haversineM, processTrack, bestEffort, type TrackPoint } from "./trackProcessing.js";

// Track sintético no equador: passos de 0,001° de longitude (~111 m cada),
// 10 s por segmento. 11 pontos => ~1113 m em 100 s.
function synthTrack(): TrackPoint[] {
  const pts: TrackPoint[] = [];
  for (let i = 0; i <= 10; i++) {
    pts.push({ lat: 0, lng: i * 0.001, t: i * 10, ele: 0 });
  }
  return pts;
}

describe("haversineM", () => {
  it("mede ~111 m para 0,001° no equador", () => {
    const d = haversineM(0, 0, 0, 0.001);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(113);
  });
});

describe("processTrack", () => {
  it("calcula distância, tempo, splits e polyline", () => {
    const s = processTrack(synthTrack());
    expect(s.distanceM).toBeGreaterThan(1100);
    expect(s.distanceM).toBeLessThan(1130);
    expect(s.elapsedTimeSec).toBe(100);
    expect(typeof s.polyline).toBe("string");
    expect(s.polyline.length).toBeGreaterThan(0);
    // 1 km completo => 1 split
    expect(s.splits.length).toBeGreaterThanOrEqual(1);
  });

  it("acha o melhor esforço de 1 km por janela deslizante", () => {
    const s = processTrack(synthTrack());
    const oneK = s.bestEfforts.find((b) => b.distanceM === 1000);
    expect(oneK).toBeTruthy();
    // ~9 segmentos de 10 s cobrem 1 km
    expect(oneK!.timeSec).toBeGreaterThanOrEqual(85);
    expect(oneK!.timeSec).toBeLessThanOrEqual(95);
  });
});

describe("bestEffort", () => {
  it("retorna null quando o percurso é menor que o alvo", () => {
    expect(bestEffort(synthTrack(), 5000)).toBeNull();
  });
});
