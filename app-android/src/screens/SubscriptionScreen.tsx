import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { devUpgrade } from "../api/billing";
import { Button, Txt } from "../components/ui";
import { colors, radius, spacing } from "../theme";

const BENEFITS = [
  "Planos de treino e dieta ilimitados",
  "Regenere seu plano quando quiser",
  "Prioridade nas novidades do coach",
];

export function SubscriptionScreen() {
  const nav = useNavigation();
  const { user, token, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const isPremium = user?.tier === "premium";

  async function handleUpgrade() {
    setLoading(true);
    try {
      await devUpgrade(token!);
      await refreshUser();
      Alert.alert(
        isPremium ? "Acesso Fundador desativado" : "Acesso Fundador ativado",
        isPremium
          ? "Sua conta voltou para o plano grátis."
          : "Agora você usa tudo sem limite."
      );
      nav.goBack();
    } catch (err) {
      Alert.alert("Não deu para atualizar", (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.pill}>
          <Txt variant="label" color={colors.onLime}>
            Fundador
          </Txt>
        </View>
        <Txt variant="titleScreen" style={styles.title}>
          Acesso completo
        </Txt>
        <Txt variant="body" color={colors.text2} style={styles.subtitle}>
          Enquanto construímos o FitSocial, fundadores usam tudo sem limite.
        </Txt>
      </View>

      <View style={styles.card}>
        <Txt variant="titleCard" style={styles.cardTitle}>
          O que está incluído
        </Txt>
        {BENEFITS.map((b) => (
          <View key={b} style={styles.benefit}>
            <Txt style={styles.check} color={colors.lime}>
              ✓
            </Txt>
            <Txt variant="body" style={styles.benefitText}>
              {b}
            </Txt>
          </View>
        ))}
      </View>

      <Button
        title={isPremium ? "Sair do acesso Fundador" : "Ativar acesso Fundador"}
        onPress={handleUpgrade}
        loading={loading}
        variant={isPremium ? "secondary" : "primary"}
        size="lg"
      />

      <Txt variant="caption" color={colors.text3} style={styles.note}>
        No futuro, o Premium custará R$ 19,90/mês pela Google Play (via RevenueCat).
        Por enquanto, esta ativação é de desenvolvimento para demonstrar o fluxo.
      </Txt>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.gutter, gap: spacing.lg },
  hero: { alignItems: "flex-start", paddingVertical: spacing.md, gap: spacing.sm },
  pill: {
    backgroundColor: colors.lime,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
  },
  title: { marginTop: spacing.xs },
  subtitle: { marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.hero,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    gap: spacing.md,
  },
  cardTitle: { marginBottom: spacing.xs },
  benefit: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  check: { fontSize: 16, fontWeight: "800" },
  benefitText: { flex: 1 },
  note: { textAlign: "center" },
});
