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

  // A margem sai do rótulo mais longo, e não de um número fixo.
  //
  // Antes eram 34px reservados e um raio de rótulo multiplicativo (1,19×), que
  // comia a própria margem: num radar de 288px sobravam 13px para um texto de
  // até 53px, e "Posterior" virava "Poste", "Tríceps" virava "ceps". Com 12
  // grupos sempre desenhados, isso acontecia em todos os casos, não num canto.
  const maiorRotulo = Math.max(...eixos.map((e) => e.rotulo.length));
  const margem = Math.min(maiorRotulo * 5.4 + 12, size / 3);
  const raio = Math.max(size / 2 - margem, 40);
  const maior = Math.max(...eixos.map((e) => e.valor), 1);

  const angulo = (i: number) => (Math.PI * 2 * i) / eixos.length - Math.PI / 2;

  const ponto = (i: number, fracao: number) => {
    // Começa no topo e anda no sentido horário.
    const ang = angulo(i);
    return {
      x: cx + Math.cos(ang) * raio * fracao,
      y: cy + Math.sin(ang) * raio * fracao,
    };
  };

  /** O rótulo fica a uma distância FIXA da teia, não a uma fração dela. */
  const ondeFicaORotulo = (i: number) => {
    const ang = angulo(i);
    return { x: cx + Math.cos(ang) * (raio + 12), y: cy + Math.sin(ang) * (raio + 12) };
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
          const p = ondeFicaORotulo(i);
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
