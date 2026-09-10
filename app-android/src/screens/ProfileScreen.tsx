import React, { useCallback, useState } from "react";
import { View, StyleSheet, FlatList, Pressable } from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import {
  getUserProfile,
  getUserActivities,
  followUser,
  unfollowUser,
  type UserProfile,
  type TreinoPublico,
  type Post,
} from "../api/social";
import { PostCard } from "../components/PostCard";
import { TreinoCard } from "../components/TreinoCard";
import { SegmentedControl } from "../components/SegmentedControl";
import { DenunciarSheet } from "../components/DenunciarSheet";
import { useAcoesDePost } from "../lib/acoesDePost";
import { Avatar } from "../components/Avatar";
import { Badges } from "../components/Badges";
import { getBadges, type Badge } from "../api/gamification";
import { getCheckInStats, type CheckInStats } from "../api/checkins";
import { MetricTile, Button, Txt, Card, ErrorState } from "../components/ui";
import { coachLine } from "../lib/coachContext";
import { Skeleton } from "../components/Skeleton";
import { notify } from "../lib/notify";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Aba = "treinos" | "publicacoes" | "fotos";

/** A lista do perfil mostra treinos ou posts, conforme a aba. */
type ItemDoPerfil = Post | TreinoPublico;

const ABAS = [
  { key: "treinos" as const, label: "Treinos" },
  { key: "publicacoes" as const, label: "Publicações" },
  { key: "fotos" as const, label: "Fotos" },
];

export function ProfileScreen() {
  const route = useRoute<RouteProp<AppStackParams, "UserProfile">>();
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { user: me, token } = useAuth();
  const { propsDoCard, denunciando, fecharDenuncia } = useAcoesDePost(() => void load());
  // Sem param => perfil próprio (aba); com param => perfil de outra pessoa.
  const targetId = route.params?.userId ?? me!.id;

  const viewingSelf = !route.params?.userId || route.params.userId === me!.id;
  const [data, setData] = useState<UserProfile | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [consist, setConsist] = useState<CheckInStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // Treinos primeiro: o perfil conta o que a pessoa faz, não o que ela postou.
  const [aba, setAba] = useState<Aba>("treinos");
  const [treinos, setTreinos] = useState<TreinoPublico[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [profile, b, t] = await Promise.all([
        getUserProfile(token!, targetId),
        getBadges(token!, targetId),
        // Vem vazio quando a pessoa não tornou os treinos públicos — a aba
        // então explica isso em vez de parecer que ela nunca treinou.
        getUserActivities(token!, targetId).catch(() => ({ data: [], meta: { nextCursor: null } })),
      ]);
      setData(profile);
      setBadges(b.badges);
      setTreinos(t.data);
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

  // O que cada aba mostra. "Publicações" traz tudo que virou post, inclusive
  // treino compartilhado: se está no feed, está aqui — regra fácil de prever.
  const itensDaAba: ItemDoPerfil[] =
    aba === "treinos"
      ? treinos ?? []
      : aba === "fotos"
        ? data.posts.filter((p) => !!p.imageUrl)
        : data.posts;

  const textoVazio =
    aba === "treinos"
      ? data.isMe
        ? "Você ainda não registrou treinos. O primeiro já aparece aqui."
        : "Esta pessoa ainda não tem treinos públicos."
      : aba === "fotos"
        ? data.isMe
          ? "Você ainda não publicou fotos."
          : "Nenhuma foto por aqui ainda."
        : data.isMe
          ? "Você ainda não publicou nada. Treinos registrados aparecem na aba Treinos."
          : "Nenhuma publicação ainda.";

  return (
    <FlatList
      style={styles.container}
      data={itensDaAba}
      keyExtractor={(item) => item.id}
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
            <MetricTile value={String(data.counts.treinos)} label="Treinos" style={styles.metric} />
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
              <View style={styles.acoesLinha}>
                <Button
                  title="Editar perfil"
                  variant="secondary"
                  onPress={() => nav.navigate("EditProfile")}
                  style={styles.acaoPrincipal}
                />
                {/* Sair mudou de lugar: virou a última linha das Configurações,
                    com confirmação. Aqui do lado de "Editar perfil" era fácil
                    demais de tocar sem querer. */}
                <Pressable
                  onPress={() => nav.navigate("Configuracoes")}
                  accessibilityRole="button"
                  accessibilityLabel="Configurações"
                  style={styles.engrenagem}
                >
                  <Txt variant="body" color={colors.text2}>
                    ⚙
                  </Txt>
                </Pressable>
              </View>
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

          <View style={styles.abas}>
            <SegmentedControl segments={ABAS} value={aba} onChange={setAba} />
          </View>
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Txt variant="body" color={colors.text2} style={styles.emptyText}>
            {textoVazio}
          </Txt>
          {data.isMe ? (
            <Button
              title={aba === "treinos" ? "Registrar treino" : "Publicar"}
              onPress={() =>
                aba === "treinos" ? nav.navigate("Registrar") : nav.navigate("CreatePost")
              }
              style={styles.emptyBtn}
            />
          ) : null}
        </View>
      }
      renderItem={({ item }) =>
        aba === "treinos" ? (
          <TreinoCard
            treino={item as TreinoPublico}
            onPress={() => nav.navigate("ActivityDetail", { activityId: item.id })}
          />
        ) : (
          <PostCard
            post={item as Post}
            onPressComments={(post) => nav.navigate("PostDetail", { post })}
            onPressActivity={(activityId) => nav.navigate("ActivityDetail", { activityId })}
            {...propsDoCard(item as Post, (post) => nav.navigate("EditarPost", { post }))}
          />
        )
      }
      ListFooterComponent={
        <DenunciarSheet postId={denunciando} visivel={!!denunciando} aoFechar={fecharDenuncia} />
      }
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
  acoesLinha: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm },
  acaoPrincipal: { flex: 1 },
  engrenagem: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
  },
  abas: { marginTop: spacing.lg, marginBottom: spacing.md },
  postsHeading: { marginTop: spacing.s32, marginBottom: spacing.xs },
  empty: { alignItems: "center", paddingVertical: spacing.lg },
  emptyText: { textAlign: "center", marginBottom: spacing.md },
  emptyBtn: { alignSelf: "center", paddingHorizontal: spacing.s32 },
});
