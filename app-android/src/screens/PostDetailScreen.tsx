import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRoute, type RouteProp } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { getComments, createComment, type Comment } from "../api/social";
import { PostCard } from "../components/PostCard";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase();
}

export function PostDetailScreen() {
  const route = useRoute<RouteProp<AppStackParams, "PostDetail">>();
  const { token } = useAuth();
  const { post } = route.params;

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const { comments } = await getComments(token!, post.id);
      setComments(comments);
    } finally {
      setLoading(false);
    }
  }, [token, post.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { comment } = await createComment(token!, post.id, body);
      setComments((prev) => [...prev, comment]);
      setText("");
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        data={comments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <PostCard post={post} />
            <Text style={styles.sectionTitle}>Comentários</Text>
            {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />}
          </View>
        }
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>Seja o primeiro a comentar!</Text> : null
        }
        renderItem={({ item }) => (
          <View style={styles.comment}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(item.author.name)}</Text>
            </View>
            <View style={styles.commentBody}>
              <Text style={styles.commentAuthor}>{item.author.name}</Text>
              <Text style={styles.commentText}>{item.text}</Text>
            </View>
          </View>
        )}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Escreva um comentário…"
          placeholderTextColor={colors.textMuted}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          <Text style={styles.sendText}>›</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.md, gap: spacing.md },
  headerWrap: { gap: spacing.md },
  sectionTitle: { color: colors.text, fontWeight: "800", fontSize: 16, marginTop: spacing.sm },
  empty: { color: colors.textMuted, textAlign: "center", padding: spacing.lg },
  comment: { flexDirection: "row", gap: spacing.sm },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primaryText, fontWeight: "800", fontSize: 13 },
  commentBody: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  commentAuthor: { color: colors.text, fontWeight: "700", fontSize: 13 },
  commentText: { color: colors.text, marginTop: 2 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    maxHeight: 100,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: colors.primaryText, fontSize: 26, fontWeight: "800", marginTop: -4 },
});
