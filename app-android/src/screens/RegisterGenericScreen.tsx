import React, { useState } from "react";
import { View, Switch } from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field } from "../components/ui";
import { createActivity } from "../api/activities";
import { colors, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterGeneric">;

export function RegisterGenericScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const [name, setName] = useState("");
  const [min, setMin] = useState("");
  const [description, setDescription] = useState("");
  const [metricLabel, setMetricLabel] = useState("");
  const [metricValue, setMetricValue] = useState("");
  const [share, setShare] = useState(false);
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      notify("Dê um nome à atividade", "Ex.: surf, skate, escalada…");
      return;
    }
    const minN = Number(min.replace(",", ".")) || 0;
    const customMetrics =
      metricLabel.trim() && metricValue.trim()
        ? [{ label: metricLabel.trim(), value: metricValue.trim() }]
        : undefined;

    setSaving(true);
    try {
      await createActivity(token!, {
        sportId,
        kind: "generic",
        durationSec: Math.round(minN * 60),
        payload: {
          activityName: name.trim(),
          description: description.trim() || undefined,
          customMetrics,
        },
        shareToFeed: share,
        caption: share ? caption.trim() || undefined : undefined,
      });
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
        <Field label="O que você fez?" value={name} onChangeText={setName} placeholder="Surf, skate, escalada…" />
        <Field label="Duração (min)" value={min} onChangeText={setMin} keyboardType="numeric" placeholder="45" />
        <Field label="Descrição (opcional)" value={description} onChangeText={setDescription} placeholder="Como foi?" multiline />

        <Txt variant="label" color={colors.text2} style={{ marginBottom: 6 }}>
          Sua métrica (opcional)
        </Txt>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1.4 }}>
            <Field value={metricLabel} onChangeText={setMetricLabel} placeholder="ondas, pegadas…" />
          </View>
          <View style={{ flex: 1 }}>
            <Field value={metricValue} onChangeText={setMetricValue} placeholder="12" />
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: spacing.md }}>
        <Txt variant="bodyStrong">Compartilhar no feed</Txt>
        <Switch value={share} onValueChange={setShare} trackColor={{ true: colors.lime, false: colors.line }} thumbColor={colors.text} />
      </View>
      {share ? <Field value={caption} onChangeText={setCaption} placeholder="Escreva uma legenda (opcional)" multiline /> : null}

      <Button title="Salvar atividade" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
