import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import {
  getUserProfile,
  followUser,
  unfollowUser,
  type UserProfile,
} from "../api/social";
import { PostCard } from "../components/PostCard";
import { Avatar } from "../components/Avatar";
import { Badges } from "../components/Badges";
import { getBadges, type Badge } from "../api/gamification";
import { MetricTile, Button, Txt } from "../components/ui";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function ProfileScreen() {
  const route = useRoute<RouteProp<AppStackParams, "UserProfile">>();
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { user: me, token, logout } = useAuth();
  // Sem param => perfil próprio (aba); com param => perfil de outra pessoa.
  const targetId = route.params?.userId ?? me!.id;

  const [data, setData] = useState<UserProfile | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [profile, b] = await Promise.all([
        getUserProfile(token!, targetId),
        getBadges(token!, targetId),
      ]);
      setData(profile);
      setBadges(b.badges);
    } finally {
      setLoading(false);
    }
  }, [token, targetId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function toggleFollow() {
    if (!data) return;
    setBusy(true);
    const wasFollowing = data.isFollowing;
    try {
      if (wasFollowing) await unfollowUser(token!, targetId);
      else await followUser(token!, targetId);
      setData({
        ...data,
        isFollowing: !wasFollowing,
        counts: {
          ...data.counts,
          followers: data.counts.followers + (wasFollowing ? -1 : 1),
        },
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={data.posts}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <>
          <View style={styles.header}>
            <Avatar uri={data.user.avatarUrl} name={data.user.name} size={84} />
            <Txt variant="titleScreen" style={styles.name}>
              {data.user.name}
            </Txt>
            {data.user.username ? (
              <Txt variant="body" color={colors.text2} style={styles.handle}>
                @{data.user.username}
              </Txt>
            ) : null}
            {data.user.bio ? (
              <Txt variant="body" style={styles.bio}>
                {data.user.bio}
              </Txt>
            ) : null}
          </View>

          <View style={styles.metrics}>
            <MetricTile value={String(data.counts.posts)} label="Treinos" style={styles.metric} />
            <MetricTile
              value={String(data.counts.followers)}
              label="Seguidores"
              style={styles.metric}
            />
            <MetricTile
              value={String(data.counts.following)}
              label="Seguindo"
              style={styles.metric}
            />
          </View>

          {data.isMe ? (
            <View style={styles.actions}>
              <Button
                title="Editar perfil"
                variant="secondary"
                onPress={() => nav.navigate("EditProfile")}
              />
              <Button title="Sair da conta" variant="ghost" onPress={logout} />
            </View>
          ) : (
            <View style={styles.actions}>
              <Button
                title={data.isFollowing ? "Seguindo" : "Seguir"}
                variant={data.isFollowing ? "secondary" : "primary"}
                onPress={toggleFollow}
                disabled={busy}
              />
            </View>
          )}

          {badges.length > 0 && <Badges badges={badges} />}

          <Txt variant="titleSection" style={styles.postsHeading}>
            Atividades
          </Txt>
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Txt variant="body" color={colors.text2} style={styles.emptyText}>
            {data.isMe
              ? "Você ainda não publicou treinos. Registre o de hoje para começar seu histórico."
              : "Ainda não há treinos publicados por aqui."}
          </Txt>
          {data.isMe ? (
            <Button
              title="Publicar treino"
              onPress={() => nav.navigate("CreatePost")}
              style={styles.emptyBtn}
            />
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <PostCard post={item} onPressComments={(post) => nav.navigate("PostDetail", { post })} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, paddingBottom: spacing.s32, gap: spacing.card },
  header: { alignItems: "center" },
  name: { marginTop: spacing.md, textAlign: "center" },
  handle: { marginTop: 2 },
  bio: { textAlign: "center", marginTop: spacing.sm, paddingHorizontal: spacing.md },
  metrics: { flexDirection: "row", gap: spacing.card, marginTop: spacing.lg },
  metric: { flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.md },
  postsHeading: { marginTop: spacing.s32, marginBottom: spacing.xs },
  empty: { alignItems: "center", paddingVertical: spacing.lg },
  emptyText: { textAlign: "center", marginBottom: spacing.md },
  emptyBtn: { alignSelf: "center", paddingHorizontal: spacing.s32 },
});
