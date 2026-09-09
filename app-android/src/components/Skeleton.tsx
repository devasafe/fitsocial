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
