import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getFeed, type Post } from "../api/social";
import { PostCard } from "../components/PostCard";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function FeedScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { posts } = await getFeed(token!);
      setPosts(posts);
    } finally {
      setLoading(false);
      setRefreshing(false);
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
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.logo}>FitSocial</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => nav.navigate("CreatePost")}>
          <Text style={styles.newBtnText}>+ Postar</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Seu feed está vazio</Text>
            <Text style={styles.emptyText}>
              Siga outras pessoas ou faça seu primeiro post de evolução!
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onPressAuthor={(id) => nav.navigate("UserProfile", { userId: id })}
            onPressComments={(post) => nav.navigate("PostDetail", { post })}
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  logo: { color: colors.primary, fontSize: 22, fontWeight: "800" },
  newBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  newBtnText: { color: colors.primaryText, fontWeight: "700" },
  list: { padding: spacing.md, gap: spacing.md, flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, marginTop: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: spacing.xs },
  emptyText: { color: colors.textMuted, textAlign: "center", lineHeight: 20 },
});
