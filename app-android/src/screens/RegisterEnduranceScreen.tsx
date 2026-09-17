import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field } from "../components/ui";
import { createActivity, getLastActivity, type Activity } from "../api/activities";
import { useConclusaoDeTreino } from "../lib/aoConcluirTreino";
import { chaveDoTreino, limparChaveDoTreino } from "../lib/chaveDoTreino";
import { colors, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";
import { SportIcon } from "../components/SportIcon";

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
  const concluirTreino = useConclusaoDeTreino();
  const label = sportLabel(sportId);
  const [km, setKm] = useState("");
  const [min, setMin] = useState("");
  const [last, setLast] = useState<Activity | null>(null);
  const [saving, setSaving] = useState(false);
  // A chave nasce quando a tela abre — não quando "Salvar" é tocado — ver
  // `chaveDoTreino`. Por esporte: é o que essa tela registra (o registro
  // manual; a gravação com GPS tem a própria, em `LiveTrackScreen`).
  const clientKeyRef = useRef<string | null>(null);
  const contextoDaChave = `endurance:${sportId}`;

  useEffect(() => {
    let alive = true;
    chaveDoTreino(contextoDaChave).then((k) => {
      if (alive) clientKeyRef.current = k ?? null;
    });
    return () => {
      alive = false;
    };
  }, [contextoDaChave]);

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
      const clientKey = clientKeyRef.current ?? (await chaveDoTreino(contextoDaChave));
      const res = await createActivity(token!, {
        sportId,
        kind: "endurance",
        durationSec: Math.round(minN * 60),
        payload: { distanceM: Math.round(kmN * 1000) },
        clientKey,
      });
      await limparChaveDoTreino(contextoDaChave);
      // Sai do armazenamento E da memória: sem zerar o ref, um segundo
      // treino registrado sem sair desta tela reusaria a MESMA chave, e o
      // servidor o leria como reenvio do primeiro — sumiria em silêncio.
      clientKeyRef.current = null;
      concluirTreino(res.data, res.meta.newPRs ?? []);
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll underHeader>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.section }}>
        <SportIcon sportId={sportId} size={22} />
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
