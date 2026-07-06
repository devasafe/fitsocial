import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../context/AuthContext";
import { createCheckIn, type CheckInEntry } from "../api/checkins";
import { PrimaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";
import { resolveExerciseVideos, type VideoRef } from "../api/exerciseVideos";
import { ExerciseVideoThumb } from "../components/ExerciseVideoThumb";

interface Row {
  name: string;
  kind: "strength" | "cardio";
  target: string; // ex.: "4 × 8-12"
  done: boolean;
  weight: string;
  reps: string;
  duration: string;
  distance: string;
}

function paceLabel(row: { duration: string; distance: string }): string | null {
  const min = Number(row.duration);
  const km = Number(row.distance);
  if (!min || !km) return null;
  const pace = min / km; // min/km
  const mm = Math.floor(pace);
  const ss = Math.round((pace - mm) * 60);
  const ssStr = ss === 60 ? "00" : String(ss).padStart(2, "0");
  const mmAdj = ss === 60 ? mm + 1 : mm;
  return `${mmAdj}:${ssStr} /km`;
}

export function CheckInScreen() {
  const route = useRoute<RouteProp<AppStackParams, "CheckIn">>();
  const nav = useNavigation();
  const { token } = useAuth();
  const { session } = route.params;
  const storageKey = `fitsocial.session:${session.day}`;

  const makeRows = (): Row[] =>
    session.exercises.map((e) => ({
      name: e.name,
      kind: e.kind === "cardio" ? "cardio" : "strength", // fallback trivial se ausente
      target: `${e.sets} × ${e.reps}`,
      done: false,
      weight: "",
      reps: "",
      duration: "",
      distance: "",
    }));

  const [rows, setRows] = useState<Row[]>(makeRows);
  const [share, setShare] = useState(true);
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);
  const [videos, setVideos] = useState<Record<string, VideoRef | null>>({});
  const [loadingVideos, setLoadingVideos] = useState(true);

  const doneCount = useMemo(() => rows.filter((r) => r.done).length, [rows]);

  // Resolve as miniaturas de vídeo dos exercícios da sessão (não bloqueia o check-in).
  useEffect(() => {
    const names = session.exercises.map((e) => e.name);
    let alive = true;
    resolveExerciseVideos(names, token)
      .then((v) => alive && setVideos(v))
      .catch(() => alive && setVideos({}))
      .finally(() => alive && setLoadingVideos(false));
    return () => {
      alive = false;
    };
  }, [session, token]);

  // Restaura o rascunho salvo ao abrir (se for do mesmo treino).
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const saved = JSON.parse(raw) as { names: string[]; rows: Partial<Row>[] };
          const names = session.exercises.map((e) => e.name);
          const sameSession =
            saved.names.length === names.length && saved.names.every((n, i) => n === names[i]);
          if (sameSession) {
            setRows(
              saved.rows.map(
                (r) =>
                  ({
                    duration: "",
                    distance: "",
                    ...r,
                    kind: r.kind ?? "strength",
                  }) as Row
              )
            );
          }
        }
      } catch {
        /* rascunho inválido — ignora */
      }
      loaded.current = true;
    })();
  }, [storageKey]);

  // Auto-salva a cada mudança (depois de carregar o rascunho).
  useEffect(() => {
    if (!loaded.current) return;
    const names = session.exercises.map((e) => e.name);
    AsyncStorage.setItem(storageKey, JSON.stringify({ names, rows })).catch(() => {});
  }, [rows, storageKey]);

  function handleReset() {
    Alert.alert("Recomeçar treino?", "Isso limpa as marcações e cargas deste treino.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Recomeçar", style: "destructive", onPress: () => setRows(makeRows()) },
    ]);
  }

  function toggleDone(i: number) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, done: !r.done } : r)));
  }
  function updateField(i: number, field: "weight" | "reps" | "duration" | "distance", value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function handleFinish() {
    const entries: CheckInEntry[] = rows
      .filter((r) => r.done)
      .map((r) =>
        r.kind === "cardio"
          ? {
              exerciseName: r.name,
              ...(r.duration !== "" ? { durationMin: Number(r.duration) || 0 } : {}),
              ...(r.distance !== "" ? { distanceKm: Number(r.distance) || 0 } : {}),
            }
          : {
              exerciseName: r.name,
              ...(r.weight !== "" ? { weightKg: Number(r.weight) || 0 } : {}),
              ...(r.reps !== "" ? { reps: Number(r.reps) || 0 } : {}),
            }
      );

    if (entries.length === 0) {
      Alert.alert("Nenhum exercício marcado", "Marque ao menos um exercício como feito.");
      return;
    }

    setSaving(true);
    try {
      await createCheckIn(token!, {
        sessionDay: session.day,
        entries,
        shareToFeed: share,
        shareText: share ? `Concluí o treino: ${session.day} 💪` : undefined,
      });
      await AsyncStorage.removeItem(storageKey); // limpa o rascunho ao concluir
      Alert.alert("Treino registrado! 🎉", share ? "E compartilhado no seu feed." : undefined);
      nav.goBack();
    } catch (err) {
      Alert.alert("Não foi possível registrar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.progress}>
            {doneCount}/{rows.length} feitos
          </Text>
          <TouchableOpacity onPress={handleReset}>
            <Text style={styles.reset}>Recomeçar</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${(doneCount / rows.length) * 100}%` }]} />
        </View>
        <Text style={styles.autosave}>💾 Progresso salvo automaticamente — pode fechar e voltar.</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {rows.map((row, i) => (
          <View key={i} style={[styles.card, row.done && styles.cardDone]}>
            <TouchableOpacity style={styles.cardTop} onPress={() => toggleDone(i)} activeOpacity={0.7}>
              <View style={[styles.check, row.done && styles.checkOn]}>
                {row.done && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.exNameRow}>
                  <ExerciseVideoThumb
                    video={videos[row.name] ?? null}
                    loading={loadingVideos}
                    exerciseName={row.name}
                  />
                  <Text style={[styles.exName, row.done && styles.exNameDone]}>{row.name}</Text>
                </View>
                <Text style={styles.exTarget}>Meta: {row.target}</Text>
              </View>
            </TouchableOpacity>

            {row.kind === "cardio" ? (
              <>
                <View style={styles.inputsRow}>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>Duração (min)</Text>
                    <TextInput
                      style={styles.input}
                      value={row.duration}
                      onChangeText={(v) => updateField(i, "duration", v)}
                      keyboardType="numeric"
                      placeholder="—"
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>Distância (km)</Text>
                    <TextInput
                      style={styles.input}
                      value={row.distance}
                      onChangeText={(v) => updateField(i, "distance", v)}
                      keyboardType="numeric"
                      placeholder="—"
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                </View>
                {paceLabel(row) ? <Text style={styles.hint}>Pace médio: {paceLabel(row)}</Text> : null}
              </>
            ) : (
              <View style={styles.inputsRow}>
                <View style={styles.inputWrap}>
                  <Text style={styles.inputLabel}>Carga (kg)</Text>
                  <TextInput
                    style={styles.input}
                    value={row.weight}
                    onChangeText={(v) => updateField(i, "weight", v)}
                    keyboardType="numeric"
                    placeholder="—"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
                <View style={styles.inputWrap}>
                  <Text style={styles.inputLabel}>Reps</Text>
                  <TextInput
                    style={styles.input}
                    value={row.reps}
                    onChangeText={(v) => updateField(i, "reps", v)}
                    keyboardType="numeric"
                    placeholder="—"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              </View>
            )}
          </View>
        ))}

        <View style={styles.shareRow}>
          <Text style={styles.shareLabel}>Compartilhar no feed</Text>
          <Switch
            value={share}
            onValueChange={setShare}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.text}
          />
        </View>

        <PrimaryButton
          title={`Finalizar treino (${doneCount}/${rows.length})`}
          onPress={handleFinish}
          loading={saving}
        />
        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  progress: { color: colors.text, fontWeight: "800" },
  reset: { color: colors.textMuted, fontWeight: "600" },
  autosave: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 8, backgroundColor: colors.primary },
  list: { padding: spacing.md, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardDone: { borderColor: colors.primary },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  check: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: colors.primaryText, fontWeight: "900" },
  exNameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  exName: { color: colors.text, fontWeight: "700", fontSize: 15 },
  exNameDone: { textDecorationLine: "line-through", color: colors.textMuted },
  exTarget: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  inputsRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  inputWrap: { flex: 1 },
  inputLabel: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 16,
  },
  hint: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs, fontStyle: "italic" },
  shareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm },
  shareLabel: { color: colors.text, fontWeight: "600" },
});
