// Seus benchmarks, com a evolução entre a última vez e a anterior.
//
// É o que transforma registro em histórico: repetir Fran em dois meses e ver
// "−34s" é a razão de anotar o treino em vez de só treinar.

import React, { useCallback, useState } from "react";
import { View, StyleSheet, FlatList } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { listarBenchmarks, type BenchmarkFeito } from "../api/crossfit";
import { Txt, Card, ErrorState } from "../components/ui";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { mmss, rotuloDaEscala } from "../lib/crossfitResumo";
import { colors, spacing } from "../theme";

/** Um score de tempo mostra mm:ss; os outros, o número cru. */
function valorEmTexto(valor: number, tipo: string | null): string {
  return tipo === "tempo" ? mmss(valor) : String(Math.round(valor));
}

/** O delta já vem orientado: positivo é melhora, em qualquer tipo de score. */
function deltaEmTexto(delta: number, tipo: string | null): string {
  const sinal = delta > 0 ? "−" : "+"; // tempo que cai é ganho
  const bruto = Math.abs(delta);
  if (tipo === "tempo") return `${sinal}${mmss(bruto)}`;
  return `${delta > 0 ? "+" : "−"}${Math.round(bruto)}`;
}

function quando(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function BenchmarksScreen() {
  const { token } = useAuth();
  const [itens, setItens] = useState<BenchmarkFeito[] | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const { data } = await listarBenchmarks(token!);
      setItens(data);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void carregar();
    }, [carregar])
  );

  if (erro && !itens) {
    return (
      <View style={styles.container}>
        <ErrorState message="Não foi possível carregar seus benchmarks." onRetry={() => void carregar()} />
      </View>
    );
  }

  if (!itens) {
    return (
      <View style={[styles.container, { gap: spacing.sm, padding: spacing.gutter }]}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={92} radius={14} />
        ))}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={itens}
      keyExtractor={(b) => `${b.slug}:${b.escala}`}
      contentContainerStyle={styles.lista}
      ListEmptyComponent={
        <EmptyState
          icon="🏆"
          title="Nenhum benchmark ainda"
          description="Registre um WOD conhecido — Fran, Cindy, Murph — e a evolução aparece aqui a cada vez que você repetir."
        />
      }
      renderItem={({ item }) => {
        const melhorou = item.delta != null && item.delta > 0;
        return (
          <Card level={2} style={styles.card}>
            <View style={styles.topo}>
              <Txt variant="titleCard">{item.nome}</Txt>
              <Txt variant="label" color={colors.text3}>
                {rotuloDaEscala(item.escala)}
              </Txt>
            </View>

            <View style={styles.numeros}>
              <View>
                <Txt variant="metricMd" tabular color={colors.lime}>
                  {item.ultimo ? valorEmTexto(item.ultimo.valor, item.scoreTipo) : "—"}
                </Txt>
                <Txt variant="caption" color={colors.text3}>
                  {item.ultimo ? quando(item.ultimo.quando) : "última"}
                </Txt>
              </View>

              {item.delta != null ? (
                <View>
                  <Txt variant="metricMd" tabular color={melhorou ? colors.lime : colors.text2}>
                    {deltaEmTexto(item.delta, item.scoreTipo)}
                  </Txt>
                  <Txt variant="caption" color={colors.text3}>
                    {melhorou ? "🔥 melhorou" : "vs. anterior"}
                  </Txt>
                </View>
              ) : null}

              <View>
                <Txt variant="metricMd" tabular>
                  {item.vezes}
                </Txt>
                <Txt variant="caption" color={colors.text3}>
                  {item.vezes === 1 ? "vez" : "vezes"}
                </Txt>
              </View>
            </View>

            {item.melhor && item.vezes > 1 ? (
              <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.sm }}>
                Melhor marca: {valorEmTexto(item.melhor.valor, item.scoreTipo)} ·{" "}
                {quando(item.melhor.quando)}
              </Txt>
            ) : null}
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  lista: { padding: spacing.gutter, gap: spacing.sm },
  card: { marginBottom: spacing.xs },
  topo: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  numeros: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.sm },
});
