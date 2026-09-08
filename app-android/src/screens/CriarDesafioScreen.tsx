import React, { useState } from "react";
import { View, Switch } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field, Chip } from "../components/ui";
import { notify } from "../lib/notify";
import { createChallenge, type ScoreMode } from "../api/challenges";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "CriarDesafio">;

const MODES: { id: ScoreMode; label: string }[] = [
  { id: "distance", label: "Distância (km)" },
  { id: "minutes", label: "Minutos" },
  { id: "checkins", label: "Treinos" },
];
const DURATIONS = [7, 14, 30];
const SPORTS: { id: string; label: string }[] = [
  { id: "", label: "Qualquer" },
  { id: "corrida", label: "Corrida" },
  { id: "musculacao", label: "Musculação" },
  { id: "ciclismo", label: "Ciclismo" },
  { id: "jiu_jitsu", label: "Jiu-jitsu" },
];

export function CriarDesafioScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [name, setName] = useState("");
  const [scoreMode, setScoreMode] = useState<ScoreMode>("distance");
  const [days, setDays] = useState(30);
  const [sportId, setSportId] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim()) {
      notify("Dê um nome ao desafio", "Ex.: Corrida do mês, 100 km em maio…");
      return;
    }
    setSaving(true);
    try {
      const c = await createChallenge(token!, {
        name: name.trim(),
        startAt: new Date().toISOString(),
        endAt: new Date(Date.now() + days * 86_400_000).toISOString(),
        scoreMode,
        sportIds: sportId ? [sportId] : [],
        visibility: isPublic ? "public" : "code",
      });
      notify("Desafio criado", `Código de convite: ${c.joinCode}\nCompartilhe com quem você quer chamar.`, () =>
        navigation.navigate("DesafioDetail", { id: c.id })
      );
    } catch (err) {
      notify("Não deu para criar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      <Card>
        <Field label="Nome do desafio" value={name} onChangeText={setName} placeholder="Corrida do mês" />

        <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
          Como pontua
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
          {MODES.map((m) => (
            <Chip key={m.id} label={m.label} active={scoreMode === m.id} onPress={() => setScoreMode(m.id)} />
          ))}
        </View>

        <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
          Duração
        </Txt>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}>
          {DURATIONS.map((d) => (
            <Chip key={d} label={`${d} dias`} active={days === d} onPress={() => setDays(d)} />
          ))}
        </View>

        <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
          Esporte que conta
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {SPORTS.map((s) => (
            <Chip key={s.id || "any"} label={s.label} active={sportId === s.id} onPress={() => setSportId(s.id)} />
          ))}
        </View>
      </Card>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Txt variant="bodyStrong">Público</Txt>
          <Txt variant="caption" color={colors.text3}>
            Aparece em "Descobrir". Desligado, só entra quem tem o código.
          </Txt>
        </View>
        <Switch value={isPublic} onValueChange={setIsPublic} trackColor={{ true: colors.lime, false: colors.line }} thumbColor={colors.text} />
      </View>

      <Button title="Criar desafio" onPress={create} loading={saving} size="lg" glow />
    </Screen>
  );
}
