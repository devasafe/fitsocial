import React, { useState } from "react";
import { View, TextInput, TouchableOpacity, Switch, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field } from "../components/ui";
import { SuggestField } from "../components/SuggestField";
import { createActivity } from "../api/activities";
import { searchExercises } from "../api/library";
import { newPRMessage } from "../api/prs";
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
  const { sportId } = route.params;
  const { token } = useAuth();
  const [exercises, setExercises] = useState<ExerciseForm[]>([
    { name: "", sets: [{ weightKg: "", reps: "" }] },
  ]);
  const [share, setShare] = useState(false);
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);

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
      Alert.alert("Adicione um exercício", "Dê um nome a pelo menos um exercício para salvar.");
      return;
    }

    setSaving(true);
    try {
      const variant = STRENGTH_VARIANTS.includes(sportId) ? sportId : "musculacao";
      const res = await createActivity(token!, {
        sportId,
        kind: "strength",
        payload: { variant, exercises: payloadExercises },
        shareToFeed: share,
        caption: share ? caption.trim() || undefined : undefined,
      });
      const msg = newPRMessage(res.meta.newPRs ?? []);
      if (msg) {
        Alert.alert(msg.title, msg.body, [{ text: "Boa!", onPress: () => navigation.navigate("Tabs") }]);
      } else {
        navigation.navigate("Tabs");
      }
    } catch (err) {
      Alert.alert("Não deu para salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll>
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
            onPick={(s) => setExercise(ei, { name: s.label })}
          />
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

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.md,
        }}
      >
        <Txt variant="bodyStrong">Compartilhar no feed</Txt>
        <Switch
          value={share}
          onValueChange={setShare}
          trackColor={{ true: colors.lime, false: colors.line }}
          thumbColor={colors.text}
        />
      </View>
      {share ? (
        <Field
          value={caption}
          onChangeText={setCaption}
          placeholder="Escreva uma legenda (opcional)"
          multiline
        />
      ) : null}

      <Button title="Salvar treino" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
