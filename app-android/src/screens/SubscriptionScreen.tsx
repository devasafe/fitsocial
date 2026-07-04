import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { devUpgrade } from "../api/billing";
import { PrimaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme";

const BENEFITS = [
  "Planos de treino e dieta ilimitados",
  "Regeração do plano sempre que quiser",
  "Prioridade nas novidades do coach IA",
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
        isPremium ? "Premium desativado" : "Bem-vindo ao Premium! 🎉",
        isPremium ? "Sua conta voltou para o plano grátis." : "Agora você tem acesso ilimitado."
      );
      nav.goBack();
    } catch (err) {
      Alert.alert("Erro", (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.crown}>👑</Text>
        <Text style={styles.title}>FitSocial Premium</Text>
        <Text style={styles.subtitle}>Leve sua evolução ao próximo nível.</Text>
      </View>

      <View style={styles.card}>
        {BENEFITS.map((b) => (
          <View key={b} style={styles.benefit}>
            <Text style={styles.check}>✓</Text>
            <Text style={styles.benefitText}>{b}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.price}>R$ 19,90/mês</Text>

      <PrimaryButton
        title={isPremium ? "Desativar Premium (teste)" : "Ativar Premium (teste)"}
        onPress={handleUpgrade}
        loading={loading}
      />

      <Text style={styles.note}>
        ⚙️ Este é um upgrade de desenvolvimento para demonstrar o fluxo. A compra
        real será feita pela Google Play (via RevenueCat) na versão publicada.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  hero: { alignItems: "center", paddingVertical: spacing.lg },
  crown: { fontSize: 48 },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", marginTop: spacing.sm },
  subtitle: { color: colors.textMuted, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  benefit: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  check: { color: colors.primary, fontSize: 18, fontWeight: "800" },
  benefitText: { color: colors.text, flex: 1, fontSize: 15 },
  price: { color: colors.primary, fontSize: 24, fontWeight: "800", textAlign: "center" },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: "center" },
});
