import React, { useCallback, useState } from "react";
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getCurrentPlan, type Plan } from "../api/plans";
import { colors, radius, spacing } from "../theme";
import { Txt, Card, Screen, ErrorState } from "../components/ui";
import type { AppStackParams } from "../navigation/types";

export function TodayWorkoutScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlan(await getCurrentPlan(token!));
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
      <View style={styles.center}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <ErrorState
          message="Não foi possível carregar seu treino de hoje."
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.center}>
        <Txt variant="titleSection" style={{ textAlign: "center" }}>
          Você ainda não tem um plano
        </Txt>
        <Txt variant="body" color={colors.text2} style={styles.emptyText}>
          Gere ou importe seu plano na aba Início para começar a treinar.
        </Txt>
      </View>
    );
  }

  return (
    <Screen scroll underHeader contentStyle={styles.content}>
      <Txt variant="titleScreen">Treino de hoje</Txt>
      <Txt variant="body" color={colors.text2} style={{ marginBottom: spacing.sm }}>
        Escolha o treino e toque para começar.
      </Txt>

      {plan.workout.sessions.map((session, i) => (
        <TouchableOpacity
          key={i}
          onPress={() => nav.navigate("CheckIn", { session })}
          activeOpacity={0.85}
        >
          <Card level={1} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Txt variant="titleCard">{session.day}</Txt>
              <Txt variant="body" color={colors.text2} style={{ marginTop: 2 }}>
                {session.focus}
              </Txt>
              <Txt variant="label" color={colors.text2} style={{ marginTop: spacing.s8 }}>
                {session.exercises.length} exercícios
              </Txt>
            </View>
            <Txt variant="metricMd" color={colors.text3} style={styles.chevron}>
              ›
            </Txt>
          </Card>
        </TouchableOpacity>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  content: { gap: spacing.card },
  card: { flexDirection: "row", alignItems: "center", borderRadius: radius.card },
  chevron: { marginLeft: spacing.s12 },
  emptyText: { textAlign: "center", marginTop: spacing.sm },
});
