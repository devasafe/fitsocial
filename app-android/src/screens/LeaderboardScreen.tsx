import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { getLeaderboard, type LeaderRow } from "../api/gamification";
import { colors, radius, spacing } from "../theme";

const MEDALS = ["🥇", "🥈", "🥉"];

export function LeaderboardScreen() {
  const { token } = useAuth();
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { leaderboard } = await getLeaderboard(token!);
      setRows(leaderboard);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={rows}
      keyExtractor={(r) => r.userId}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <Text style={styles.subtitle}>Treinos nos últimos 7 dias — você e quem você segue.</Text>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>Siga pessoas para comparar sua evolução!</Text>
      }
      renderItem={({ item, index }) => (
        <View style={[styles.row, item.isMe && styles.rowMe]}>
          <Text style={styles.pos}>{MEDALS[index] ?? `${index + 1}º`}</Text>
          <Text style={[styles.name, item.isMe && styles.nameMe]}>
            {item.name} {item.isMe ? "(você)" : ""}
          </Text>
          <Text style={styles.week}>{item.week}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.md, gap: spacing.sm },
  subtitle: { color: colors.textMuted, marginBottom: spacing.sm, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  rowMe: { borderColor: colors.primary },
  pos: { fontSize: 18, width: 32, textAlign: "center", color: colors.text, fontWeight: "800" },
  name: { flex: 1, color: colors.text, fontWeight: "600" },
  nameMe: { color: colors.primary },
  week: { color: colors.text, fontWeight: "800", fontSize: 16 },
  empty: { color: colors.textMuted, textAlign: "center", padding: spacing.lg },
});
