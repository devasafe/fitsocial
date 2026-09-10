import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field } from "../components/ui";
import { createActivity, getLastActivity, type Activity } from "../api/activities";
import { usePerguntaDePrivacidade } from "../components/PrivacidadeTreinos";
import { colors, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterGeneric">;

export function RegisterGenericScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const perguntarPrivacidade = usePerguntaDePrivacidade();
  const [name, setName] = useState("");
  const [min, setMin] = useState("");
  const [description, setDescription] = useState("");
  const [metricLabel, setMetricLabel] = useState("");
  const [metricValue, setMetricValue] = useState("");
  const [lastMin, setLastMin] = useState(0);
  const [saving, setSaving] = useState(false);

  // Última vez neste esporte: dica + pré-preenchimento da duração se vazia.
  useEffect(() => {
    let alive = true;
    getLastActivity(token!, sportId, "generic")
      .then((a: Activity | null) => {
        if (!alive || !a) return;
        const m = a.metrics?.minutes ? Math.round(a.metrics.minutes) : a.durationSec ? Math.round(a.durationSec / 60) : 0;
        if (!m) return;
        setLastMin(m);
        setMin((prev) => (prev === "" ? String(m) : prev));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sportId, token]);

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
      const res = await createActivity(token!, {
        sportId,
        kind: "generic",
        durationSec: Math.round(minN * 60),
        payload: {
          activityName: name.trim(),
          description: description.trim() || undefined,
          customMetrics,
        },
      });
      // Esta tela vai direto para publicar, então a pergunta vem antes de sair
      // — senão quem registra só por aqui nunca seria perguntado.
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
        <Txt variant="titleScreen">{sportLabel(sportId)}</Txt>
      </View>

      <Card style={{ marginBottom: spacing.md }}>
        {lastMin ? (
          <Txt variant="caption" color={colors.lime} style={{ marginBottom: spacing.sm }}>
            última vez: {lastMin} min
          </Txt>
        ) : null}
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

      <Button title="Salvar atividade" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
