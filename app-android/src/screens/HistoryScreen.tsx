import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, useWindowDimensions } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { getCardioProgress, type CardioProgress } from "../api/checkins";
import {
  JANELAS,
  METRICAS,
  listarExercicios,
  listarGrupos,
  rotuloDaJanela,
  rotuloDaMetrica,
  serieDoExercicio,
  type ExercicioNaLista,
  type GrupoTreinado,
  type Janela,
  type Metrica,
  type PontoDoExercicio,
} from "../api/evolucao";
import { LineChart } from "../components/LineChart";
import { RadarChart } from "../components/RadarChart";
import { Txt, Card, Chip, SectionHeader, ErrorState } from "../components/ui";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import { abreviarMusculo } from "../lib/musculos";
import { colors, spacing } from "../theme";

const METRICS = [
  { key: "pace" as const, label: "Pace" },
  { key: "distance" as const, label: "Distância" },
  { key: "duration" as const, label: "Duração" },
];

function metricValue(
  p: { durationMin: number; distanceKm: number },
  metric: "pace" | "distance" | "duration"
): number | null {
  if (metric === "duration") return p.durationMin > 0 ? p.durationMin : null;
  if (metric === "distance") return p.distanceKm > 0 ? p.distanceKm : null;
  // pace
  if (p.durationMin > 0 && p.distanceKm > 0) return p.durationMin / p.distanceKm;
  return null;
}

function fmtMetric(v: number, metric: "pace" | "distance" | "duration"): string {
  if (metric === "distance") return `${v.toFixed(1)}km`;
  if (metric === "duration") return `${Math.round(v)}min`;
  const mm = Math.floor(v);
  const ss = Math.round((v - mm) * 60);
  const ssStr = ss === 60 ? "00" : String(ss).padStart(2, "0");
  return `${ss === 60 ? mm + 1 : mm}:${ssStr}`;
}

/** Número curto: 3.240 vira "3,2 mil" para não estourar o eixo. */
function curto(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(".", ",")} mil`;
  return String(v % 1 ? Math.round(v * 10) / 10 : v).replace(".", ",");
}

function formatarValor(v: number, metrica: Metrica): string {
  switch (metrica) {
    case "carga_max":
    case "rm_estimado":
      return `${curto(v)}kg`;
    case "volume":
      return `${curto(v)}kg`;
    default:
      return curto(v);
  }
}

export function HistoryScreen({ embedded }: { embedded?: boolean } = {}) {
  const { token } = useAuth();
  const { width } = useWindowDimensions();

  const [mode, setMode] = useState<"strength" | "cardio">("strength");
  const [janela, setJanela] = useState<Janela>(90);

  const [exercicios, setExercicios] = useState<ExercicioNaLista[]>([]);
  const [grupos, setGrupos] = useState<GrupoTreinado[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [metrica, setMetrica] = useState<Metrica>("carga_max");
  const [serie, setSerie] = useState<PontoDoExercicio[]>([]);
  const [carregandoSerie, setCarregandoSerie] = useState(false);

  const [cardio, setCardio] = useState<CardioProgress[]>([]);
  const [cardioSel, setCardioSel] = useState<string | null>(null);
  const [metric, setMetric] = useState<"pace" | "distance" | "duration">("pace");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [lista, gruposDaJanela, card] = await Promise.all([
        listarExercicios(token!, janela),
        listarGrupos(token!, janela),
        getCardioProgress(token!),
      ]);
      setExercicios(lista);
      setGrupos(gruposDaJanela);
      setCardio(card.exercises);
      // Mantém o exercício escolhido quando ele continua existindo na janela
      // nova — trocar de janela não deveria trocar o assunto da tela.
      setSlug((cur) => (cur && lista.some((e) => e.slug === cur) ? cur : (lista[0]?.slug ?? null)));
      setCardioSel((cur) => cur ?? card.exercises[0]?.name ?? null);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token, janela]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // A série é buscada à parte: trocar de métrica ou de exercício não deveria
  // recarregar a lista inteira nem o radar.
  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      if (!slug) {
        setSerie([]);
        return;
      }
      setCarregandoSerie(true);
      serieDoExercicio(token!, slug, janela, metrica)
        .then((pontos) => vivo && setSerie(pontos))
        .catch(() => vivo && setSerie([]))
        .finally(() => vivo && setCarregandoSerie(false));
      return () => {
        vivo = false;
      };
    }, [token, slug, janela, metrica])
  );

  const atual = useMemo(() => exercicios.find((e) => e.slug === slug) ?? null, [exercicios, slug]);

  // Máx de 460px de largura para o gráfico (bom no web e no celular).
  const chartWidth = Math.min(width - spacing.gutter * 2 - spacing.md * 2, 460);
  const radarSize = Math.min(chartWidth, 320);

  const treinouAlgo = grupos.some((g) => g.series > 0);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          paddingHorizontal: spacing.gutter,
          paddingTop: spacing.md,
          gap: spacing.card,
        }}
      >
        <Skeleton width="45%" height={22} />
        <Skeleton height={40} radius={12} />
        <SkeletonCard lines={3} height={200} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!embedded && (
        <Txt variant="titleScreen">{mode === "strength" ? "Evolução de carga" : "Evolução de cardio"}</Txt>
      )}

      <View style={styles.toggle}>
        <Chip label="Musculação" active={mode === "strength"} onPress={() => setMode("strength")} />
        <Chip label="Cardio" active={mode === "cardio"} onPress={() => setMode("cardio")} />
      </View>

      {error ? (
        <ErrorState
          message="Não foi possível carregar sua evolução."
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      ) : (
        <>
          {mode === "strength" && (
            <>
              {/* Janela: é ela que define o que "evoluir" quer dizer aqui. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {JANELAS.map((d) => (
                  <Chip
                    key={d}
                    label={rotuloDaJanela(d)}
                    active={janela === d}
                    onPress={() => setJanela(d)}
                  />
                ))}
              </ScrollView>

              {exercicios.length === 0 ? (
                <Card level={1}>
                  <Txt variant="body" color={colors.text2}>
                    Nenhum treino de força com carga nesta janela. Registre seus treinos para
                    acompanhar aqui a evolução de cada exercício.
                  </Txt>
                </Card>
              ) : (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    {exercicios.map((e) => (
                      <Chip
                        key={e.slug}
                        label={e.nome}
                        active={slug === e.slug}
                        onPress={() => setSlug(e.slug)}
                      />
                    ))}
                  </ScrollView>

                  {atual && (
                    <Card level={1}>
                      <View style={styles.headlineRow}>
                        <Txt variant="titleCard">{atual.nome}</Txt>
                        {atual.delta !== null && (
                          <Txt
                            variant="bodyStrong"
                            tabular
                            color={atual.delta >= 0 ? colors.lime : colors.text3}
                          >
                            {`${atual.delta >= 0 ? "+" : "−"}${curto(Math.abs(atual.delta))} kg`}
                          </Txt>
                        )}
                      </View>

                      <View style={styles.metricRow}>
                        <Txt variant="metricLg" tabular>
                          {curto(atual.ultimo)}
                          <Txt variant="label" color={colors.text2}> kg</Txt>
                        </Txt>
                      </View>
                      <Txt variant="caption" color={colors.text3}>
                        Melhor: {curto(atual.melhor)} kg · {atual.vezes}{" "}
                        {atual.vezes === 1 ? "treino" : "treinos"} nesta janela
                      </Txt>

                      {/* Métrica: carga não é a única forma de evoluir — quem
                          não subiu peso pode ter subido volume. */}
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chips}
                        style={{ marginTop: spacing.s8 }}
                      >
                        {METRICAS.map((m) => (
                          <Chip
                            key={m}
                            label={rotuloDaMetrica(m)}
                            active={metrica === m}
                            onPress={() => setMetrica(m)}
                          />
                        ))}
                      </ScrollView>

                      {carregandoSerie ? (
                        <Skeleton height={200} radius={12} />
                      ) : serie.length > 1 ? (
                        <View style={{ marginTop: spacing.s16 }}>
                          <LineChart
                            points={serie.map((p) => ({ date: p.data, value: p.valor, ehPR: p.ehPR }))}
                            width={chartWidth}
                            formatValue={(v) => formatarValor(v, metrica)}
                          />
                          {serie.some((p) => p.ehPR) && (
                            <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                              O ponto destacado é um recorde seu.
                            </Txt>
                          )}
                        </View>
                      ) : (
                        <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                          {serie.length === 1
                            ? "Registre este exercício mais vezes para ver a curva."
                            : "Sem dados desta métrica neste exercício."}
                        </Txt>
                      )}
                    </Card>
                  )}

                  {/* Radar: onde você treina, e onde não treina. */}
                  {treinouAlgo && (
                    <Card level={1}>
                      <SectionHeader title="Onde você treina" />
                      <RadarChart
                        eixos={grupos.map((g) => ({ rotulo: abreviarMusculo(g.grupo), valor: g.series }))}
                        size={radarSize}
                      />
                      <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                        Séries por grupo muscular {rotuloDaJanela(janela).toLowerCase() === "tudo"
                          ? "em todo o seu histórico"
                          : `nos últimos ${rotuloDaJanela(janela).toLowerCase()}`}
                        . A comparação é com você mesmo.
                      </Txt>
                    </Card>
                  )}
                </>
              )}
            </>
          )}

          {mode === "cardio" &&
            (cardio.length === 0 ? (
              <Card level={1}>
                <Txt variant="body" color={colors.text2}>
                  Registre treinos de cardio com duração e distância para acompanhar sua evolução.
                </Txt>
              </Card>
            ) : (
              <>
                {/* Seletor de exercício de cardio */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {cardio.map((e) => (
                    <Chip
                      key={e.name}
                      label={e.name}
                      active={cardioSel === e.name}
                      onPress={() => setCardioSel(e.name)}
                    />
                  ))}
                </ScrollView>

                {/* Seletor de métrica */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {METRICS.map((mt) => (
                    <Chip
                      key={mt.key}
                      label={mt.label}
                      active={metric === mt.key}
                      onPress={() => setMetric(mt.key)}
                    />
                  ))}
                </ScrollView>

                {(() => {
                  const cur = cardio.find((e) => e.name === cardioSel) ?? null;
                  if (!cur) return null;
                  const pts = cur.points
                    .map((p) => ({ date: p.date, value: metricValue(p, metric) }))
                    .filter((p): p is { date: string; value: number } => p.value !== null);
                  return (
                    <Card level={1}>
                      <Txt variant="titleCard">{cur.name}</Txt>
                      {pts.length > 0 && (
                        <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                          {fmtMetric(pts[0].value, metric)} → {fmtMetric(pts[pts.length - 1].value, metric)}
                          {" · "}
                          {pts.length} registro(s)
                        </Txt>
                      )}
                      {pts.length === 0 ? (
                        <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                          Sem dados dessa métrica para este exercício.
                        </Txt>
                      ) : pts.length > 1 ? (
                        <View style={{ marginTop: spacing.s16 }}>
                          <LineChart
                            points={pts}
                            width={chartWidth}
                            formatValue={(v) => fmtMetric(v, metric)}
                            // Correr mais rápido é um pace MENOR: sem inverter,
                            // melhorar desenhava uma linha descendo.
                            menorEhMelhor={metric === "pace"}
                          />
                        </View>
                      ) : (
                        <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                          Registre mais vezes para ver a curva.
                        </Txt>
                      )}
                    </Card>
                  );
                })()}
              </>
            ))}
        </>
      )}
      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.gutter, gap: spacing.card },
  toggle: { flexDirection: "row", gap: spacing.s8 },
  chips: { gap: spacing.s8, paddingVertical: spacing.xs },
  headlineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metricRow: { marginTop: spacing.s8, marginBottom: 2 },
});
