import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
} from "react-native";
import { notify, confirmDialog } from "../lib/notify";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../context/AuthContext";
import { createCheckIn, type CheckInEntry } from "../api/checkins";
import { usePRCelebration } from "../components/PRCelebration";
import { Txt, Button, Card } from "../components/ui";
import { colors, radius, spacing, motion } from "../theme";
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

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const celebratePR = usePRCelebration();
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
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);
  const [videos, setVideos] = useState<Record<string, VideoRef | null>>({});
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [rest, setRest] = useState<number | null>(null); // segundos de descanso restantes
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barAnim = useRef(new Animated.Value(0)).current; // preenchimento suave da barra

  const doneCount = useMemo(() => rows.filter((r) => r.done).length, [rows]);

  function stopRest() {
    if (restRef.current) clearInterval(restRef.current);
    restRef.current = null;
    setRest(null);
  }
  function startRest(sec: number) {
    if (restRef.current) clearInterval(restRef.current);
    setRest(sec);
    restRef.current = setInterval(() => {
      setRest((r) => {
        if (r === null) return null;
        if (r <= 1) {
          if (restRef.current) clearInterval(restRef.current);
          restRef.current = null;
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }
  useEffect(() => () => stopRest(), []);

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
    confirmDialog(
      "Recomeçar treino?",
      "Isso limpa as marcações e as cargas deste treino.",
      () => setRows(makeRows()),
      "Recomeçar"
    );
  }

  function toggleDone(i: number) {
    setRows((prev) => {
      const wasDone = prev[i]?.done;
      // Ao MARCAR feito, dispara o descanso do exercício (padrão 60s).
      if (!wasDone) startRest(session.exercises[i]?.restSeconds || 60);
      return prev.map((r, idx) => (idx === i ? { ...r, done: !r.done } : r));
    });
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
      notify("Nenhum exercício marcado", "Marque ao menos um exercício como feito.");
      return;
    }

    setSaving(true);
    try {
      const res = await createCheckIn(token!, { sessionDay: session.day, entries });
      await AsyncStorage.removeItem(storageKey); // limpa o rascunho ao concluir
      celebratePR(res.newPRs ?? []);
      // Sempre abre o compositor com o treino anexado (foto/texto ou "Agora não").
      nav.navigate("CreatePost", { activity: res.activity });
    } catch (err) {
      notify("Não foi possível salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const pct = rows.length ? (doneCount / rows.length) * 100 : 0;
  const currentIdx = rows.findIndex((r) => !r.done); // exercício "Agora"

  useEffect(() => {
    Animated.timing(barAnim, { toValue: pct, duration: motion.base, useNativeDriver: false }).start();
  }, [pct, barAnim]);

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
          <Animated.View
            style={[styles.barFill, { width: barAnim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }]}
          />
        </View>
        <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
          Progresso salvo automaticamente. Pode fechar e voltar.
        </Txt>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {rows.map((row, i) => {
          const pace = paceLabel(row);
          const isCurrent = i === currentIdx;
          return (
            <Card key={i} level={1} style={[styles.card, row.done ? styles.cardDone : isCurrent ? styles.cardCurrent : null]}>
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
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 }}>
                    <Txt variant="caption" color={colors.text3}>
                      Meta {row.target}
                    </Txt>
                    {isCurrent && !row.done ? (
                      <Txt variant="caption" color={colors.onLime} style={styles.nowTag}>
                        Agora
                      </Txt>
                    ) : null}
                  </View>
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

        <View style={{ height: spacing.sm }} />
      </ScrollView>

      {/* Timer de descanso — aparece ao marcar uma série feita */}
      {rest !== null && (
        <View style={styles.restPill}>
          <Txt variant="bodyStrong" color={colors.onLime} tabular>
            {rest > 0 ? `Descanso ${fmt(rest)}` : "Descanso completo — bora!"}
          </Txt>
          <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
            {rest > 0 ? (
              <TouchableOpacity onPress={() => setRest((r) => (r ?? 0) + 30)} hitSlop={8}>
                <Txt variant="label" color={colors.onLime}>
                  +30s
                </Txt>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={stopRest} hitSlop={8}>
              <Txt variant="label" color={colors.onLime}>
                {rest > 0 ? "Pular" : "Ok"}
              </Txt>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Barra fixa — finalizar sempre acessível, sem rolar até o fim */}
      <View style={styles.actionBar}>
        <Button
          title={`Finalizar treino (${doneCount}/${rows.length})`}
          size="lg"
          glow
          onPress={handleFinish}
          loading={saving}
        />
      </View>
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
  cardCurrent: { borderColor: colors.lineStrong, borderLeftWidth: 3, borderLeftColor: colors.lime },
  nowTag: {
    backgroundColor: colors.lime,
    color: colors.onLime,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: radius.full,
    overflow: "hidden",
  },
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
  restPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.lime,
    marginHorizontal: spacing.gutter,
    marginBottom: spacing.s8,
    paddingVertical: spacing.s12,
    paddingHorizontal: spacing.md,
    borderRadius: radius.chip,
  },
  actionBar: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.s12,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
});
