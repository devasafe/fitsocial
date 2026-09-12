// Hub Progresso — responde "estou melhorando?". Resumo (novo) + Evolução/Recordes/Atividades
// reusando as telas existentes com embedded, sob um header + segmented.
import React, { useCallback, useState } from "react";
import { View, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { Txt, MetricTile, Card, ErrorState } from "../components/ui";
import { SegmentedControl, type Segment } from "../components/SegmentedControl";
import { HistoryScreen } from "./HistoryScreen";
import { MeusPRsScreen } from "./MeusPRsScreen";
import { MinhasAtividadesScreen } from "./MinhasAtividadesScreen";
import { getCheckInStats, type CheckInStats } from "../api/checkins";
import { listarExercicios, type ExercicioNaLista } from "../api/evolucao";
import { listPRs, prTypeLabel, prValueLabel, type PersonalRecord } from "../api/prs";
import { coachLine } from "../lib/coachContext";
import { colors, spacing } from "../theme";

// O exercício que mais subiu na janela. O servidor já calcula o delta de cada
// um — o resumo só escolhe o maior, e assim diz o mesmo que a aba Evolução.
function maiorEvolucao(exercicios: ExercicioNaLista[]): { name: string; delta: number } | null {
  let melhor: { name: string; delta: number } | null = null;
  for (const e of exercicios) {
    if (e.delta == null || e.delta <= 0) continue;
    if (!melhor || e.delta > melhor.delta) melhor = { name: e.nome, delta: e.delta };
  }
  return melhor;
}

type Seg = "resumo" | "evolucao" | "recordes" | "atividades";

const SEGMENTS: Segment<Seg>[] = [
  { key: "resumo", label: "Resumo" },
  { key: "evolucao", label: "Evolução" },
  { key: "recordes", label: "Recordes" },
  { key: "atividades", label: "Atividades" },
];

// Painel emocional simples: sequência (herói) + semana/total + total de recordes.
// O enquadramento emocional mais rico (Δ %, "novo PR") vem no polimento (P3).
function Resumo() {
  const { token } = useAuth();
  const [stats, setStats] = useState<CheckInStats | null>(null);
  const [prs, setPrs] = useState<PersonalRecord[]>([]);
  const [gain, setGain] = useState<{ name: string; delta: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, prsRes, lista] = await Promise.all([
        getCheckInStats(token!),
        listPRs(token!),
        listarExercicios(token!, 90),
      ]);
      setStats(s.stats);
      setPrs([...prsRes].sort((a, b) => b.achievedAt.localeCompare(a.achievedAt)));
      setGain(maiorEvolucao(lista));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={{ paddingTop: spacing.xl, alignItems: "center" }}>
        <ActivityIndicator color={colors.lime} />
      </View>
    );
  }

  if (error || !stats) {
    return (
      <View style={{ paddingHorizontal: spacing.gutter, paddingTop: spacing.md }}>
        <ErrorState
          message="Não foi possível carregar seu resumo."
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      </View>
    );
  }

  const recentPRs = prs.slice(0, 2);

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.card }}>
      {/* Sequência — número herói + voz do coach */}
      <Card level={2}>
        <Txt variant="label" color={colors.text2}>
          Sua sequência
        </Txt>
        <Txt variant="metricHero" tabular color={colors.lime}>
          {stats.streak}
          <Txt variant="titleSection" color={colors.text2}>
            {" "}
            {stats.streak === 1 ? "dia" : "dias"}
          </Txt>
        </Txt>
        <Txt variant="body" color={colors.text2}>
          {coachLine(stats)}
        </Txt>
      </Card>

      <View style={{ flexDirection: "row", gap: spacing.card }}>
        <MetricTile value={String(stats.week)} label="na semana" style={{ flex: 1 }} />
        <MetricTile value={String(stats.total)} label="no total" style={{ flex: 1 }} />
        <MetricTile value={String(prs.length)} label="recordes" style={{ flex: 1 }} />
      </View>

      {/* Maior evolução — Δ real de carga */}
      {gain && (
        <Card sport="musculacao">
          <Txt variant="label" color={colors.text2}>
            Maior evolução
          </Txt>
          <Txt variant="titleCard" style={{ marginTop: 2 }}>
            {gain.name}
          </Txt>
          <Txt variant="metricMd" tabular color={colors.lime} style={{ marginTop: 2 }}>
            +{Math.round(gain.delta * 10) / 10} kg
            <Txt variant="label" color={colors.text2}>
              {"  "}desde o começo
            </Txt>
          </Txt>
        </Card>
      )}

      {/* Recordes recentes */}
      {recentPRs.length > 0 && (
        <Card>
          <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
            Recordes recentes
          </Txt>
          {recentPRs.map((p) => (
            <View
              key={p.id}
              style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }}
            >
              <View style={{ flex: 1 }}>
                <Txt variant="body">{p.exerciseName}</Txt>
                <Txt variant="caption" color={colors.text3}>
                  {prTypeLabel(p.type, p.repRange)}
                </Txt>
              </View>
              <Txt variant="bodyStrong" tabular color={colors.lime}>
                {prValueLabel(p.type, p.value, p.unit)}
              </Txt>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

export function ProgressoScreen() {
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<Seg>("resumo");
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.gutter }}>
        <Txt variant="titleScreen">Progresso</Txt>
        <SegmentedControl
          segments={SEGMENTS}
          value={seg}
          onChange={setSeg}
          style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}
        />
      </View>
      <View style={{ flex: 1 }}>
        {seg === "resumo" && <Resumo />}
        {seg === "evolucao" && <HistoryScreen embedded />}
        {seg === "recordes" && <MeusPRsScreen embedded />}
        {seg === "atividades" && <MinhasAtividadesScreen embedded />}
      </View>
    </View>
  );
}
