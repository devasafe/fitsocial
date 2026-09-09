import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getFeed, getExplore, followUser, unfollowUser, type Post } from "../api/social";
import { PostCard } from "../components/PostCard";
import { Txt, Button, ErrorState } from "../components/ui";
import { SkeletonCard } from "../components/Skeleton";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function FeedScreen({
  embedded,
  mode = "following",
}: { embedded?: boolean; mode?: "following" | "explore" } = {}) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { posts } = await (mode === "explore" ? getExplore(token!) : getFeed(token!));
      setPosts(posts);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, mode]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Seguir/deixar de seguir direto do card (só no Explorar). Otimista no card;
  // aqui reflete em todos os posts do mesmo autor e propaga erro para reverter.
  const handleToggleFollow = useCallback(
    async (authorId: string, next: boolean) => {
      if (next) await followUser(token!, authorId);
      else await unfollowUser(token!, authorId);
      setPosts((prev) =>
        prev.map((p) => (p.author.id === authorId ? { ...p, author: { ...p.author, isFollowing: next } } : p))
      );
    },
    [token]
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.gutter, paddingTop: (embedded ? 0 : insets.top) + spacing.md, gap: spacing.card }}>
        <SkeletonCard lines={3} height={180} />
        <SkeletonCard lines={3} height={180} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!embedded && (
        <View style={[styles.topBar, { paddingTop: insets.top + spacing.s12 }]}>
          <Txt variant="titleScreen" color={colors.lime}>
            FitSocial
          </Txt>
          <Button
            title="Publicar"
            size="sm"
            onPress={() => nav.navigate("CreatePost")}
            style={styles.publishBtn}
          />
        </View>
      )}

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + spacing.s32 },
          posts.length === 0 && styles.listEmpty,
        ]}
        ListHeaderComponent={
          embedded && posts.length > 0 ? (
            <View style={{ alignItems: "flex-end", marginBottom: spacing.sm }}>
              <Button title="Publicar" size="sm" onPress={() => nav.navigate("CreatePost")} style={styles.publishBtn} />
            </View>
          ) : undefined
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.lime}
          />
        }
        ListEmptyComponent={
          error ? (
            <View style={styles.empty}>
              <ErrorState message="Não foi possível carregar o feed." onRetry={load} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Txt variant="titleSection" style={styles.emptyTitle}>
                {mode === "explore" ? "Ainda não tem posts por aqui" : "Seu feed está tranquilo por enquanto"}
              </Txt>
              <Txt variant="body" color={colors.text2} style={styles.emptyText}>
                {mode === "explore"
                  ? "Seja um dos primeiros a publicar — seu treino aparece pra toda a comunidade."
                  : "Publique seu treino de hoje ou siga outras pessoas para acompanhar a evolução delas por aqui."}
              </Txt>
              <Button
                title="Publicar treino"
                onPress={() => nav.navigate("CreatePost")}
                style={styles.emptyBtn}
              />
            </View>
          )
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPressAuthor={(id) => nav.navigate("UserProfile", { userId: id })}
            onPressComments={(post) => nav.navigate("PostDetail", { post })}
            onToggleFollow={mode === "explore" ? handleToggleFollow : undefined}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.s12,
  },
  publishBtn: { paddingHorizontal: spacing.md },
  list: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, gap: spacing.card },
  listEmpty: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  emptyTitle: { textAlign: "center", marginBottom: spacing.sm },
  emptyText: { textAlign: "center", marginBottom: spacing.lg },
  emptyBtn: { alignSelf: "center", paddingHorizontal: spacing.s32 },
});
