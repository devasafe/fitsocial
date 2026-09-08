import React, { useEffect, useMemo, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card } from "../components/ui";
import { listPRs, prTypeLabel, type PersonalRecord } from "../api/prs";
import { colors, spacing } from "../theme";

const TYPE_ORDER: Record<string, number> = { carga_max: 0, rm_estimado: 1, carga_faixa: 2 };

export function MeusPRsScreen() {
  const { token } = useAuth();
  const [prs, setPRs] = useState<PersonalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPRs(token!)
      .then(setPRs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

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
    <Screen scroll contentStyle={{ gap: spacing.card }}>
      {byExercise.length === 0 ? (
        <Card level={2} style={{ marginTop: spacing.md }}>
          <Txt variant="titleCard">Você ainda não tem recordes</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
            Registre um treino de força e seus recordes de carga e 1RM aparecem aqui.
          </Txt>
        </Card>
      ) : (
        byExercise.map(([exercise, records]) => (
          <Card key={exercise} sport="musculacao">
            <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
              {exercise}
            </Txt>
            {records.map((r) => (
              <View
                key={r.id}
                style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingVertical: 6 }}
              >
                <Txt variant="label" color={colors.text2}>
                  {prTypeLabel(r.type, r.repRange)}
                </Txt>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                  <Txt variant="metricMd" tabular>
                    {Math.round(r.value * 10) / 10}
                  </Txt>
                  <Txt variant="label" color={colors.text2}>
                    {r.unit}
                  </Txt>
                </View>
              </View>
            ))}
          </Card>
        ))
      )}
    </Screen>
  );
}
