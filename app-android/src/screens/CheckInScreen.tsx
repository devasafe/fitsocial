import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
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
import { Txt, Button, Card } from "../components/ui";
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
                (r, i) =>
                  ({
                    duration: "",
                    distance: "",
                    ...r,
                    kind: session.exercises[i]?.kind === "cardio" ? "cardio" : "strength",
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
    Alert.alert("Recomeçar treino?", "Isso limpa as marcações e as cargas deste treino.", [
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
        shareText: share ? `Concluí o treino: ${session.day}` : undefined,
      });
      await AsyncStorage.removeItem(storageKey); // limpa o rascunho ao concluir
      Alert.alert("Treino salvo", share ? "Publicado no seu feed." : undefined);
      nav.goBack();
    } catch (err) {
      Alert.alert("Não foi possível salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const pct = rows.length ? (doneCount / rows.length) * 100 : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.progressWrap}>
            <Txt variant="metricMd" tabular>
              {doneCount}
            </Txt>
            <Txt variant="label" color={colors.text2}>
              de {rows.length} séries feitas
            </Txt>
          </View>
          <TouchableOpacity onPress={handleReset} hitSlop={8}>
            <Txt variant="label" color={colors.text2}>
              Recomeçar
            </Txt>
          </TouchableOpacity>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct}%` }]} />
        </View>
        <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
          Progresso salvo automaticamente. Pode fechar e voltar.
        </Txt>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {rows.map((row, i) => {
          const pace = paceLabel(row);
          return (
            <Card key={i} level={1} style={[styles.card, row.done && styles.cardDone]}>
              <TouchableOpacity
                style={styles.cardTop}
                onPress={() => toggleDone(i)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: row.done }}
                accessibilityLabel={`${row.name}, marcar como feito`}
              >
                <View style={[styles.check, row.done && styles.checkOn]}>
                  {row.done ? <Txt style={styles.checkMark}>✓</Txt> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.exNameRow}>
                    <ExerciseVideoThumb
                      video={videos[row.name] ?? null}
                      loading={loadingVideos}
                      exerciseName={row.name}
                    />
                    <Txt
                      variant="bodyStrong"
                      color={row.done ? colors.text3 : colors.text}
                      style={[styles.exName, row.done && styles.exNameDone]}
                    >
                      {row.name}
                    </Txt>
                  </View>
                  <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                    Meta {row.target}
                  </Txt>
                </View>
              </TouchableOpacity>

              {row.kind === "cardio" ? (
                <>
                  <View style={styles.inputsRow}>
                    <View style={styles.inputWrap}>
                      <Txt variant="caption" color={colors.text2} style={styles.inputLabel}>
                        Duração (min)
                      </Txt>
                      <TextInput
                        style={styles.input}
                        value={row.duration}
                        onChangeText={(v) => updateField(i, "duration", v)}
                        keyboardType="numeric"
                        placeholder="—"
                        placeholderTextColor={colors.text3}
                      />
                    </View>
                    <View style={styles.inputWrap}>
                      <Txt variant="caption" color={colors.text2} style={styles.inputLabel}>
                        Distância (km)
                      </Txt>
                      <TextInput
                        style={styles.input}
                        value={row.distance}
                        onChangeText={(v) => updateField(i, "distance", v)}
                        keyboardType="numeric"
                        placeholder="—"
                        placeholderTextColor={colors.text3}
                      />
                    </View>
                  </View>
                  {pace ? (
                    <Txt variant="caption" color={colors.text2} style={{ marginTop: spacing.s8 }}>
                      Pace médio {pace}
                    </Txt>
                  ) : null}
                </>
              ) : (
                <View style={styles.inputsRow}>
                  <View style={styles.inputWrap}>
                    <Txt variant="caption" color={colors.text2} style={styles.inputLabel}>
                      Carga (kg)
                    </Txt>
                    <TextInput
                      style={styles.input}
                      value={row.weight}
                      onChangeText={(v) => updateField(i, "weight", v)}
                      keyboardType="numeric"
                      placeholder="—"
                      placeholderTextColor={colors.text3}
                    />
                  </View>
                  <View style={styles.inputWrap}>
                    <Txt variant="caption" color={colors.text2} style={styles.inputLabel}>
                      Reps
                    </Txt>
                    <TextInput
                      style={styles.input}
                      value={row.reps}
                      onChangeText={(v) => updateField(i, "reps", v)}
                      keyboardType="numeric"
                      placeholder="—"
                      placeholderTextColor={colors.text3}
                    />
                  </View>
                </View>
              )}
            </Card>
          );
        })}

        <View style={styles.shareRow}>
          <Txt variant="bodyStrong">Compartilhar no feed</Txt>
          <Switch
            value={share}
            onValueChange={setShare}
            trackColor={{ true: colors.lime, false: colors.line }}
            thumbColor={colors.text}
          />
        </View>

        <Button
          title={`Salvar treino (${doneCount}/${rows.length})`}
          size="lg"
          glow
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
  header: { paddingHorizontal: spacing.gutter, paddingTop: spacing.s16, paddingBottom: spacing.s12 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.s12,
  },
  progressWrap: { flexDirection: "row", alignItems: "baseline", gap: spacing.s8 },
  barTrack: { height: 6, borderRadius: radius.full, backgroundColor: colors.surface2, overflow: "hidden" },
  barFill: { height: 6, borderRadius: radius.full, backgroundColor: colors.lime },
  list: { padding: spacing.gutter, gap: spacing.card },
  card: { borderRadius: radius.card },
  cardDone: { borderColor: colors.lime },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.s12 },
  check: {
    width: 44,
    height: 44,
    borderRadius: radius.chip,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  checkMark: { color: colors.onLime, fontSize: 22, fontWeight: "900" },
  exNameRow: { flexDirection: "row", alignItems: "center", gap: spacing.s8 },
  exName: { flexShrink: 1 },
  exNameDone: { textDecorationLine: "line-through" },
  inputsRow: { flexDirection: "row", gap: spacing.s12, marginTop: spacing.s16 },
  inputWrap: { flex: 1 },
  inputLabel: { marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.s12,
    color: colors.text,
    fontSize: 24,
    fontVariant: ["tabular-nums"],
  },
  shareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.s8,
  },
});
