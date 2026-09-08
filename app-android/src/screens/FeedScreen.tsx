import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getFeed, type Post } from "../api/social";
import { PostCard } from "../components/PostCard";
import { Txt, Button } from "../components/ui";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function FeedScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const insets = useSafeAreaInsets();
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
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
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

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + spacing.s32 },
          posts.length === 0 && styles.listEmpty,
        ]}
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
          <View style={styles.empty}>
            <Txt variant="titleSection" style={styles.emptyTitle}>
              Seu feed está tranquilo por enquanto
            </Txt>
            <Txt variant="body" color={colors.text2} style={styles.emptyText}>
              Publique seu treino de hoje ou siga outras pessoas para acompanhar a evolução delas por aqui.
            </Txt>
            <Button
              title="Publicar treino"
              onPress={() => nav.navigate("CreatePost")}
              style={styles.emptyBtn}
            />
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
