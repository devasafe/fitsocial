import React, { useMemo, useState } from "react";
import { View, StyleSheet, type GestureResponderEvent } from "react-native";
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { colors, radius } from "../theme";

export interface ChartPoint {
  date: string;
  /** `null` = não houve medida nesse dia. A linha QUEBRA aqui, não interpola:
   *  ligar os dois lados por cima do buraco é afirmar um dia que não existiu. */
  value: number | null;
  /** Neste treino a pessoa bateu o próprio recorde. */
  ehPR?: boolean;
}

/**
 * Gráfico de linha, com eixo X no TEMPO — série principal e, opcionalmente,
 * uma série de REFERÊNCIA (ex.: a meta do dia) desenhada por baixo dela.
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
  secondary,
  secondaryLabel = "referência",
  width,
  height = 200,
  formatValue = (v: number) => String(Math.round(v)),
  menorEhMelhor = false,
}: {
  points: ChartPoint[];
  /**
   * Segunda série, de REFERÊNCIA — não protagonista. Desenhada tracejada, numa
   * cor neutra, sem pontos e sem rótulo de último valor: quem manda no gráfico
   * é `points`. Precisa ter o mesmo tamanho e as mesmas datas de `points`
   * (ponto a ponto) — é o eixo X de `points` que decide onde cada `secondary[i]`
   * cai. `null` quebra a linha aqui do mesmo jeito que em `points`: um dia sem
   * meta não pode virar uma reta inventada.
   */
  secondary?: ChartPoint[];
  /** Rótulo curto da série secundária no toque (ex.: "meta"). Só é lido quando `secondary` existe. */
  secondaryLabel?: string;
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
    const values = points.map((p) => p.value).filter((v): v is number => v != null);
    // Todos nulos: não há escala possível, e quem trata o vazio é a tela.
    if (values.length === 0) return null;
    // A referência entra na MESMA escala — senão uma meta de 2000 kcal fica
    // fora da faixa vertical de um consumo que nunca passou de 1500, e a linha
    // tracejada desenharia colada no teto (ou some) em vez de mostrar a
    // distância real até ela.
    const valoresSecundarios = (secondary ?? [])
      .map((p) => p.value)
      .filter((v): v is number => v != null);
    const min = Math.min(...values, ...valoresSecundarios);
    const max = Math.max(...values, ...valoresSecundarios);
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
    const y = (v: number | null) => {
      if (v == null) return null;
      // Sem faixa (uma medida só, ou todas iguais) o valor vai para o MEIO.
      //
      // O `span || 1` acima evita a divisão por zero, mas a conta que sobra dá
      // `frac = 0` — e o ponto era desenhado colado na base do plot. No
      // primeiro dia de uso, a única medida da pessoa aparecia rente ao chão e
      // o olho lia "baixo", enquanto o rótulo ao lado dizia o número certo: o
      // desenho contradizia a legenda. Vale para o `HistoryScreen` também, onde
      // dois treinos com a mesma carga viravam uma reta no fundo.
      //
      // Com min !== max nada muda: esta guarda nem é tocada.
      if (max === min) return padT + plotH / 2;
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
      // O `x(i)` usa o ÍNDICE e o TEMPO de `points` — é por isso que `secondary`
      // precisa ter o mesmo tamanho e as mesmas datas: aqui não se relê a data
      // de `secondary`, só se reaproveita a posição já calculada para `points`.
      coordsSecundaria: (secondary ?? []).map((p, i) => ({ px: x(i), py: y(p.value), v: p.value })),
      // valorDoTopo/valorDaBase vêm de min/max dos valores não nulos: nunca são
      // nulos, mas a assinatura de `y` é (number | null) => number | null.
      yTopo: y(valorDoTopo) as number,
      yBase: y(valorDaBase) as number,
    };
  }, [points, secondary, plotW, plotH, menorEhMelhor]);

  if (points.length === 0 || g === null) return null;

  // A linha quebra onde não houve medida. Um trecho de um ponto só não desenha
  // segmento nenhum — e está certo: o círculo daquele dia continua aparecendo,
  // então um dia solto entre dois buracos aparece como ponto, não some.
  // Mesma regra para a série secundária — inclusive quando ela é a única
  // ausente: um dia com consumo registrado mas sem meta não pode herdar a
  // meta do dia vizinho.
  const emSegmentos = (coords: { px: number; py: number | null }[]): string[] => {
    const segs: string[] = [];
    let atual: string[] = [];
    for (const c of coords) {
      if (c.py == null) {
        if (atual.length) segs.push(atual.join(" "));
        atual = [];
      } else {
        atual.push(`${c.px},${c.py}`);
      }
    }
    if (atual.length) segs.push(atual.join(" "));
    return segs;
  };

  const segmentos = emSegmentos(g.coords);
  const segmentosSecundaria = emSegmentos(g.coordsSecundaria);

  const last = [...g.coords].reverse().find((c) => c.py != null) ?? null;
  const sel = tocado != null ? g.coords[tocado] : null;
  const selSecundaria = tocado != null ? (g.coordsSecundaria[tocado] ?? null) : null;

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  };

  /** O ponto mais próximo do dedo, no eixo X.
   *  Arrow function (não `function`) para que o TS preserve, dentro do
   *  closure, o estreitamento de `g` feito no `return null` acima. */
  const selecionar = (e: GestureResponderEvent) => {
    const alvo = e.nativeEvent.locationX;
    let melhor = 0;
    let dist = Infinity;
    g.coords.forEach((c, i) => {
      if (c.py == null) return;
      const d = Math.abs(c.px - alvo);
      if (d < dist) {
        dist = d;
        melhor = i;
      }
    });
    setTocado(melhor);
  };

  // A referência entra no MESMO rótulo do toque, e não num balão à parte: é
  // ali, comparando lado a lado, que "1800 kcal" deixa de ser só um número e
  // vira "1800 kcal, contra uma meta de 2000" — sem isso o toque conta só
  // metade da história que o próprio gráfico já desenha.
  const rotulo =
    sel && sel.v != null
      ? `${formatValue(sel.v)}${
          selSecundaria && selSecundaria.v != null ? ` · ${secondaryLabel} ${formatValue(selSecundaria.v)}` : ""
        } · ${fmtDate(sel.date)}`
      : "";
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

        {/* A referência, atrás da linha principal e sem pontos — ela é o pano
            de fundo, não a informação que este gráfico existe para contar.
            Tracejada e numa cor neutra (não a cor da marca) para que a régua
            visual do gráfico continue sendo o que a pessoa fez, e não o que
            era pedido dela. Mesma quebra por segmento que a série principal:
            um dia sem meta não vira uma reta inventada. */}
        {segmentosSecundaria.map((pts, i) => (
          <Polyline
            key={`sec-${i}`}
            points={pts}
            fill="none"
            stroke={colors.textMuted}
            strokeWidth={1.5}
            strokeDasharray="4,4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* A linha, quebrada em um trecho por intervalo contínuo de medidas —
            <Polyline> não tem como ter buraco no meio. */}
        {segmentos.map((pts, i) => (
          <Polyline
            key={i}
            points={pts}
            fill="none"
            stroke={colors.primary}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Pontos. O recorde ganha um anel maior — é a conquista da série.
            Dia sem medida não desenha círculo. */}
        {g.coords
          .filter((c) => c.py != null)
          .map((c, i) => (
            <G key={i}>
              {c.ehPR && (
                <Circle cx={c.px} cy={c.py as number} r={9} fill="none" stroke={colors.limeBright} strokeWidth={2} />
              )}
              <Circle
                cx={c.px}
                cy={c.py as number}
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
            exatamente em `width - padR`) e o número saía cortado no viewport.
            Usa o último ponto NÃO NULO: se o último dia da janela ficou sem
            medida, o rótulo não pode nascer num buraco. */}
        {!sel &&
          last &&
          (() => {
            const texto = formatValue(last.v as number);
            const larguraTexto = texto.length * 6.5;
            const cabeAaDireita = last.px + 6 + larguraTexto <= width - 2;
            return (
              <SvgText
                x={cabeAaDireita ? last.px + 6 : last.px - 6}
                y={(last.py as number) + 4}
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
