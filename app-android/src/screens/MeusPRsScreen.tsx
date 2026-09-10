import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, ActivityIndicator, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, ErrorState } from "../components/ui";
import { EmptyState } from "../components/EmptyState";
import { listPRs, prTypeLabel, prValueLabel, type PersonalRecord } from "../api/prs";
import { colors, spacing } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

const TYPE_ORDER: Record<string, number> = {
  carga_max: 0,
  rm_estimado: 1,
  carga_faixa: 2,
  best_dist: 0,
  best_time: 1,
  aulas: 0,
  horas: 1,
};

export function MeusPRsScreen(_props: { embedded?: boolean } = {}) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [prs, setPRs] = useState<PersonalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listPRs(token!)
      .then((r) => {
        setPRs(r);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const byExercise = useMemo(() => {
    const m = new Map<string, PersonalRecord[]>();
    for (const p of prs) {
      const arr = m.get(p.exerciseName) ?? [];
      arr.push(p);
      m.set(p.exerciseName, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));
    }
    return [...m.entries()];
  }, [prs]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      {/* Benchmark é recorde também, mas de outra natureza: um WOD repetido ao
          longo do tempo, não uma carga máxima. Fica aqui perto, em tela
          própria — misturar as duas listas confundiria as duas. */}
      <TouchableOpacity onPress={() => nav.navigate("Benchmarks")} activeOpacity={0.85}>
        <Card level={2}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Txt variant="titleCard">Meus benchmarks</Txt>
              <Txt variant="body" color={colors.text2} style={{ marginTop: 2 }}>
                Fran, Cindy, Murph — e quanto você melhorou em cada um.
              </Txt>
            </View>
            <Txt variant="titleCard" color={colors.text3}>›</Txt>
          </View>
        </Card>
      </TouchableOpacity>

      {error && byExercise.length === 0 ? (
        <ErrorState message="Não foi possível carregar seus recordes." onRetry={load} />
      ) : byExercise.length === 0 ? (
        <EmptyState
          icon="🏆"
          title="Nenhum recorde ainda"
          description="Registre um treino de força e seus recordes de carga e 1RM aparecem aqui."
          actionLabel="Registrar treino"
          onAction={() => nav.navigate("Registrar")}
        />
      ) : (
        byExercise.map(([exercise, records]) => {
          const header = sportLabel(exercise);
          return (
            <Card key={exercise} sport={records[0].sportId}>
              <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
                {header}
              </Txt>
              {records.map((r) => (
                <View
                  key={r.id}
                  style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingVertical: 6 }}
                >
                  <Txt variant="label" color={colors.text2}>
                    {prTypeLabel(r.type, r.repRange)}
                  </Txt>
                  <Txt variant="metricMd" tabular>
                    {prValueLabel(r.type, r.value, r.unit)}
                  </Txt>
                </View>
              ))}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
