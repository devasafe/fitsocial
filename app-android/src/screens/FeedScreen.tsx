import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getFeed, getExplore, followUser, unfollowUser, type Post } from "../api/social";
import { PostCard } from "../components/PostCard";
import { DenunciarSheet } from "../components/DenunciarSheet";
import { useAcoesDePost } from "../lib/acoesDePost";
import { Txt, Button, ErrorState } from "../components/ui";
import { SkeletonCard } from "../components/Skeleton";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function FeedScreen({
  embedded,
  mode = "following",
}: { embedded?: boolean; mode?: "following" | "explore" } = {}) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { propsDoCard, denunciando, fecharDenuncia } = useAcoesDePost(() => void load());
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      if (mode === "explore") {
        const res = await getExplore(token!);
        setPosts(res.posts);
        setNextBefore(res.nextBefore);
      } else {
        const { posts } = await getFeed(token!);
        setPosts(posts);
        setNextBefore(null);
      }
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, mode]);

  // Paginação do Explorar: carrega a próxima página ao chegar no fim.
  const loadMore = useCallback(async () => {
    if (mode !== "explore" || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await getExplore(token!, nextBefore);
      setPosts((prev) => [...prev, ...res.posts]);
      setNextBefore(res.nextBefore);
    } catch {
      /* silencioso — mantém o que já carregou */
    } finally {
      setLoadingMore(false);
    }
  }, [mode, nextBefore, loadingMore, token]);

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
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: spacing.lg }}>
              <ActivityIndicator color={colors.lime} />
            </View>
          ) : null
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
            onPressActivity={(activityId) => nav.navigate("ActivityDetail", { activityId })}
            {...propsDoCard(item, (post) => nav.navigate("EditarPost", { post }))}
          />
        )}
      />
      <DenunciarSheet
        postId={denunciando}
        visivel={!!denunciando}
        aoFechar={fecharDenuncia}
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
