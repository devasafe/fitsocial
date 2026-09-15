// Estado vazio com propósito: contexto + próximo passo (CTA), em vez de só
// "nada aqui". Orienta o usuário a agir.
import React from "react";
import { View } from "react-native";
import { Txt, Button, Card } from "./ui";
import { Icon, type NomeDeIcone } from "./Icon";
import { colors, radius, spacing } from "../theme";

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  style,
}: {
  /** Nome do ícone do set. Era um emoji renderizado como texto grande — este
   *  único campo é o que troca oito telas de uma vez. */
  icon?: NomeDeIcone;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: object;
}) {
  return (
    <Card level={2} style={[{ marginTop: spacing.md, alignItems: "center" }, style]}>
      {icon ? (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.full,
            backgroundColor: colors.surface3,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: spacing.md,
          }}
        >
          <Icon name={icon} size={26} color={colors.text2} />
        </View>
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
