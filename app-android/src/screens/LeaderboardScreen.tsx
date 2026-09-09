import React, { useCallback, useState } from "react";
import { View, StyleSheet, FlatList, Image } from "react-native";
import { Skeleton } from "../components/Skeleton";
import { EmptyState } from "../components/EmptyState";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { getLeaderboard, type LeaderRow } from "../api/gamification";
import { Txt, ErrorState } from "../components/ui";
import { colors, radius, spacing } from "../theme";

const LIME_SOFT = "rgba(200,250,75,0.12)";

/** Uma linha do ranking. Ordena por consistência; ninguém é humilhado por ficar por último. */
function LeaderboardRow({ row, position }: { row: LeaderRow; position: number }) {
  const initial = row.name.trim().charAt(0).toUpperCase() || "?";
  const topThree = position <= 3;
  return (
    <View style={[styles.row, row.isMe && styles.rowMe]}>
      <Txt
        variant="titleCard"
        tabular
        color={topThree ? colors.lime : colors.text2}
        style={styles.pos}
      >
        {position}
      </Txt>
      {row.avatarUrl ? (
        <Image
          source={{ uri: row.avatarUrl }}
          style={[styles.avatar, row.isMe && styles.avatarMeBorda]}
        />
      ) : (
        <View style={[styles.avatar, row.isMe && styles.avatarMe]}>
          <Txt variant="label" color={row.isMe ? colors.onLime : colors.text}>
            {initial}
          </Txt>
        </View>
      )}
      <View style={styles.nameWrap}>
        <Txt variant="titleCard" color={colors.text} numberOfLines={1}>
          {row.name}
        </Txt>
        {row.isMe ? (
          <Txt variant="caption" color={colors.lime}>
            você
          </Txt>
        ) : null}
      </View>
      <View style={styles.points}>
        <Txt variant="metricMd" tabular color={colors.text}>
          {row.week}
        </Txt>
        <Txt variant="caption" color={colors.text3}>
          treinos
        </Txt>
      </View>
    </View>
  );
}

export function LeaderboardScreen({ embedded }: { embedded?: boolean } = {}) {
  const { token } = useAuth();
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const { leaderboard } = await getLeaderboard(token!);
      setRows(leaderboard);
      setError(false);
    } catch {
      setError(true);
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
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.gutter, paddingTop: spacing.md, gap: spacing.sm }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} height={56} radius={14} />
        ))}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={rows}
      keyExtractor={(r) => r.userId}
      contentContainerStyle={[styles.list, embedded && styles.listEmbedded]}
      ListHeaderComponent={
        <View style={styles.headerWrap}>
          {!embedded && <Txt variant="titleScreen">Ranking</Txt>}
          <Txt variant="body" color={colors.text2} style={embedded ? undefined : styles.subtitle}>
            Treinos dos últimos 7 dias — você e quem você segue.
          </Txt>
        </View>
      }
      ListEmptyComponent={
        error ? (
          <ErrorState message="Não foi possível carregar o ranking." onRetry={load} />
        ) : (
          <EmptyState
            icon="🏆"
            title="Ranking vazio por enquanto"
            description="Siga pessoas para comparar sua evolução. Aqui ninguém fica em último."
          />
        )
      }
      renderItem={({ item, index }) => <LeaderboardRow row={item} position={index + 1} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xl, paddingBottom: spacing.xl, gap: spacing.card },
  listEmbedded: { paddingTop: spacing.xs },
  headerWrap: { marginBottom: spacing.md },
  subtitle: { marginTop: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    gap: spacing.md,
  },
  rowMe: { borderColor: colors.lime, backgroundColor: LIME_SOFT },
  pos: { width: 28, textAlign: "center" },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarMe: { backgroundColor: colors.lime, borderColor: colors.lime },
  avatarMeBorda: { borderColor: colors.lime, borderWidth: 2 },
  nameWrap: { flex: 1, gap: 1 },
  points: { alignItems: "flex-end" },
  empty: { textAlign: "center", paddingVertical: spacing.xl },
});
