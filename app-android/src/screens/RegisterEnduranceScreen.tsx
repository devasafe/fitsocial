import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field } from "../components/ui";
import { createActivity, getLastActivity, type Activity } from "../api/activities";
import { usePRCelebration } from "../components/PRCelebration";
import { usePerguntaDePrivacidade } from "../components/PrivacidadeTreinos";
import { colors, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterEndurance">;

// Esportes onde faz sentido gravar com GPS.
const GPS_SPORTS = new Set(["corrida", "trail", "caminhada", "ciclismo", "natacao"]);

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
  const celebratePR = usePRCelebration();
  const perguntarPrivacidade = usePerguntaDePrivacidade();
  const label = sportLabel(sportId);
  const [km, setKm] = useState("");
  const [min, setMin] = useState("");
  const [last, setLast] = useState<Activity | null>(null);
  const [saving, setSaving] = useState(false);

  const kmN = Number(km.replace(",", ".")) || 0;
  const minN = Number(min.replace(",", ".")) || 0;

  // Última vez neste esporte: dica + pré-preenchimento dos campos vazios.
  useEffect(() => {
    let alive = true;
    getLastActivity(token!, sportId, "endurance")
      .then((a) => {
        if (!alive || !a) return;
        setLast(a);
        const lastKm = a.metrics?.distanceKm ? Math.round(a.metrics.distanceKm * 100) / 100 : 0;
        const lastMin = a.durationSec ? Math.round(a.durationSec / 60) : 0;
        if (lastKm) setKm((prev) => (prev === "" ? String(lastKm) : prev));
        if (lastMin) setMin((prev) => (prev === "" ? String(lastMin) : prev));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sportId, token]);

  const lastKmN = last?.metrics?.distanceKm ? Math.round(last.metrics.distanceKm * 100) / 100 : 0;
  const lastMinN = last?.durationSec ? Math.round(last.durationSec / 60) : 0;
  const lastHint =
    lastKmN || lastMinN
      ? `última vez: ${[lastKmN ? `${lastKmN} km` : null, lastMinN ? `${lastMinN} min` : null].filter(Boolean).join(" em ")}`
      : null;

  async function save() {
    if (kmN <= 0 && minN <= 0) {
      notify("Preencha o treino", "Informe a distância e/ou o tempo.");
      return;
    }
    setSaving(true);
    try {
      const res = await createActivity(token!, {
        sportId,
        kind: "endurance",
        durationSec: Math.round(minN * 60),
        payload: { distanceM: Math.round(kmN * 1000) },
      });
      celebratePR(res.meta.newPRs ?? []);
      // Só aparece para quem ainda não escolheu; o treino já está salvo.
      perguntarPrivacidade();
      navigation.navigate("CreatePost", { activity: res.data, newPRs: res.meta.newPRs ?? [] });
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
        <Txt variant="titleScreen">{label}</Txt>
      </View>

      {GPS_SPORTS.has(sportId) ? (
        <>
          <Button
            title="Gravar com GPS"
            onPress={() => navigation.navigate("LiveTrack", { sportId })}
            size="lg"
            glow
            style={{ marginBottom: spacing.md }}
          />
          <Txt variant="label" color={colors.text3} style={{ marginBottom: spacing.md, textAlign: "center" }}>
            ou registre manualmente
          </Txt>
        </>
      ) : null}

      <Card style={{ marginBottom: spacing.section }}>
        {lastHint ? (
          <Txt variant="caption" color={colors.lime} style={{ marginBottom: spacing.sm }}>
            {lastHint}
          </Txt>
        ) : null}
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

      <Button title="Salvar treino" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
