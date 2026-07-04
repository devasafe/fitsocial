import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Badge } from "../api/gamification";
import { colors, radius, spacing } from "../theme";

/** Grade de conquistas: destacadas quando ganhas, apagadas quando bloqueadas. */
export function Badges({ badges }: { badges: Badge[] }) {
  const earned = badges.filter((b) => b.earned).length;
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Conquistas ({earned}/{badges.length})</Text>
      <View style={styles.grid}>
        {badges.map((b) => (
          <View key={b.id} style={[styles.badge, !b.earned && styles.locked]}>
            <Text style={styles.emoji}>{b.emoji}</Text>
            <Text style={[styles.name, !b.earned && styles.lockedText]} numberOfLines={2}>
              {b.title}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  title: { color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: {
    width: 88,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  locked: { opacity: 0.35 },
  emoji: { fontSize: 26 },
  name: { color: colors.text, fontSize: 11, textAlign: "center", marginTop: spacing.xs },
  lockedText: { color: colors.textMuted },
});
