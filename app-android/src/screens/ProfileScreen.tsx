import React, { useCallback, useState } from "react";
import { View, StyleSheet, FlatList } from "react-native";
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
import { getCheckInStats, type CheckInStats } from "../api/checkins";
import { MetricTile, Button, Txt, Card, ErrorState } from "../components/ui";
import { coachLine } from "../lib/coachContext";
import { Skeleton } from "../components/Skeleton";
import { notify } from "../lib/notify";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function ProfileScreen() {
  const route = useRoute<RouteProp<AppStackParams, "UserProfile">>();
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { user: me, token, logout } = useAuth();
  // Sem param => perfil próprio (aba); com param => perfil de outra pessoa.
  const targetId = route.params?.userId ?? me!.id;

  const viewingSelf = !route.params?.userId || route.params.userId === me!.id;
  const [data, setData] = useState<UserProfile | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [consist, setConsist] = useState<CheckInStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [profile, b] = await Promise.all([
        getUserProfile(token!, targetId),
        getBadges(token!, targetId),
      ]);
      setData(profile);
      setBadges(b.badges);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
    // Consistência é do usuário logado — só no próprio perfil.
    if (viewingSelf) {
      getCheckInStats(token!)
        .then((r) => setConsist(r.stats))
        .catch(() => {});
    }
  }, [token, targetId, viewingSelf]);

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
    } catch (err) {
      notify("Não foi possível atualizar", (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.gutter, paddingTop: spacing.xl, alignItems: "center", gap: spacing.md }}>
        <Skeleton width={84} height={84} radius={42} />
        <Skeleton width="50%" height={22} />
        <Skeleton width="30%" height={14} />
        <View style={{ flexDirection: "row", gap: spacing.card, alignSelf: "stretch", marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Skeleton height={64} radius={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Skeleton height={64} radius={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Skeleton height={64} radius={20} />
          </View>
        </View>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.center, { paddingHorizontal: spacing.gutter }]}>
        <ErrorState
          message="Não foi possível carregar o perfil."
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
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

          {data.isMe && consist ? (
            <Card level={2} style={{ marginTop: spacing.lg }}>
              <Txt variant="label" color={colors.text2}>
                Consistência
              </Txt>
              <Txt variant="metricLg" tabular color={colors.lime} style={{ marginTop: 2 }}>
                {consist.streak}
                <Txt variant="titleSection" color={colors.text2}>
                  {" "}
                  {consist.streak === 1 ? "dia seguido" : "dias seguidos"}
                </Txt>
              </Txt>
              <Txt variant="body" color={colors.text2} style={{ marginTop: 2 }}>
                {coachLine(consist)}
              </Txt>
            </Card>
          ) : null}

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
