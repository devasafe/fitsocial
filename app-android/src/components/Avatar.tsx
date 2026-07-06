import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { colors } from "../theme";

// Paleta determinística para o fundo do fallback (inicial).
const BG = ["#7C4DFF", "#00BFA5", "#FF7043", "#29B6F6", "#EC407A", "#66BB6A"];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return BG[h % BG.length];
}

export function Avatar({ uri, name, size = 44 }: { uri?: string | null; name: string; size?: number }) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[dim, styles.img]} />;
  }
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <View style={[dim, styles.fallback, { backgroundColor: colorFor(name) }]}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: colors.surfaceAlt },
  fallback: { alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontWeight: "800" },
});
