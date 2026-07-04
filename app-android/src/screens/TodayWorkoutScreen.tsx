import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getCurrentPlan, type Plan } from "../api/plans";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function TodayWorkoutScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setPlan(await getCurrentPlan(token!));
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
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Você ainda não tem um plano</Text>
        <Text style={styles.emptyText}>Vá em "Início" para gerar ou importar seu plano.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Treino de hoje</Text>
      <Text style={styles.subtitle}>Qual treino você vai fazer? Toque para começar.</Text>

      {plan.workout.sessions.map((session, i) => (
        <TouchableOpacity
          key={i}
          style={styles.card}
          onPress={() => nav.navigate("CheckIn", { session })}
          activeOpacity={0.8}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.day}>{session.day}</Text>
            <Text style={styles.focus}>{session.focus}</Text>
            <Text style={styles.count}>{session.exercises.length} exercícios</Text>
          </View>
          <Text style={styles.play}>▶</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md, paddingTop: spacing.xl },
  title: { color: colors.text, fontSize: 26, fontWeight: "800" },
  subtitle: { color: colors.textMuted, marginBottom: spacing.sm },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  day: { color: colors.text, fontWeight: "800", fontSize: 17 },
  focus: { color: colors.textMuted, marginTop: 2 },
  count: { color: colors.primary, fontSize: 12, marginTop: spacing.xs, fontWeight: "600" },
  play: { color: colors.primary, fontSize: 26, fontWeight: "800" },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" },
  emptyText: { color: colors.textMuted, textAlign: "center", marginTop: spacing.sm },
});
