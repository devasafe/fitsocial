import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { PrimaryButton } from "../components/ui";
import { getCurrentPlan, generatePlan, type Plan } from "../api/plans";
import { ApiHttpError } from "../api/client";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { user, token, logout } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlan(await getCurrentPlan(token!));
    } catch (err) {
      Alert.alert("Erro", (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleGenerate() {
    setGenerating(true);
    try {
      const { plan } = await generatePlan(token!);
      setPlan(plan);
    } catch (err) {
      // 402 = recurso premium (regeneração). Encaminha para a assinatura.
      if (err instanceof ApiHttpError && err.status === 402) {
        navigation.navigate("Subscription");
      } else {
        Alert.alert("Não foi possível gerar o plano", (err as Error).message);
      }
    } finally {
      setGenerating(false);
    }
  }

  // Free com plano existente não regenera direto: vai para a tela Premium.
  function handleRegenerate() {
    if (user?.tier === "premium") {
      handleGenerate();
    } else {
      navigation.navigate("Subscription");
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.hello}>Olá, {user?.name?.split(" ")[0]} 👋</Text>
          {user?.tier === "premium" ? (
            <Text style={styles.tier}>Plano: Premium 👑</Text>
          ) : (
            <TouchableOpacity onPress={() => navigation.navigate("Subscription")}>
              <Text style={styles.tierUpgrade}>Plano: Grátis · Seja Premium →</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Sair</Text>
        </TouchableOpacity>
      </View>

      {!plan ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Seu plano ainda não foi criado</Text>
          <Text style={styles.cardText}>
            Seu coach vai montar um treino e uma dieta sob medida a partir do seu
            perfil. Leva alguns segundos.
          </Text>
          <View style={{ height: spacing.md }} />
          {generating ? (
            <View style={styles.generatingBox}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.generatingText}>Seu coach está montando seu plano…</Text>
            </View>
          ) : (
            <PrimaryButton title="Gerar meu plano" onPress={handleGenerate} />
          )}
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Estratégia do seu coach</Text>
            <Text style={styles.cardText}>{plan.summary}</Text>
          </View>

          <TouchableOpacity
            style={styles.navCard}
            onPress={() => navigation.navigate("Workout", { workout: plan.workout })}
          >
            <Text style={styles.navEmoji}>🏋️</Text>
            <View style={styles.navTextWrap}>
              <Text style={styles.navTitle}>Meu treino</Text>
              <Text style={styles.navSub}>{plan.workout.split}</Text>
            </View>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navCard}
            onPress={() => navigation.navigate("Diet", { diet: plan.diet })}
          >
            <Text style={styles.navEmoji}>🥗</Text>
            <View style={styles.navTextWrap}>
              <Text style={styles.navTitle}>Minha dieta</Text>
              <Text style={styles.navSub}>{plan.diet.dailyCalories} kcal/dia</Text>
            </View>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>{plan.disclaimer}</Text>

          <TouchableOpacity
            style={styles.regen}
            onPress={handleRegenerate}
            disabled={generating}
          >
            <Text style={styles.regenText}>
              {generating
                ? "Gerando…"
                : user?.tier === "premium"
                  ? "Gerar novo plano"
                  : "Gerar novo plano 👑 (Premium)"}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.lg, gap: spacing.md, paddingTop: spacing.xl },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  hello: { color: colors.text, fontSize: 26, fontWeight: "800" },
  tier: { color: colors.textMuted, marginTop: spacing.xs },
  tierUpgrade: { color: colors.primary, marginTop: spacing.xs, fontWeight: "600" },
  logout: { color: colors.textMuted, padding: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.primary, fontWeight: "700", marginBottom: spacing.sm, fontSize: 16 },
  cardText: { color: colors.text, lineHeight: 21 },
  generatingBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  generatingText: { color: colors.textMuted },
  navCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  navEmoji: { fontSize: 28 },
  navTextWrap: { flex: 1 },
  navTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
  navSub: { color: colors.textMuted, marginTop: 2 },
  navArrow: { color: colors.textMuted, fontSize: 28 },
  disclaimer: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
  regen: { alignItems: "center", padding: spacing.md },
  regenText: { color: colors.primary, fontWeight: "700" },
});
