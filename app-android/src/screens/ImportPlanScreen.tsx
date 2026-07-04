import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { importPlan } from "../api/plans";
import { PrimaryButton } from "../components/ui";
import { DisclaimerBanner } from "../components/DisclaimerBanner";
import { colors, radius, spacing } from "../theme";

const PLACEHOLDER = `Cole aqui o plano que seu profissional passou. Ex.:

TREINO
Segunda (A - Peito/Tríceps): Supino reto 4x8-12, Crucifixo 3x12...
Quarta (B - Costas/Bíceps): Barra fixa 4x até a falha...

DIETA
~2200 kcal
Café: 3 ovos, 2 fatias de pão integral
Almoço: 150g frango, 100g arroz, salada...`;

export function ImportPlanScreen() {
  const nav = useNavigation();
  const { token } = useAuth();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    if (text.trim().length < 10) {
      Alert.alert("Texto muito curto", "Cole o texto do seu plano (treino e/ou dieta).");
      return;
    }
    setLoading(true);
    try {
      await importPlan(token!, text.trim());
      Alert.alert("Plano importado! ✅", "Organizamos seu plano no app. Confira na tela inicial.");
      nav.goBack();
    } catch (err) {
      Alert.alert("Não foi possível importar", (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Importar meu plano</Text>
        <Text style={styles.subtitle}>
          Já tem um plano de um profissional? Cole aqui do jeito que veio — a IA
          organiza no formato do app pra você acompanhar e registrar.
        </Text>

        <DisclaimerBanner compact />

        <TextInput
          style={styles.textArea}
          value={text}
          onChangeText={setText}
          placeholder={PLACEHOLDER}
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
        />

        <PrimaryButton
          title="Importar e organizar"
          onPress={handleImport}
          loading={loading}
          disabled={text.trim().length < 10}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  subtitle: { color: colors.textMuted, lineHeight: 20 },
  textArea: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: 15,
    minHeight: 260,
  },
});
