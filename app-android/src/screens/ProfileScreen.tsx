import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
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
import { Badges } from "../components/Badges";
import { getBadges, type Badge } from "../api/gamification";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

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
        <ActivityIndicator color={colors.primary} size="large" />
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
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{data.user.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{data.user.name}</Text>

          <View style={styles.stats}>
            <Stat label="Posts" value={data.counts.posts} />
            <Stat label="Seguidores" value={data.counts.followers} />
            <Stat label="Seguindo" value={data.counts.following} />
          </View>

          {data.isMe ? (
            <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
              <Text style={styles.logoutText}>Sair da conta</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.followBtn, data.isFollowing && styles.followingBtn]}
              onPress={toggleFollow}
              disabled={busy}
            >
              <Text style={[styles.followText, data.isFollowing && styles.followingText]}>
                {data.isFollowing ? "Seguindo" : "Seguir"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {badges.length > 0 && <Badges badges={badges} />}
        </>
      }
      ListEmptyComponent={<Text style={styles.empty}>Nenhum post ainda.</Text>}
      renderItem={({ item }) => (
        <PostCard post={item} onPressComments={(post) => nav.navigate("PostDetail", { post })} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.md, gap: spacing.md },
  header: { alignItems: "center", paddingVertical: spacing.lg },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primaryText, fontSize: 34, fontWeight: "800" },
  name: { color: colors.text, fontSize: 22, fontWeight: "800", marginTop: spacing.sm },
  stats: { flexDirection: "row", gap: spacing.xl, marginVertical: spacing.lg },
  stat: { alignItems: "center" },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.textMuted, fontSize: 12 },
  followBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  followingBtn: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  followText: { color: colors.primaryText, fontWeight: "700" },
  followingText: { color: colors.text },
  logoutBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  logoutText: { color: colors.textMuted, fontWeight: "600" },
  empty: { color: colors.textMuted, textAlign: "center", padding: spacing.lg },
});
