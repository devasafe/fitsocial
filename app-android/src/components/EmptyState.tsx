// Estado vazio com propósito: contexto + próximo passo (CTA), em vez de só
// "nada aqui". Orienta o usuário a agir.
import React from "react";
import { View } from "react-native";
import { Txt, Button, Card } from "./ui";
import { colors, spacing } from "../theme";

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  style,
}: {
  icon?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: object;
}) {
  return (
    <Card level={2} style={[{ marginTop: spacing.md, alignItems: "center" }, style]}>
      {icon ? (
        <Txt variant="metricMd" style={{ marginBottom: spacing.sm }}>
          {icon}
        </Txt>
      ) : null}
      <Txt variant="titleCard" style={{ textAlign: "center" }}>
        {title}
      </Txt>
      {description ? (
        <Txt variant="body" color={colors.text2} style={{ textAlign: "center", marginTop: spacing.sm }}>
          {description}
        </Txt>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ alignSelf: "stretch", marginTop: spacing.md }}>
          <Button title={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </Card>
  );
}
