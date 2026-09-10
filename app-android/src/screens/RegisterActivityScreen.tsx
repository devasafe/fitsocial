import React, { useState } from "react";
import { View, TextInput, TouchableOpacity } from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button } from "../components/ui";
import { SuggestField } from "../components/SuggestField";
import { createActivity } from "../api/activities";
import { searchExercises } from "../api/library";
import { lastEntries, type LastEntry } from "../api/checkins";
import { usePRCelebration } from "../components/PRCelebration";
import { usePerguntaDePrivacidade } from "../components/PrivacidadeTreinos";
import { colors, spacing, radius, sportColor } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterActivity">;

const STRENGTH_VARIANTS = ["musculacao", "calistenia", "powerlifting", "lpo"];

interface SetForm {
  weightKg: string;
  reps: string;
}
interface ExerciseForm {
  name: string;
  sets: SetForm[];
}

// Campo numérico compacto (carga/reps). Número grande, alvo de toque generoso.
function NumInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.text3}
      keyboardType="numeric"
      style={{
        flex: 1,
        backgroundColor: colors.surface2,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.chip,
        paddingVertical: 12,
        paddingHorizontal: spacing.md,
        color: colors.text,
        fontSize: 20,
        fontVariant: ["tabular-nums"],
        textAlign: "center",
      }}
    />
  );
}

export function RegisterActivityScreen({ route, navigation }: Props) {
  const { sportId, prefill } = route.params;
  const { token } = useAuth();
  const celebratePR = usePRCelebration();
  const perguntarPrivacidade = usePerguntaDePrivacidade();
  const [exercises, setExercises] = useState<ExerciseForm[]>(
    prefill && prefill.length ? prefill : [{ name: "", sets: [{ weightKg: "", reps: "" }] }]
  );
  const [last, setLast] = useState<Record<string, LastEntry>>({}); // última vez por exercício
  const [saving, setSaving] = useState(false);

  // Ao escolher um exercício, mostra a última vez e pré-preenche a 1ª série se vazia.
  async function pickExercise(ei: number, name: string) {
    setExercise(ei, { name });
    if (last[name]) return;
    try {
      const e = await lastEntries(token!, [name]);
      const le = e[name];
      if (!le) return;
      setLast((prev) => ({ ...prev, [name]: le }));
      setExercises((prev) =>
        prev.map((ex, idx) => {
          if (idx !== ei) return ex;
          const s0 = ex.sets[0];
          if (!s0 || s0.weightKg !== "" || s0.reps !== "") return ex;
          const sets = [...ex.sets];
          sets[0] = { weightKg: le.weightKg ? String(le.weightKg) : "", reps: le.reps ? String(le.reps) : "" };
          return { ...ex, sets };
        })
      );
    } catch {
      /* sem dado da última vez — segue normal */
    }
  }

  function setExercise(i: number, patch: Partial<ExerciseForm>) {
    setExercises((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function setSet(ei: number, si: number, patch: Partial<SetForm>) {
    setExercises((prev) =>
      prev.map((e, idx) =>
        idx === ei ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : e
      )
    );
  }
  function addSet(ei: number) {
    setExercises((prev) =>
      prev.map((e, idx) => (idx === ei ? { ...e, sets: [...e.sets, { weightKg: "", reps: "" }] } : e))
    );
  }
  function addExercise() {
    setExercises((prev) => [...prev, { name: "", sets: [{ weightKg: "", reps: "" }] }]);
  }

  async function save() {
    const payloadExercises = exercises
      .filter((e) => e.name.trim())
      .map((e) => ({
        name: e.name.trim(),
        sets: e.sets.map((s) => ({
          type: "valida" as const,
          weightKg: Number(s.weightKg.replace(",", ".")) || 0,
          reps: s.reps ? Number(s.reps) : null,
        })),
      }));

    if (payloadExercises.length === 0) {
      notify("Adicione um exercício", "Dê um nome a pelo menos um exercício para salvar.");
      return;
    }

    setSaving(true);
    try {
      const variant = STRENGTH_VARIANTS.includes(sportId) ? sportId : "musculacao";
      const res = await createActivity(token!, {
        sportId,
        kind: "strength",
        payload: { variant, exercises: payloadExercises },
      });
      celebratePR(res.meta.newPRs ?? []);
      // Só aparece para quem ainda não escolheu; o treino já está salvo.
      perguntarPrivacidade();
      navigation.navigate("CreatePost", { activity: res.data });
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll underHeader>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.section }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: sportColor(sportId) }} />
        <Txt variant="titleScreen">Novo treino</Txt>
      </View>

      {exercises.map((ex, ei) => (
        <Card key={ei} sport={sportId} style={{ marginBottom: spacing.card }}>
          <SuggestField
            label={`Exercício ${ei + 1}`}
            value={ex.name}
            onChangeText={(t) => setExercise(ei, { name: t })}
            placeholder="Supino reto, agachamento livre…"
            fetchSuggestions={(q) =>
              searchExercises(token!, q).then((list) =>
                list.map((e) => ({ id: e.id, label: e.name, sub: `${e.muscle} · ${e.equipment}` }))
              )
            }
            onPick={(s) => pickExercise(ei, s.label)}
          />
          {last[ex.name] && (last[ex.name].weightKg || last[ex.name].reps) ? (
            <Txt variant="caption" color={colors.lime} style={{ marginTop: -6, marginBottom: 6 }}>
              última vez: {last[ex.name].weightKg || 0} kg × {last[ex.name].reps || 0}
            </Txt>
          ) : null}
          <Txt variant="label" color={colors.text2} style={{ marginBottom: 6 }}>
            Séries — carga (kg) e repetições
          </Txt>
          {ex.sets.map((s, si) => (
            <View key={si} style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm }}>
              <NumInput value={s.weightKg} onChangeText={(t) => setSet(ei, si, { weightKg: t })} placeholder="kg" />
              <NumInput value={s.reps} onChangeText={(t) => setSet(ei, si, { reps: t })} placeholder="reps" />
            </View>
          ))}
          <TouchableOpacity onPress={() => addSet(ei)} activeOpacity={0.7} style={{ paddingVertical: spacing.sm }}>
            <Txt variant="label" color={colors.lime}>
              + Adicionar série
            </Txt>
          </TouchableOpacity>
        </Card>
      ))}

      <Button title="+ Adicionar exercício" variant="secondary" onPress={addExercise} style={{ marginBottom: spacing.section }} />

      <Button title="Salvar treino" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
