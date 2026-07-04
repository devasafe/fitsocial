import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, radius, spacing } from "../theme";

/** Aviso de saúde reutilizável (guardrail). */
export function DisclaimerBanner({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.icon}>⚕️</Text>
      <Text style={styles.text}>
        {compact
          ? "As recomendações não substituem um profissional de saúde."
          : "As orientações do coach são um ponto de partida gerado por IA e não substituem médico, nutricionista ou educador físico. Consulte um profissional, principalmente se tiver condições de saúde."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  icon: { fontSize: 16 },
  text: { color: colors.textMuted, fontSize: 12, lineHeight: 16, flex: 1 },
});
