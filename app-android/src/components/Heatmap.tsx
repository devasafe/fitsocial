import React, { useMemo, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";
import { Txt } from "./ui";
import { colors, spacing } from "../theme";

export interface DiaDoHeatmap {
  /** yyyy-mm-dd */
  dia: string;
  treinos: number;
  minutos: number;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Calendário de constância, no formato de contribuições do GitHub.
 *
 * Uma casinha por dia, em colunas de semana. O que ele conta não é o esforço de
 * um treino — é a regularidade, que é o que some primeiro quando a pessoa está
 * desistindo, e é por isso que os dias vazios são desenhados em vez de pulados.
 *
 * Quatro níveis, como no original: nenhum, um, dois, três ou mais. Mais faixas
 * dariam uma escala mais precisa e um desenho menos legível.
 */
export function Heatmap({ dias, width }: { dias: DiaDoHeatmap[]; width: number }) {
  const [tocado, setTocado] = useState<DiaDoHeatmap | null>(null);

  const { semanas, celula, gap, altura, rotulos } = useMemo(() => {
    // A primeira coluna começa no domingo anterior ao primeiro dia, senão a
    // grade fica torta e o dia da semana deixa de se ler na horizontal.
    const primeiro = dias[0] ? new Date(`${dias[0].dia}T12:00:00`) : new Date();
    const recuo = primeiro.getDay();

    const grade: (DiaDoHeatmap | null)[] = [...Array(recuo).fill(null), ...dias];
    const semanas: (DiaDoHeatmap | null)[][] = [];
    for (let i = 0; i < grade.length; i += 7) semanas.push(grade.slice(i, i + 7));

    const gap = 2;
    // A largura manda: com 53 semanas num celular, a casinha fica pequena, e
    // tudo bem — o desenho do ano inteiro é a informação.
    const celula = Math.max(Math.floor((width - (semanas.length - 1) * gap) / semanas.length), 4);

    // Rótulo de mês na primeira semana em que o mês vira.
    const rotulos: { x: number; texto: string }[] = [];
    let mesAnterior = -1;
    semanas.forEach((semana, i) => {
      const primeiroDia = semana.find((d) => d);
      if (!primeiroDia) return;
      const mes = new Date(`${primeiroDia.dia}T12:00:00`).getMonth();
      if (mes !== mesAnterior) {
        rotulos.push({ x: i * (celula + gap), texto: MESES[mes] });
        mesAnterior = mes;
      }
    });

    return { semanas, celula, gap, altura: 7 * (celula + gap), rotulos };
  }, [dias, width]);

  /** Quatro níveis de intensidade, derivados do verde da marca. */
  function cor(treinos: number): string {
    if (treinos <= 0) return colors.surface2;
    if (treinos === 1) return colors.limeDeep;
    if (treinos === 2) return colors.limeDim;
    return colors.lime;
  }

  const larguraTotal = semanas.length * (celula + gap);

  return (
    <View>
      <Svg width={larguraTotal} height={altura + 16}>
        {rotulos.map((r, i) => (
          <SvgText key={i} x={r.x} y={9} fontSize={9} fill={colors.text3}>
            {r.texto}
          </SvgText>
        ))}
        {semanas.map((semana, x) =>
          semana.map((dia, y) => {
            if (!dia) return null;
            return (
              <Rect
                key={`${x}-${y}`}
                x={x * (celula + gap)}
                y={16 + y * (celula + gap)}
                width={celula}
                height={celula}
                rx={1.5}
                fill={cor(dia.treinos)}
                onPress={() => setTocado(dia)}
              />
            );
          })
        )}
      </Svg>

      {tocado && (
        <Pressable onPress={() => setTocado(null)} style={styles.detalhe}>
          <Txt variant="label">{formatarDia(tocado.dia)}</Txt>
          <Txt variant="body" color={colors.text2}>
            {tocado.treinos === 0
              ? "Sem treino"
              : `${tocado.treinos} ${tocado.treinos === 1 ? "treino" : "treinos"}` +
                (tocado.minutos > 0 ? ` · ${tocado.minutos} min` : "")}
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

function formatarDia(dia: string): string {
  const d = new Date(`${dia}T12:00:00`);
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}

const styles = StyleSheet.create({
  detalhe: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
