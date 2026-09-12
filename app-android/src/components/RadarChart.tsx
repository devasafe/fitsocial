import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Circle, Line, Polygon, Text as SvgText } from "react-native-svg";
import { colors } from "../theme";

export interface EixoDoRadar {
  rotulo: string;
  valor: number;
}

/**
 * Radar de grupos musculares.
 *
 * Mostra onde a pessoa treina e, principalmente, onde ela NÃO treina — o eixo
 * encolhido é a informação, e por isso os grupos zerados continuam desenhados
 * em vez de sumirem da figura.
 *
 * A escala é relativa ao próprio maior valor da janela: é uma comparação da
 * pessoa com ela mesma, nunca com outra pessoa nem com um ideal. Não existe
 * "nota" aqui, e de propósito.
 */
export function RadarChart({
  eixos,
  size,
  cor = colors.lime,
}: {
  eixos: EixoDoRadar[];
  size: number;
  cor?: string;
}) {
  if (eixos.length < 3) return null;

  const cx = size / 2;
  const cy = size / 2;
  // Espaço para o rótulo do lado de fora da teia.
  const raio = size / 2 - 34;
  const maior = Math.max(...eixos.map((e) => e.valor), 1);

  const ponto = (i: number, fracao: number) => {
    // Começa no topo e anda no sentido horário.
    const ang = (Math.PI * 2 * i) / eixos.length - Math.PI / 2;
    return {
      x: cx + Math.cos(ang) * raio * fracao,
      y: cy + Math.sin(ang) * raio * fracao,
    };
  };

  const area = eixos
    .map((e, i) => {
      const p = ponto(i, e.valor / maior);
      return `${p.x},${p.y}`;
    })
    .join(" ");

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        {/* Teia: três anéis, discretos */}
        {[0.33, 0.66, 1].map((f) => (
          <Circle key={f} cx={cx} cy={cy} r={raio * f} fill="none" stroke={colors.line} strokeWidth={1} />
        ))}

        {/* Um raio por grupo */}
        {eixos.map((_, i) => {
          const p = ponto(i, 1);
          return <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={colors.line} strokeWidth={1} />;
        })}

        {/* A área da pessoa */}
        <Polygon points={area} fill={colors.limeSoft} stroke={cor} strokeWidth={2} strokeLinejoin="round" />

        {/* Vértices: só onde houve treino — ponto em cima do zero seria ruído */}
        {eixos.map((e, i) => {
          if (e.valor === 0) return null;
          const p = ponto(i, e.valor / maior);
          return <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill={cor} stroke={colors.bg} strokeWidth={1.5} />;
        })}

        {/* Rótulos, fora da teia */}
        {eixos.map((e, i) => {
          const p = ponto(i, 1.19);
          const ancora = p.x < cx - 4 ? "end" : p.x > cx + 4 ? "start" : "middle";
          return (
            <SvgText
              key={i}
              x={p.x}
              y={p.y + 3}
              fontSize={10}
              // O grupo sem treino fica apagado, mas continua legível: ele é
              // metade do que o radar tem a dizer.
              fill={e.valor === 0 ? colors.text3 : colors.text2}
              textAnchor={ancora}
            >
              {e.rotulo}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
});
