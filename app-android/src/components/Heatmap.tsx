import React, { useMemo, useRef, useState } from "react";
import { View, StyleSheet, Pressable, ScrollView } from "react-native";
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

/** Tamanho da casinha. Não encolhe para caber: quando não cabe, rola. */
const CELULA = 11;
const GAP = 3;

/**
 * Calendário de constância, no formato de contribuições do GitHub.
 *
 * Uma casinha por dia, em colunas de semana. O que ele conta não é o esforço de
 * um treino — é a regularidade, que é o que some primeiro quando a pessoa está
 * desistindo, e é por isso que os dias vazios são desenhados em vez de pulados.
 *
 * Um ano são 53 colunas, e 53 colunas não cabem num celular. A saída NÃO é
 * encolher a casinha até caber: a 4px ela vira um alvo de toque de um
 * milímetro, e o detalhe do dia deixa de ser alcançável. Aqui a casinha tem
 * tamanho fixo e o calendário rola na horizontal, abrindo no fim — que é onde
 * está hoje, e é o que a pessoa quer ver.
 */
export function Heatmap({ dias, width }: { dias: DiaDoHeatmap[]; width: number }) {
  const [tocado, setTocado] = useState<DiaDoHeatmap | null>(null);
  const scroll = useRef<ScrollView>(null);

  const { semanas, altura, larguraTotal, rotulos } = useMemo(() => {
    // A primeira coluna começa no domingo anterior ao primeiro dia, senão a
    // grade fica torta e o dia da semana deixa de se ler na horizontal.
    const primeiro = dias[0] ? new Date(`${dias[0].dia}T12:00:00`) : new Date();
    const recuo = primeiro.getDay();

    const grade: (DiaDoHeatmap | null)[] = [...Array(recuo).fill(null), ...dias];
    const semanas: (DiaDoHeatmap | null)[][] = [];
    for (let i = 0; i < grade.length; i += 7) semanas.push(grade.slice(i, i + 7));

    // Rótulo de mês na primeira semana em que o mês vira.
    const rotulos: { x: number; texto: string }[] = [];
    let mesAnterior = -1;
    semanas.forEach((semana, i) => {
      const primeiroDia = semana.find((d) => d);
      if (!primeiroDia) return;
      const mes = new Date(`${primeiroDia.dia}T12:00:00`).getMonth();
      if (mes !== mesAnterior) {
        rotulos.push({ x: i * (CELULA + GAP), texto: MESES[mes] });
        mesAnterior = mes;
      }
    });

    return {
      semanas,
      altura: 7 * (CELULA + GAP),
      // O gap não conta depois da última coluna.
      larguraTotal: semanas.length * CELULA + Math.max(semanas.length - 1, 0) * GAP,
      rotulos,
    };
  }, [dias]);

  /** Quatro níveis de intensidade, derivados do verde da marca. */
  function cor(treinos: number): string {
    if (treinos <= 0) return colors.surface2;
    if (treinos === 1) return colors.limeDeep;
    if (treinos === 2) return colors.limeDim;
    return colors.lime;
  }

  const grade = (
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
              x={x * (CELULA + GAP)}
              y={16 + y * (CELULA + GAP)}
              width={CELULA}
              height={CELULA}
              rx={2}
              fill={cor(dia.treinos)}
              onPress={() => setTocado(dia)}
            />
          );
        })
      )}
    </Svg>
  );

  return (
    <View>
      {larguraTotal > width ? (
        <ScrollView
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          // Abre mostrando hoje. `contentOffset` só vale no iOS, e o ano
          // começando em janeiro seria a informação menos útil da tela.
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          {grade}
        </ScrollView>
      ) : (
        grade
      )}

      {/* Altura reservada: sem ela, tocar num dia empurra a lista inteira
          para baixo e a pessoa perde o lugar onde estava. */}
      <View style={styles.detalhe}>
        {tocado && (
          <Pressable onPress={() => setTocado(null)}>
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
    height: 42,
    justifyContent: "center",
  },
});
