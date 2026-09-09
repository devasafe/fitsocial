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
import { listPRs } from "../api/prs";
import { colors, spacing } from "../theme";

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
  const [prCount, setPrCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, prs] = await Promise.all([getCheckInStats(token!), listPRs(token!)]);
      setStats(s.stats);
      setPrCount(prs.length);
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

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.card }}>
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
          {stats.streak > 0 ? "seguidos treinando — mantenha o ritmo." : "comece hoje uma nova sequência."}
        </Txt>
      </Card>

      <View style={{ flexDirection: "row", gap: spacing.card }}>
        <MetricTile value={String(stats.week)} label="na semana" style={{ flex: 1 }} />
        <MetricTile value={String(stats.total)} label="no total" style={{ flex: 1 }} />
        <MetricTile value={String(prCount)} label="recordes" style={{ flex: 1 }} />
      </View>
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
