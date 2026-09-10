// O contador que aparece em aba, ícone e segmento. Um componente só: quando
// cada tela desenha o seu, eles divergem em tamanho, cor e regra de corte — e
// o de baixo do sino já era diferente do resto.

import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./ui";
import { colors } from "../theme";

/** Acima disso o número vira ruído. O backend também para de contar em 99. */
const TETO = 99;

export function Badge({
  valor,
  ponto,
  style,
}: {
  valor: number;
  /** Só a bolinha, sem número — para quando o número não ajuda a decidir nada. */
  ponto?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (valor <= 0) return null;

  if (ponto) {
    return <View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.lime }, style]} />;
  }

  return (
    <View
      style={[
        {
          minWidth: 16,
          height: 16,
          borderRadius: 8,
          paddingHorizontal: 4,
          backgroundColor: colors.lime,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
      accessibilityLabel={`${valor} ${valor === 1 ? "item novo" : "itens novos"}`}
    >
      <Txt variant="caption" color={colors.onLime} style={{ fontSize: 10, lineHeight: 14 }}>
        {valor > TETO ? `${TETO}+` : valor}
      </Txt>
    </View>
  );
}

/** Badge sobreposto ao canto de um ícone (sino, aba). */
export function BadgeSobreposto({ valor, ponto }: { valor: number; ponto?: boolean }) {
  return (
    <Badge
      valor={valor}
      ponto={ponto}
      style={{ position: "absolute", top: -4, right: -6 }}
    />
  );
}
