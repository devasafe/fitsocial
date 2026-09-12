import React, { useMemo, useState } from "react";
import { View, StyleSheet, type GestureResponderEvent } from "react-native";
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { colors, radius } from "../theme";

export interface ChartPoint {
  date: string;
  value: number;
  /** Neste treino a pessoa bateu o próprio recorde. */
  ehPR?: boolean;
}

/**
 * Gráfico de linha de série única, com eixo X no TEMPO.
 *
 * O eixo era por índice: dois treinos separados por três meses ficavam à mesma
 * distância de dois separados por um dia, e a linha contava uma história que
 * não aconteceu — uma pausa de férias parecia progresso contínuo. Agora a
 * distância entre dois pontos é o tempo entre eles.
 *
 * Segue as specs de dataviz do projeto: linha fina, pontos com anel na cor do
 * fundo, grade e eixos discretos, rótulo direto só no último ponto — nunca em
 * todos.
 */
export function LineChart({
  points,
  width,
  height = 200,
  formatValue = (v: number) => String(Math.round(v)),
  menorEhMelhor = false,
}: {
  points: ChartPoint[];
  width: number;
  height?: number;
  formatValue?: (v: number) => string;
  /** Ritmo e tempo melhoram para baixo; o eixo se inverte para a linha subir. */
  menorEhMelhor?: boolean;
}) {
  const [tocado, setTocado] = useState<number | null>(null);

  const padL = 34;
  const padR = 30;
  const padT = 18;
  const padB = 26;
  const plotW = Math.max(width - padL - padR, 10);
  const plotH = height - padT - padB;

  const g = useMemo(() => {
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1; // evita divisão por zero se todos iguais

    const tempos = points.map((p) => new Date(p.date).getTime());
    const t0 = Math.min(...tempos);
    const t1 = Math.max(...tempos);
    const janela = t1 - t0;

    // Sem janela (um ponto só, ou todos no mesmo instante) o tempo não separa
    // nada: aí vale a ordem, que é o melhor que dá para dizer.
    const x = (i: number) => {
      if (points.length === 1) return padL + plotW / 2;
      if (janela === 0) return padL + (i / (points.length - 1)) * plotW;
      return padL + ((tempos[i] - t0) / janela) * plotW;
    };
    const y = (v: number) => {
      const frac = (v - min) / span;
      return padT + (menorEhMelhor ? frac : 1 - frac) * plotH;
    };

    // O que fica em cima e o que fica embaixo saem da MESMA conta, em vez de
    // uma linha para a coordenada e outra para o texto. Era assim que o eixo
    // invertido do pace desenhava a linha subindo e escrevia, na borda de cima,
    // o tempo mais LENTO — o gráfico afirmava o contrário do que mostrava.
    const valorDoTopo = menorEhMelhor ? min : max;
    const valorDaBase = menorEhMelhor ? max : min;

    return {
      valorDoTopo,
      valorDaBase,
      coords: points.map((p, i) => ({ px: x(i), py: y(p.value), v: p.value, ehPR: !!p.ehPR, date: p.date })),
      yTopo: y(valorDoTopo),
      yBase: y(valorDaBase),
    };
  }, [points, plotW, plotH, menorEhMelhor]);

  if (points.length === 0) return null;

  const polyline = g.coords.map((c) => `${c.px},${c.py}`).join(" ");
  const last = g.coords[g.coords.length - 1];
  const sel = tocado != null ? g.coords[tocado] : null;

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  };

  /** O ponto mais próximo do dedo, no eixo X. */
  function selecionar(e: GestureResponderEvent) {
    const alvo = e.nativeEvent.locationX;
    let melhor = 0;
    let dist = Infinity;
    g.coords.forEach((c, i) => {
      const d = Math.abs(c.px - alvo);
      if (d < dist) {
        dist = d;
        melhor = i;
      }
    });
    setTocado(melhor);
  }

  const rotulo = sel ? `${formatValue(sel.v)} · ${fmtDate(sel.date)}` : "";
  const larguraRotulo = Math.max(rotulo.length * 8 + 16, 70);
  const xRotulo = sel ? Math.min(Math.max(sel.px - larguraRotulo / 2, 2), width - larguraRotulo - 2) : 0;

  return (
    <View
      // A largura precisa ser a do SVG, não a do pai.
      //
      // `locationX` é medido a partir da View que pegou o gesto. Sem largura,
      // ela esticava pela tela inteira no navegador (onde o SVG fica travado em
      // 460px e centralizado), e todo toque chegava com um deslocamento de
      // centenas de pixels — o gráfico respondia sempre com o último ponto.
      style={[styles.wrap, { width, alignSelf: "center" }]}
      onStartShouldSetResponder={() => true}
      onResponderGrant={selecionar}
      onResponderMove={selecionar}
      onResponderRelease={() => setTocado(null)}
      onResponderTerminate={() => setTocado(null)}
    >
      <Svg width={width} height={height}>
        {/* Grade discreta: linhas de máximo e mínimo */}
        <Line x1={padL} y1={g.yTopo} x2={padL + plotW} y2={g.yTopo} stroke={colors.border} strokeWidth={1} />
        <Line x1={padL} y1={g.yBase} x2={padL + plotW} y2={g.yBase} stroke={colors.border} strokeWidth={1} />

        {/* Rótulos do eixo Y — cada um com o valor que está de fato ali */}
        <SvgText x={padL - 6} y={g.yTopo + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">
          {formatValue(g.valorDoTopo)}
        </SvgText>
        <SvgText x={padL - 6} y={g.yBase + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">
          {formatValue(g.valorDaBase)}
        </SvgText>

        {/* Cursor do ponto tocado, atrás da linha */}
        {sel && (
          <Line x1={sel.px} y1={padT} x2={sel.px} y2={padT + plotH} stroke={colors.lineStrong} strokeWidth={1} />
        )}

        {/* A linha */}
        {points.length > 1 && (
          <Polyline
            points={polyline}
            fill="none"
            stroke={colors.primary}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Pontos. O recorde ganha um anel maior — é a conquista da série. */}
        {g.coords.map((c, i) => (
          <G key={i}>
            {c.ehPR && (
              <Circle cx={c.px} cy={c.py} r={9} fill="none" stroke={colors.limeBright} strokeWidth={2} />
            )}
            <Circle
              cx={c.px}
              cy={c.py}
              r={c.ehPR ? 5 : 4}
              fill={c.ehPR ? colors.limeBright : colors.primary}
              stroke={colors.bg}
              strokeWidth={2}
            />
          </G>
        ))}

        {/* Rótulo direto só no último valor — some enquanto o dedo está na tela.
            Cabe à direita ou vira para a esquerda, medindo o texto de verdade:
            a comparação com `padR` dava sempre falso (o último ponto fica
            exatamente em `width - padR`) e o número saía cortado no viewport. */}
        {!sel &&
          (() => {
            const texto = formatValue(last.v);
            const larguraTexto = texto.length * 6.5;
            const cabeAaDireita = last.px + 6 + larguraTexto <= width - 2;
            return (
              <SvgText
                x={cabeAaDireita ? last.px + 6 : last.px - 6}
                y={last.py + 4}
                fontSize={11}
                fontWeight="bold"
                fill={colors.primary}
                textAnchor={cabeAaDireita ? "start" : "end"}
              >
                {texto}
              </SvgText>
            );
          })()}

        {/* Eixo X: primeira e última data */}
        <SvgText x={padL} y={height - 8} fontSize={10} fill={colors.textMuted} textAnchor="start">
          {fmtDate(points[0].date)}
        </SvgText>
        {points.length > 1 && (
          <SvgText x={padL + plotW} y={height - 8} fontSize={10} fill={colors.textMuted} textAnchor="end">
            {fmtDate(points[points.length - 1].date)}
          </SvgText>
        )}

        {/* Valor e data do ponto tocado */}
        {sel && (
          <G>
            <Rect
              x={xRotulo}
              y={2}
              width={larguraRotulo}
              height={24}
              rx={radius.chip}
              fill={colors.surface3}
              stroke={colors.lineStrong}
              strokeWidth={1}
            />
            <SvgText
              x={xRotulo + larguraRotulo / 2}
              y={18}
              fontSize={12}
              fill={colors.text}
              textAnchor="middle"
            >
              {rotulo}
            </SvgText>
          </G>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
});
