import React from "react";
import { View, StyleSheet } from "react-native";
import { Txt } from "./ui";
import { colors, radius, spacing } from "../theme";

/**
 * SafetyNote (§5): aviso de saúde discreto e persistente — nunca descartável.
 * Sobriedade em `info`: acento de 3px à esquerda, sem cor de fundo inundada.
 */
export function DisclaimerBanner({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.banner}>
      <Txt variant="label" color={colors.info} style={styles.tag}>
        Saúde
      </Txt>
      <Txt variant="caption" color={colors.text2} style={styles.text}>
        {compact
          ? "As recomendações não substituem um profissional de saúde."
          : "As orientações do coach são um ponto de partida gerado por IA e não substituem médico, nutricionista ou educador físico. Consulte um profissional, principalmente se você tem alguma condição de saúde."}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  tag: { marginTop: 1 },
  text: { flex: 1 },
});
