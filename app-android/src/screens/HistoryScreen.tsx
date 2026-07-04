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
  type ExerciseProgress,
  type WorkoutLogItem,
} from "../api/checkins";
import { LineChart } from "../components/LineChart";
import { colors, radius, spacing } from "../theme";

export function HistoryScreen() {
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const [exercises, setExercises] = useState<ExerciseProgress[]>([]);
  const [logs, setLogs] = useState<WorkoutLogItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [prog, hist] = await Promise.all([getProgress(token!), getHistory(token!)]);
      setExercises(prog.exercises);
      setLogs(hist.logs);
      setSelected((cur) => cur ?? prog.exercises[0]?.name ?? null);
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
      <Text style={styles.title}>Evolução de carga</Text>

      {exercises.length === 0 ? (
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
                <LineChart points={current.points} width={chartWidth} />
              ) : (
                <Text style={styles.subtle}>Registre este exercício mais vezes para ver a curva.</Text>
              )}
            </View>
          )}
        </>
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
