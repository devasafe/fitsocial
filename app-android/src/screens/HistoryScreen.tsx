import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import {
  getProgress,
  getHistory,
  getCardioProgress,
  type ExerciseProgress,
  type WorkoutLogItem,
  type CardioProgress,
} from "../api/checkins";
import { LineChart } from "../components/LineChart";
import { Txt, Card, Chip, SectionHeader, ErrorState } from "../components/ui";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import { colors, radius, spacing } from "../theme";

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

export function HistoryScreen({ embedded }: { embedded?: boolean } = {}) {
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const [exercises, setExercises] = useState<ExerciseProgress[]>([]);
  const [logs, setLogs] = useState<WorkoutLogItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"strength" | "cardio">("strength");
  const [cardio, setCardio] = useState<CardioProgress[]>([]);
  const [cardioSel, setCardioSel] = useState<string | null>(null);
  const [metric, setMetric] = useState<"pace" | "distance" | "duration">("pace");

  const load = useCallback(async () => {
    try {
      const [prog, hist, card] = await Promise.all([
        getProgress(token!),
        getHistory(token!),
        getCardioProgress(token!),
      ]);
      setExercises(prog.exercises);
      setLogs(hist.logs);
      setCardio(card.exercises);
      setSelected((cur) => cur ?? prog.exercises[0]?.name ?? null);
      setCardioSel((cur) => cur ?? card.exercises[0]?.name ?? null);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const current = useMemo(
    () => exercises.find((e) => e.name === selected) ?? null,
    [exercises, selected]
  );

  // Máx de 460px de largura para o gráfico (bom no web e no celular).
  const chartWidth = Math.min(width - spacing.gutter * 2 - spacing.md * 2, 460);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.gutter, paddingTop: spacing.md, gap: spacing.card }}>
        <Skeleton width="45%" height={22} />
        <Skeleton height={40} radius={12} />
        <SkeletonCard lines={3} height={200} />
      </View>
    );
  }

  const first = current?.points[0]?.weightKg;
  const lastW = current ? current.points[current.points.length - 1]?.weightKg : undefined;
  const delta = first !== undefined && lastW !== undefined ? lastW - first : 0;
  const deltaStr = `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} kg`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!embedded && (
        <Txt variant="titleScreen">
          {mode === "strength" ? "Evolução de carga" : "Evolução de cardio"}
        </Txt>
      )}

      <View style={styles.toggle}>
        <Chip label="Musculação" active={mode === "strength"} onPress={() => setMode("strength")} />
        <Chip label="Cardio" active={mode === "cardio"} onPress={() => setMode("cardio")} />
      </View>

      {error ? (
        <ErrorState
          message="Não foi possível carregar seu histórico."
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      ) : (
        <>
      {mode === "strength" &&
        (exercises.length === 0 ? (
          <Card level={1}>
            <Txt variant="body" color={colors.text2}>
              Registre treinos com carga em kg para acompanhar aqui a evolução dos seus pesos ao
              longo do tempo.
            </Txt>
          </Card>
        ) : (
          <>
            {/* Seletor de exercício */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {exercises.map((e) => (
                <Chip
                  key={e.name}
                  label={e.name}
                  active={selected === e.name}
                  onPress={() => setSelected(e.name)}
                />
              ))}
            </ScrollView>

            {current && (
              <Card level={1}>
                <View style={styles.headlineRow}>
                  <Txt variant="titleCard">{current.name}</Txt>
                  {current.points.length > 1 && (
                    <Txt
                      variant="bodyStrong"
                      tabular
                      color={delta >= 0 ? colors.lime : colors.text3}
                    >
                      {deltaStr}
                    </Txt>
                  )}
                </View>
                <View style={styles.metricRow}>
                  <Txt variant="metricLg" tabular>
                    {lastW}
                    <Txt variant="label" color={colors.text2}>
                      {" "}
                      kg
                    </Txt>
                  </Txt>
                </View>
                <Txt variant="caption" color={colors.text3}>
                  {first} kg no primeiro registro · {current.points.length} registro(s)
                </Txt>

                {current.points.length > 1 ? (
                  <View style={{ marginTop: spacing.s16 }}>
                    <LineChart
                      points={current.points.map((p) => ({ date: p.date, value: p.weightKg }))}
                      width={chartWidth}
                      formatValue={(v) => `${v % 1 ? v.toFixed(1) : v}kg`}
                    />
                  </View>
                ) : (
                  <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                    Registre este exercício mais vezes para ver a curva.
                  </Txt>
                )}
              </Card>
            )}
          </>
        ))}

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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
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

      {/* Histórico de treinos */}
      <View style={{ marginTop: spacing.section - spacing.card }}>
        <SectionHeader title="Treinos recentes" />
      </View>
      {logs.length === 0 ? (
        <Txt variant="body" color={colors.text2}>
          Nenhum treino registrado ainda.
        </Txt>
      ) : (
        logs.map((log) => (
          <Card key={log.id} level={1} style={styles.logRow}>
            <View style={{ flex: 1 }}>
              <Txt variant="titleCard">{log.sessionDay}</Txt>
              <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                {log.entries.length} exercício(s)
              </Txt>
            </View>
            <Txt variant="label" color={colors.text2} tabular>
              {new Date(log.date).toLocaleDateString("pt-BR")}
            </Txt>
          </Card>
        ))
      )}
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
  logRow: { flexDirection: "row", alignItems: "center", borderRadius: radius.card },
});
