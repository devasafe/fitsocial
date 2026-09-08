import React, { useState } from "react";
import { View, Switch, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field } from "../components/ui";
import { createActivity } from "../api/activities";
import { newPRMessage } from "../api/prs";
import { colors, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterEndurance">;

// Ritmo em mm:ss por km a partir de km e minutos (só exibição).
function paceLabel(km: number, min: number): string {
  if (km <= 0 || min <= 0) return "—";
  const secPerKm = (min * 60) / km;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export function RegisterEnduranceScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const label = sportLabel(sportId);
  const [km, setKm] = useState("");
  const [min, setMin] = useState("");
  const [share, setShare] = useState(false);
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);

  const kmN = Number(km.replace(",", ".")) || 0;
  const minN = Number(min.replace(",", ".")) || 0;

  async function save() {
    if (kmN <= 0 && minN <= 0) {
      Alert.alert("Preencha o treino", "Informe a distância e/ou o tempo.");
      return;
    }
    setSaving(true);
    try {
      const res = await createActivity(token!, {
        sportId,
        kind: "endurance",
        durationSec: Math.round(minN * 60),
        payload: { distanceM: Math.round(kmN * 1000) },
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
        <Txt variant="titleScreen">{label}</Txt>
      </View>

      <Card style={{ marginBottom: spacing.section }}>
        <View style={{ flexDirection: "row", gap: spacing.card }}>
          <View style={{ flex: 1 }}>
            <Field label="Distância (km)" value={km} onChangeText={setKm} keyboardType="numeric" placeholder="5" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Tempo (min)" value={min} onChangeText={setMin} keyboardType="numeric" placeholder="30" />
          </View>
        </View>
        <Txt variant="label" color={colors.text2}>
          Ritmo médio
        </Txt>
        <Txt variant="metricMd" tabular color={sportColor(sportId)}>
          {paceLabel(kmN, minN)}
        </Txt>
      </Card>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
        <Txt variant="bodyStrong">Compartilhar no feed</Txt>
        <Switch value={share} onValueChange={setShare} trackColor={{ true: colors.lime, false: colors.line }} thumbColor={colors.text} />
      </View>
      {share ? <Field value={caption} onChangeText={setCaption} placeholder="Escreva uma legenda (opcional)" multiline /> : null}

      <Button title="Salvar treino" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
