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
import { getCurrentPlan, generatePlan, adjustPlan, type Plan } from "../api/plans";
import { getCheckInStats, type CheckInStats } from "../api/checkins";
import { ApiHttpError } from "../api/client";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { user, token, logout } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stats, setStats] = useState<CheckInStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([getCurrentPlan(token!), getCheckInStats(token!)]);
      setPlan(p);
      setStats(s.stats);
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

  // Reajuste pela IA com base na adesão (premium).
  async function handleAdjust() {
    if (user?.tier !== "premium") {
      navigation.navigate("Subscription");
      return;
    }
    setAdjusting(true);
    try {
      const { plan } = await adjustPlan(token!);
      setPlan(plan);
      Alert.alert("Plano reajustado! 🔁", "Seu coach atualizou o plano com base na sua evolução.");
    } catch (err) {
      Alert.alert("Não foi possível reajustar", (err as Error).message);
    } finally {
      setAdjusting(false);
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
            <>
              <PrimaryButton title="Gerar meu plano" onPress={handleGenerate} />
              <TouchableOpacity
                style={styles.importLink}
                onPress={() => navigation.navigate("ImportPlan")}
              >
                <Text style={styles.importText}>Já tenho um plano? Importar o meu</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <>
          {stats && (
            <>
              <View style={styles.progressCard}>
                <View style={styles.progressItem}>
                  <Text style={styles.progressValue}>🔥 {stats.streak}</Text>
                  <Text style={styles.progressLabel}>dias seguidos</Text>
                </View>
                <View style={styles.progressDivider} />
                <View style={styles.progressItem}>
                  <Text style={styles.progressValue}>{stats.week}</Text>
                  <Text style={styles.progressLabel}>na semana</Text>
                </View>
                <View style={styles.progressDivider} />
                <View style={styles.progressItem}>
                  <Text style={styles.progressValue}>{stats.total}</Text>
                  <Text style={styles.progressLabel}>total</Text>
                </View>
              </View>
              <View style={styles.linksRow}>
                <TouchableOpacity
                  style={styles.rankingLink}
                  onPress={() => navigation.navigate("Leaderboard")}
                >
                  <Text style={styles.rankingText}>🏆 Ranking</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rankingLink}
                  onPress={() => navigation.navigate("History")}
                >
                  <Text style={styles.rankingText}>📊 Evolução</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

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

          <TouchableOpacity
            style={styles.adjustBtn}
            onPress={handleAdjust}
            disabled={adjusting}
          >
            <Text style={styles.adjustText}>
              {adjusting
                ? "Coach reajustando…"
                : user?.tier === "premium"
                  ? "🔁 Pedir reajuste ao coach"
                  : "🔁 Pedir reajuste ao coach 👑 (Premium)"}
            </Text>
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

          <TouchableOpacity
            style={styles.importLink}
            onPress={() => navigation.navigate("ImportPlan")}
          >
            <Text style={styles.importText}>Importar outro plano meu</Text>
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
  progressCard: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  progressItem: { flex: 1, alignItems: "center" },
  progressValue: { color: colors.text, fontSize: 20, fontWeight: "800" },
  progressLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  progressDivider: { width: 1, height: 32, backgroundColor: colors.border },
  linksRow: { flexDirection: "row", justifyContent: "center", gap: spacing.xl },
  rankingLink: { alignItems: "center", paddingVertical: spacing.sm },
  rankingText: { color: colors.primary, fontWeight: "700" },
  importLink: { alignItems: "center", paddingVertical: spacing.md },
  importText: { color: colors.textMuted, fontWeight: "600", textDecorationLine: "underline" },
  adjustBtn: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  adjustText: { color: colors.primary, fontWeight: "700" },
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
