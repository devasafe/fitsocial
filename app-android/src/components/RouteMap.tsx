import React from "react";
import { View } from "react-native";
import Svg, { Polyline, Circle } from "react-native-svg";
import { Txt } from "./ui";
import { colors, radius, sportColor } from "../theme";
import type { GeoPoint } from "../lib/geo";

// Traçado do percurso em SVG (roda em web e native, sem mapa nativo). O mapa de
// verdade com tiles é um enhancement nativo posterior.
export function RouteMap({
  points,
  sportId,
  height = 200,
}: {
  points: GeoPoint[];
  sportId?: string;
  height?: number;
}) {
  const stroke = sportColor(sportId);

  if (points.length < 2) {
    return (
      <View
        style={{
          height,
          borderRadius: radius.card,
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: colors.line,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Txt variant="label" color={colors.text3}>
          Aguardando sinal de GPS…
        </Txt>
      </View>
    );
  }

  const W = 320;
  const H = height;
  const pad = 16;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1e-6;
  const spanLng = maxLng - minLng || 1e-6;
  // Mantém proporção usando o maior span para não distorcer.
  const span = Math.max(spanLat, spanLng);

  const project = (p: GeoPoint) => {
    const x = pad + ((p.lng - minLng) / span) * (W - 2 * pad);
    const y = pad + (1 - (p.lat - minLat) / span) * (H - 2 * pad); // lat maior = topo
    return { x, y };
  };

  const coords = points.map((p) => {
    const { x, y } = project(p);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const start = project(points[0]);
  const end = project(points[points.length - 1]);

  return (
    <View style={{ borderRadius: radius.card, overflow: "hidden", backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line }}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <Polyline points={coords.join(" ")} fill="none" stroke={stroke} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={start.x} cy={start.y} r={5} fill={colors.text} />
        <Circle cx={end.x} cy={end.y} r={5} fill={stroke} />
      </Svg>
    </View>
  );
}
