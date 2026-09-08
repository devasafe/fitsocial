import React, { useState } from "react";
import { View, Switch } from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field, Chip } from "../components/ui";
import { SuggestField } from "../components/SuggestField";
import { createActivity, type CreateActivityInput } from "../api/activities";
import { searchWods, type WodBenchmark } from "../api/library";
import { usePRCelebration } from "../components/PRCelebration";
import { colors, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterWod">;

type WodPayload = Extract<CreateActivityInput, { kind: "wod" }>["payload"];
type ScoreType = "for_time" | "amrap" | "for_reps" | "max_load";
const SCORE_TYPES: { id: ScoreType; label: string }[] = [
  { id: "for_time", label: "Por tempo" },
  { id: "amrap", label: "AMRAP" },
  { id: "for_reps", label: "Por reps" },
  { id: "max_load", label: "Carga máxima" },
];
const LEVELS: { id: "rx" | "scaled" | "adaptado"; label: string }[] = [
  { id: "rx", label: "Rx" },
  { id: "scaled", label: "Scaled" },
  { id: "adaptado", label: "Adaptado" },
];

export function RegisterWodScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const celebratePR = usePRCelebration();
  const [name, setName] = useState("");
  const [level, setLevel] = useState<"rx" | "scaled" | "adaptado">("rx");
  const [scoreType, setScoreType] = useState<ScoreType>("for_time");
  const [min, setMin] = useState("");
  const [sec, setSec] = useState("");
  const [num, setNum] = useState(""); // rounds / reps / carga
  const [prescription, setPrescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [share, setShare] = useState(false);
  const [caption, setCaption] = useState("");

  function toScoreType(wodType: string): ScoreType {
    if (wodType === "amrap") return "amrap";
    if (wodType === "max_load") return "max_load";
    if (wodType === "for_reps" || wodType === "tabata" || wodType === "emom") return "for_reps";
    return "for_time"; // for_time / rft / chipper
  }

  async function save() {
    if (!name.trim()) {
      notify("Nome do WOD", "Diga qual foi o WOD (ex.: Fran) ou 'WOD do dia'.");
      return;
    }
    const payload: WodPayload = { name: name.trim(), scoreType, level };
    if (scoreType === "for_time") payload.resultTimeSec = (Number(min) || 0) * 60 + (Number(sec) || 0);
    if (scoreType === "amrap") payload.resultRounds = Number(num) || 0;
    if (scoreType === "for_reps") payload.resultReps = Number(num) || 0;
    if (scoreType === "max_load") payload.resultLoadKg = Number(num.replace(",", ".")) || 0;

    setSaving(true);
    try {
      const res = await createActivity(token!, {
        sportId,
        kind: "wod",
        payload,
        shareToFeed: share,
        caption: share ? caption.trim() || undefined : undefined,
      });
      celebratePR(res.meta.newPRs ?? []);
      navigation.navigate("Tabs");
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
        <Txt variant="titleScreen">{sportLabel(sportId)}</Txt>
      </View>

      <Card style={{ marginBottom: spacing.md }}>
        <SuggestField
          label="Nome do WOD"
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (!t) setPrescription("");
          }}
          placeholder="Fran, Cindy, WOD do dia…"
          fetchSuggestions={(q) =>
            searchWods(token!, q).then((list) =>
              list.map((w) => ({ id: w.id, label: w.name, sub: w.prescription, data: w }))
            )
          }
          onPick={(s) => {
            setName(s.label);
            const w = s.data as WodBenchmark | undefined;
            if (w) {
              setScoreType(toScoreType(w.scoreType));
              setPrescription(w.prescription);
            }
          }}
        />
        {prescription ? (
          <Txt variant="caption" color={colors.text2} style={{ marginTop: -spacing.sm, marginBottom: spacing.md }}>
            {prescription}
          </Txt>
        ) : null}

        <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
          Nível
        </Txt>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}>
          {LEVELS.map((l) => (
            <Chip key={l.id} label={l.label} active={level === l.id} onPress={() => setLevel(l.id)} />
          ))}
        </View>

        <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
          Como pontua
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
          {SCORE_TYPES.map((s) => (
            <Chip key={s.id} label={s.label} active={scoreType === s.id} onPress={() => setScoreType(s.id)} />
          ))}
        </View>

        {scoreType === "for_time" ? (
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Field label="Minutos" value={min} onChangeText={setMin} keyboardType="numeric" placeholder="4" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Segundos" value={sec} onChangeText={setSec} keyboardType="numeric" placeholder="12" />
            </View>
          </View>
        ) : (
          <Field
            label={scoreType === "amrap" ? "Rounds" : scoreType === "for_reps" ? "Repetições" : "Carga (kg)"}
            value={num}
            onChangeText={setNum}
            keyboardType="numeric"
            placeholder={scoreType === "max_load" ? "60" : "12"}
          />
        )}
      </Card>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: spacing.md }}>
        <Txt variant="bodyStrong">Compartilhar no feed</Txt>
        <Switch value={share} onValueChange={setShare} trackColor={{ true: colors.lime, false: colors.line }} thumbColor={colors.text} />
      </View>
      {share ? <Field value={caption} onChangeText={setCaption} placeholder="Escreva uma legenda (opcional)" multiline /> : null}

      <Button title="Salvar WOD" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
