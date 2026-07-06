import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Polyline, Circle, Line, Text as SvgText } from "react-native-svg";
import { colors } from "../theme";

export interface ChartPoint {
  date: string;
  value: number;
}

/**
 * Gráfico de linha de série única (evolução de carga ao longo dos treinos).
 * Segue as specs de dataviz: linha fina, pontos com anel na cor do fundo,
 * grade/eixos discretos, rótulo direto só no último ponto (não em todos).
 */
export function LineChart({
  points,
  width,
  height = 200,
  formatValue = (v: number) => String(Math.round(v)),
}: {
  points: ChartPoint[];
  width: number;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const padL = 34;
  const padR = 30;
  const padT = 18;
  const padB = 26;
  const plotW = Math.max(width - padL - padR, 10);
  const plotH = height - padT - padB;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // evita divisão por zero se todos iguais
  const n = points.length;

  const x = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const y = (v: number) => padT + (1 - (v - min) / span) * plotH;

  const coords = points.map((p, i) => ({ px: x(i), py: y(p.value), v: p.value }));
  const polyline = coords.map((c) => `${c.px},${c.py}`).join(" ");

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  };

  const last = coords[coords.length - 1];

  return (
    <View style={styles.wrap}>
      <Svg width={width} height={height}>
        {/* Grade discreta: linhas de máximo e mínimo */}
        <Line x1={padL} y1={y(max)} x2={padL + plotW} y2={y(max)} stroke={colors.border} strokeWidth={1} />
        <Line x1={padL} y1={y(min)} x2={padL + plotW} y2={y(min)} stroke={colors.border} strokeWidth={1} />

        {/* Rótulos do eixo Y (máx/mín) */}
        <SvgText x={padL - 6} y={y(max) + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">
          {formatValue(max)}
        </SvgText>
        <SvgText x={padL - 6} y={y(min) + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">
          {formatValue(min)}
        </SvgText>

        {/* A linha (2px) */}
        {n > 1 && (
          <Polyline points={polyline} fill="none" stroke={colors.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Pontos: anel na cor do fundo + preenchimento na cor da marca */}
        {coords.map((c, i) => (
          <Circle key={i} cx={c.px} cy={c.py} r={4} fill={colors.primary} stroke={colors.bg} strokeWidth={2} />
        ))}

        {/* Rótulo direto só no último valor */}
        <SvgText x={Math.min(last.px + 6, width - 2)} y={last.py + 4} fontSize={11} fontWeight="bold" fill={colors.primary} textAnchor={last.px + 30 > width ? "end" : "start"}>
          {formatValue(last.v)}
        </SvgText>

        {/* Eixo X: primeira e última data */}
        <SvgText x={padL} y={height - 8} fontSize={10} fill={colors.textMuted} textAnchor="start">
          {fmtDate(points[0].date)}
        </SvgText>
        {n > 1 && (
          <SvgText x={padL + plotW} y={height - 8} fontSize={10} fill={colors.textMuted} textAnchor="end">
            {fmtDate(points[n - 1].date)}
          </SvgText>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
});
