import React, { useState } from "react";
import { View, Switch, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field, Chip } from "../components/ui";
import { createActivity } from "../api/activities";
import { newPRMessage } from "../api/prs";
import { colors, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterClass">;

const SESSION_TYPES: { id: string; label: string }[] = [
  { id: "aula_completa", label: "Aula completa" },
  { id: "tecnica", label: "Técnica" },
  { id: "drill", label: "Drill" },
  { id: "sparring", label: "Sparring" },
  { id: "condicionamento", label: "Condicionamento" },
  { id: "competicao", label: "Competição" },
];

export function RegisterClassScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const [min, setMin] = useState("");
  const [sessionType, setSessionType] = useState<string | null>("aula_completa");
  const [gi, setGi] = useState(true);
  const [share, setShare] = useState(false);
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const minN = Number(min.replace(",", ".")) || 0;
    if (minN <= 0) {
      Alert.alert("Informe a duração", "Quantos minutos durou a aula/treino?");
      return;
    }
    setSaving(true);
    try {
      const res = await createActivity(token!, {
        sportId,
        kind: "class",
        durationSec: Math.round(minN * 60),
        payload: { modality: sportId, sessionType: sessionType ?? undefined, gi },
        shareToFeed: share,
        caption: share ? caption.trim() || undefined : undefined,
      });
      const msg = newPRMessage(res.meta.newPRs ?? []);
      if (msg) Alert.alert(msg.title, msg.body, [{ text: "Boa!", onPress: () => navigation.navigate("Tabs") }]);
      else navigation.navigate("Tabs");
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
        <Txt variant="titleScreen">{sportLabel(sportId)}</Txt>
      </View>

      <Card style={{ marginBottom: spacing.md }}>
        <Field label="Duração (min)" value={min} onChangeText={setMin} keyboardType="numeric" placeholder="60" />

        <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
          Tipo de sessão
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {SESSION_TYPES.map((t) => (
            <Chip
              key={t.id}
              label={t.label}
              active={sessionType === t.id}
              onPress={() => setSessionType(sessionType === t.id ? null : t.id)}
            />
          ))}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md }}>
          <Txt variant="bodyStrong">Com kimono (gi)</Txt>
          <Switch value={gi} onValueChange={setGi} trackColor={{ true: colors.lime, false: colors.line }} thumbColor={colors.text} />
        </View>
      </Card>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: spacing.md }}>
        <Txt variant="bodyStrong">Compartilhar no feed</Txt>
        <Switch value={share} onValueChange={setShare} trackColor={{ true: colors.lime, false: colors.line }} thumbColor={colors.text} />
      </View>
      {share ? <Field value={caption} onChangeText={setCaption} placeholder="Escreva uma legenda (opcional)" multiline /> : null}

      <Button title="Salvar treino" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
