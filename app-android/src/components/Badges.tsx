import React from "react";
import { View, StyleSheet } from "react-native";
import type { Badge } from "../api/gamification";
import { Txt } from "./ui";
import { colors, radius, spacing } from "../theme";

/** Grade de conquistas: destacadas quando ganhas, apagadas quando bloqueadas. */
export function Badges({ badges }: { badges: Badge[] }) {
  const earned = badges.filter((b) => b.earned).length;
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Txt variant="titleSection">Conquistas</Txt>
        <Txt variant="label" color={colors.text2} tabular>
          {earned}/{badges.length}
        </Txt>
      </View>
      <View style={styles.grid}>
        {badges.map((b) => (
          <View key={b.id} style={[styles.badge, b.earned ? styles.earned : styles.locked]}>
            <Txt style={[styles.emoji, !b.earned && styles.lockedEmoji]}>{b.emoji}</Txt>
            <Txt
              variant="caption"
              color={b.earned ? colors.text : colors.text3}
              style={styles.name}
              numberOfLines={2}
            >
              {b.title}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.gutter, marginTop: spacing.md },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.card },
  badge: {
    width: 88,
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  earned: { backgroundColor: colors.surface2, borderColor: colors.line },
  locked: { backgroundColor: colors.surface, borderColor: colors.line, opacity: 0.5 },
  emoji: { fontSize: 26 },
  lockedEmoji: { opacity: 0.7 },
  name: { textAlign: "center", marginTop: spacing.xs },
});
