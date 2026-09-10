// Placeholder pulsante para carregamento — faz o app parecer rápido enquanto a
// requisição chega (em vez de um spinner vazio). Animated nativo (web-safe).
import React, { useEffect, useRef } from "react";
import { Animated, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius as radii } from "../theme";

export function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const a = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surface2, opacity: a }, style]}
    />
  );
}

// Cartão-esqueleto genérico (borda de superfície + linhas).
export function SkeletonCard({ lines = 2, height = 96 }: { lines?: number; height?: number }) {
  return (
    <Animated.View
      style={{
        borderRadius: radii.card,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
        padding: 16,
        gap: 10,
        minHeight: height,
      }}
    >
      <Skeleton width="40%" height={12} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "70%" : "100%"} height={14} />
      ))}
    </Animated.View>
  );
}

// ---- Esqueletos por FORMATO de conteúdo ----
//
// Spinner solto no meio da tela diz "algo está vindo" e nada mais. Esqueleto no
// formato do que vem diz TAMBÉM o que é e quanto é — a tela não pula quando o
// conteúdo chega, porque o espaço já estava reservado.
//
// Cada um destes existe porque aparecia repetido: lista, grade, tiles, chat e
// formulário cobrem praticamente todas as telas do app.

import { View } from "react-native";
import { spacing } from "../theme";

/** Lista vertical de cartões: atividades, recordes, refeições, desafios. */
export function SkeletonLista({ itens = 4, altura = 88 }: { itens?: number; altura?: number }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: itens }).map((_, i) => (
        <Skeleton key={i} height={altura} radius={radii.card} />
      ))}
    </View>
  );
}

/** Grade de dois por linha: seletor de esportes, cartões de desafio. */
export function SkeletonGrade({ itens = 6, altura = 96 }: { itens?: number; altura?: number }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      {Array.from({ length: itens }).map((_, i) => (
        <View key={i} style={{ width: "48%" }}>
          <Skeleton height={altura} radius={radii.card} />
        </View>
      ))}
    </View>
  );
}

/** Fileira de números lado a lado: streak, semana, total, água. */
export function SkeletonTiles({ itens = 3 }: { itens?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.card }}>
      {Array.from({ length: itens }).map((_, i) => (
        <View key={i} style={{ flex: 1 }}>
          <Skeleton height={72} radius={radii.card} />
        </View>
      ))}
    </View>
  );
}

/**
 * Conversa: bolhas alternadas, largura irregular.
 *
 * Larguras diferentes de propósito — bolhas do mesmo tamanho parecem tabela,
 * não conversa.
 */
export function SkeletonChat({ itens = 4 }: { itens?: number }) {
  const larguras = ["72%", "54%", "83%", "61%", "76%"] as const;
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: itens }).map((_, i) => (
        <View key={i} style={{ alignItems: i % 2 === 0 ? "flex-start" : "flex-end" }}>
          <Skeleton width={larguras[i % larguras.length]} height={52} radius={radii.card} />
        </View>
      ))}
    </View>
  );
}

/** Formulário: rótulo curto + campo, repetido. */
export function SkeletonFormulario({ campos = 4 }: { campos?: number }) {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: campos }).map((_, i) => (
        <View key={i} style={{ gap: 6 }}>
          <Skeleton width="30%" height={12} />
          <Skeleton height={46} radius={radii.chip} />
        </View>
      ))}
    </View>
  );
}
