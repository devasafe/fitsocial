import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
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

export function HistoryScreen() {
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const [exercises, setExercises] = useState<ExerciseProgress[]>([]);
  const [logs, setLogs] = useState<WorkoutLogItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  // Máx de 500px de largura para o gráfico (bom no web e no celular).
  const chartWidth = Math.min(width - spacing.lg * 2 - spacing.md * 2, 460);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const first = current?.points[0]?.weightKg;
  const lastW = current ? current.points[current.points.length - 1]?.weightKg : undefined;
  const delta = first !== undefined && lastW !== undefined ? lastW - first : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{mode === "strength" ? "Evolução de carga" : "Evolução de cardio"}</Text>

      <View style={styles.toggle}>
        {(["strength", "cardio"] as const).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.toggleBtn, mode === m && styles.toggleOn]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.toggleText, mode === m && styles.toggleTextOn]}>
              {m === "strength" ? "Musculação" : "Cardio"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === "strength" && (
        exercises.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>
              Registre treinos com carga (kg) para ver aqui a evolução dos seus pesos ao
              longo do tempo. 📈
            </Text>
          </View>
        ) : (
          <>
            {/* Seletor de exercício */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {exercises.map((e) => (
                <TouchableOpacity
                  key={e.name}
                  style={[styles.chip, selected === e.name && styles.chipOn]}
                  onPress={() => setSelected(e.name)}
                >
                  <Text style={[styles.chipText, selected === e.name && styles.chipTextOn]}>
                    {e.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {current && (
              <View style={styles.card}>
                <View style={styles.headlineRow}>
                  <Text style={styles.headline}>{current.name}</Text>
                  {current.points.length > 1 && (
                    <Text style={[styles.delta, delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}kg
                    </Text>
                  )}
                </View>
                <Text style={styles.subtle}>
                  {first}kg → {lastW}kg · {current.points.length} registro(s)
                </Text>

                {current.points.length > 1 ? (
                  <LineChart
                    points={current.points.map((p) => ({ date: p.date, value: p.weightKg }))}
                    width={chartWidth}
                    formatValue={(v) => `${Math.round(v)}kg`}
                  />
                ) : (
                  <Text style={styles.subtle}>Registre este exercício mais vezes para ver a curva.</Text>
                )}
              </View>
            )}
          </>
        )
      )}

      {mode === "cardio" && (
        cardio.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>
              Registre treinos de cardio com duração e distância para ver sua evolução. 🏃
            </Text>
          </View>
        ) : (
          <>
            {/* Seletor de exercício de cardio */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {cardio.map((e) => (
                <TouchableOpacity
                  key={e.name}
                  style={[styles.chip, cardioSel === e.name && styles.chipOn]}
                  onPress={() => setCardioSel(e.name)}
                >
                  <Text style={[styles.chipText, cardioSel === e.name && styles.chipTextOn]}>{e.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Seletor de métrica */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {METRICS.map((mt) => (
                <TouchableOpacity
                  key={mt.key}
                  style={[styles.chip, metric === mt.key && styles.chipOn]}
                  onPress={() => setMetric(mt.key)}
                >
                  <Text style={[styles.chipText, metric === mt.key && styles.chipTextOn]}>{mt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {(() => {
              const cur = cardio.find((e) => e.name === cardioSel) ?? null;
              if (!cur) return null;
              const pts = cur.points
                .map((p) => ({ date: p.date, value: metricValue(p, metric) }))
                .filter((p): p is { date: string; value: number } => p.value !== null);
              return (
                <View style={styles.card}>
                  <Text style={styles.headline}>{cur.name}</Text>
                  {pts.length > 0 && (
                    <Text style={styles.subtle}>
                      {fmtMetric(pts[0].value, metric)} → {fmtMetric(pts[pts.length - 1].value, metric)}
                      {" · "}{pts.length} registro(s)
                    </Text>
                  )}
                  {pts.length === 0 ? (
                    <Text style={styles.subtle}>Sem dados dessa métrica para este exercício.</Text>
                  ) : pts.length > 1 ? (
                    <LineChart points={pts} width={chartWidth} formatValue={(v) => fmtMetric(v, metric)} />
                  ) : (
                    <Text style={styles.subtle}>Registre mais vezes para ver a curva.</Text>
                  )}
                </View>
              );
            })()}
          </>
        )
      )}

      {/* Histórico de treinos */}
      <Text style={styles.sectionTitle}>Treinos recentes</Text>
      {logs.length === 0 ? (
        <Text style={styles.emptyText}>Nenhum treino registrado ainda.</Text>
      ) : (
        logs.map((log) => (
          <View key={log.id} style={styles.logRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.logDay}>{log.sessionDay}</Text>
              <Text style={styles.subtle}>
                {log.entries.length} exercício(s)
              </Text>
            </View>
            <Text style={styles.subtle}>
              {new Date(log.date).toLocaleDateString("pt-BR")}
            </Text>
          </View>
        ))
      )}
      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.lg, gap: spacing.md, paddingTop: spacing.xl },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  toggle: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  toggleBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  toggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleText: { color: colors.textMuted, fontWeight: "700" },
  toggleTextOn: { color: colors.primaryText },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: "600" },
  chipTextOn: { color: colors.primaryText },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headlineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headline: { color: colors.text, fontSize: 18, fontWeight: "800" },
  delta: { fontWeight: "800" },
  deltaUp: { color: colors.primary },
  deltaDown: { color: colors.danger },
  subtle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: spacing.md },
  emptyText: { color: colors.textMuted, lineHeight: 20 },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logDay: { color: colors.text, fontWeight: "700" },
});
