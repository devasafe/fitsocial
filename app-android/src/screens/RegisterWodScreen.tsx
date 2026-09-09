import React, { useState } from "react";
import { View, TextInput, TouchableOpacity } from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field, Chip } from "../components/ui";
import { SuggestField } from "../components/SuggestField";
import { createActivity, type CreateActivityInput } from "../api/activities";
import { searchWods, type WodBenchmark } from "../api/library";
import { usePRCelebration } from "../components/PRCelebration";
import { colors, spacing, radius, sportColor } from "../theme";
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

interface MovForm {
  name: string;
  kg: string;
  reps: string;
  tempo: string; // "mm:ss" ou segundos
}

const movInput = {
  flex: 1,
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.chip,
  paddingHorizontal: spacing.md,
  paddingVertical: 10,
  color: colors.text,
  fontSize: 15,
} as const;
const movCompact = { textAlign: "center", fontSize: 14 } as const;

// Aceita "mm:ss" ou segundos puros. Vazio/zero → null.
function parseTempo(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  if (v.includes(":")) {
    const [m, sec] = v.split(":");
    const total = (Number(m) || 0) * 60 + (Number(sec) || 0);
    return total > 0 ? total : null;
  }
  const n = Number(v);
  return Number.isNaN(n) || n <= 0 ? null : Math.round(n);
}

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
  const [movements, setMovements] = useState<MovForm[]>([]);
  const [saving, setSaving] = useState(false);

  function setMov(i: number, patch: Partial<MovForm>) {
    setMovements((prev) => prev.map((mv, idx) => (idx === i ? { ...mv, ...patch } : mv)));
  }
  function addMov() {
    setMovements((prev) => [...prev, { name: "", kg: "", reps: "", tempo: "" }]);
  }
  function removeMov(i: number) {
    setMovements((prev) => prev.filter((_, idx) => idx !== i));
  }

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

    // Movimentos (composição do WOD) — só linhas com nome; campos vazios viram ausentes.
    const movs = movements
      .filter((mv) => mv.name.trim())
      .map((mv) => {
        const kg = Number(mv.kg.replace(",", "."));
        const reps = Number(mv.reps);
        const t = parseTempo(mv.tempo);
        return {
          name: mv.name.trim(),
          ...(mv.kg.trim() && !Number.isNaN(kg) ? { loadKg: kg } : {}),
          ...(mv.reps.trim() && !Number.isNaN(reps) ? { reps } : {}),
          ...(t != null ? { timeSec: t } : {}),
        };
      });
    if (movs.length) payload.movements = movs;

    setSaving(true);
    try {
      const res = await createActivity(token!, {
        sportId,
        kind: "wod",
        payload,
      });
      celebratePR(res.meta.newPRs ?? []);
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

      {/* Movimentos — composição do WOD (enxuto, tudo opcional exceto o nome) */}
      <Card style={{ marginBottom: spacing.md }}>
        <Txt variant="titleCard" style={{ marginBottom: 2 }}>
          Movimentos
        </Txt>
        <Txt variant="caption" color={colors.text3} style={{ marginBottom: spacing.md }}>
          O que teve no WOD — carga, reps e tempo por movimento (o que se aplicar).
        </Txt>

        {movements.map((mv, i) => (
          <View key={i} style={{ marginBottom: spacing.md, gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <TextInput
                value={mv.name}
                onChangeText={(t) => setMov(i, { name: t })}
                placeholder={`Movimento ${i + 1} (ex.: Back Squat)`}
                placeholderTextColor={colors.text3}
                style={movInput}
              />
              <TouchableOpacity onPress={() => removeMov(i)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
                <Txt variant="titleCard" color={colors.text3}>
                  ✕
                </Txt>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <TextInput value={mv.kg} onChangeText={(t) => setMov(i, { kg: t })} placeholder="carga (kg)" placeholderTextColor={colors.text3} keyboardType="numeric" style={[movInput, movCompact]} />
              <TextInput value={mv.reps} onChangeText={(t) => setMov(i, { reps: t })} placeholder="reps" placeholderTextColor={colors.text3} keyboardType="numeric" style={[movInput, movCompact]} />
              <TextInput value={mv.tempo} onChangeText={(t) => setMov(i, { tempo: t })} placeholder="tempo (mm:ss)" placeholderTextColor={colors.text3} style={[movInput, movCompact]} />
            </View>
          </View>
        ))}

        <Button title="+ Adicionar movimento" variant="secondary" onPress={addMov} />
      </Card>

      <Button title="Salvar WOD" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
