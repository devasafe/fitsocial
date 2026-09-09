// Edição MANUAL do treino — busca o plano atual, edita sessões/exercícios e salva.
import React, { useCallback, useEffect, useState } from "react";
import { View, ActivityIndicator, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getCurrentPlan, updatePlan, type Plan, type Workout } from "../api/plans";
import { Txt, Screen, Card, Button, Field, ErrorState } from "../components/ui";
import { notify } from "../lib/notify";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

interface ExForm {
  name: string;
  sets: string;
  reps: string;
  restSeconds: string;
  notes: string;
  kind?: "strength" | "cardio";
}
interface SessForm {
  day: string;
  focus: string;
  exercises: ExForm[];
}

function toForm(w: Workout): { split: string; daysPerWeek: string; sessions: SessForm[] } {
  return {
    split: w.split,
    daysPerWeek: String(w.daysPerWeek),
    sessions: w.sessions.map((s) => ({
      day: s.day,
      focus: s.focus,
      exercises: s.exercises.map((e) => ({
        name: e.name,
        sets: String(e.sets),
        reps: e.reps,
        restSeconds: String(e.restSeconds),
        notes: e.notes ?? "",
        kind: e.kind,
      })),
    })),
  };
}

export function EditWorkoutScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [split, setSplit] = useState("");
  const [days, setDays] = useState("");
  const [sessions, setSessions] = useState<SessForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getCurrentPlan(token!)
      .then((p) => {
        setPlan(p);
        if (p) {
          const f = toForm(p.workout);
          setSplit(f.split);
          setDays(f.daysPerWeek);
          setSessions(f.sessions);
        }
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Helpers de edição imutável.
  function setSess(si: number, patch: Partial<SessForm>) {
    setSessions((prev) => prev.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  }
  function setEx(si: number, ei: number, patch: Partial<ExForm>) {
    setSessions((prev) =>
      prev.map((s, i) =>
        i === si ? { ...s, exercises: s.exercises.map((e, j) => (j === ei ? { ...e, ...patch } : e)) } : s
      )
    );
  }
  function addEx(si: number) {
    setSessions((prev) =>
      prev.map((s, i) =>
        i === si ? { ...s, exercises: [...s.exercises, { name: "", sets: "3", reps: "10", restSeconds: "60", notes: "" }] } : s
      )
    );
  }
  function removeEx(si: number, ei: number) {
    setSessions((prev) => prev.map((s, i) => (i === si ? { ...s, exercises: s.exercises.filter((_, j) => j !== ei) } : s)));
  }
  function addSession() {
    setSessions((prev) => [...prev, { day: "Novo dia", focus: "", exercises: [{ name: "", sets: "3", reps: "10", restSeconds: "60", notes: "" }] }]);
  }
  function removeSession(si: number) {
    setSessions((prev) => prev.filter((_, i) => i !== si));
  }

  async function save() {
    if (!plan) return;
    if (sessions.length === 0) return notify("Treino vazio", "Adicione ao menos uma sessão.");
    const workout: Workout = {
      split: split.trim() || "Treino",
      daysPerWeek: Math.min(7, Math.max(1, Number(days) || sessions.length)),
      sessions: sessions.map((s) => ({
        day: s.day.trim() || "Dia",
        focus: s.focus.trim(),
        exercises: s.exercises
          .filter((e) => e.name.trim())
          .map((e) => ({
            name: e.name.trim(),
            sets: Math.max(1, Number(e.sets) || 1),
            reps: e.reps.trim() || "10",
            restSeconds: Math.max(0, Number(e.restSeconds) || 0),
            notes: e.notes.trim(),
            ...(e.kind ? { kind: e.kind } : {}),
          })),
      })),
    };
    if (workout.sessions.some((s) => s.exercises.length === 0)) {
      return notify("Sessão sem exercício", "Cada sessão precisa de ao menos um exercício com nome.");
    }
    setSaving(true);
    try {
      await updatePlan(token!, { workout, diet: plan.diet });
      notify("Treino atualizado", "Suas mudanças foram salvas.", () => nav.goBack());
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", paddingHorizontal: spacing.gutter }}>
        <ErrorState message="Não foi possível carregar o treino." onRetry={load} />
      </View>
    );
  }
  if (!plan) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", paddingHorizontal: spacing.gutter }}>
        <Card level={2}>
          <Txt variant="titleCard">Gere um plano primeiro</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
            Na aba Início você gera ou importa seu plano — depois dá pra editar aqui.
          </Txt>
        </Card>
      </View>
    );
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      <Field label="Nome do treino (split)" value={split} onChangeText={setSplit} placeholder="Full body 3x, ABC…" />
      <Field label="Dias por semana" value={days} onChangeText={setDays} keyboardType="numeric" placeholder="3" />

      {sessions.map((s, si) => (
        <Card key={si} level={2}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Txt variant="titleCard">Sessão {si + 1}</Txt>
            <TouchableOpacity onPress={() => removeSession(si)} hitSlop={8}>
              <Txt variant="label" color={colors.danger}>
                Remover sessão
              </Txt>
            </TouchableOpacity>
          </View>
          <View style={{ height: spacing.sm }} />
          <Field label="Dia" value={s.day} onChangeText={(t) => setSess(si, { day: t })} placeholder="Dia A — Peito" />
          <Field label="Foco" value={s.focus} onChangeText={(t) => setSess(si, { focus: t })} placeholder="Peito e tríceps" />

          {s.exercises.map((e, ei) => (
            <Card key={ei} style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm }}>
                <Txt variant="label" color={colors.text2}>
                  Exercício {ei + 1}
                </Txt>
                <TouchableOpacity onPress={() => removeEx(si, ei)} hitSlop={8}>
                  <Txt variant="label" color={colors.text3}>
                    Remover
                  </Txt>
                </TouchableOpacity>
              </View>
              <Field value={e.name} onChangeText={(t) => setEx(si, ei, { name: t })} placeholder="Nome do exercício" />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Field label="Séries" value={e.sets} onChangeText={(t) => setEx(si, ei, { sets: t })} keyboardType="numeric" placeholder="3" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Reps" value={e.reps} onChangeText={(t) => setEx(si, ei, { reps: t })} placeholder="8-12" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Descanso (s)" value={e.restSeconds} onChangeText={(t) => setEx(si, ei, { restSeconds: t })} keyboardType="numeric" placeholder="60" />
                </View>
              </View>
              <Field label="Observações (opcional)" value={e.notes} onChangeText={(t) => setEx(si, ei, { notes: t })} placeholder="cadência, técnica…" />
            </Card>
          ))}

          <Button title="+ Adicionar exercício" variant="secondary" onPress={() => addEx(si)} />
        </Card>
      ))}

      <Button title="+ Adicionar sessão" variant="secondary" onPress={addSession} />
      <Button title="Salvar treino" onPress={save} loading={saving} size="lg" glow />
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
