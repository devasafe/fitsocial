import React, { useState } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { useAuth } from "../context/AuthContext";
import { likePost, unlikePost, type Post } from "../api/social";
import { colors, radius, spacing } from "../theme";

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase();
}

export function PostCard({
  post,
  onPressAuthor,
}: {
  post: Post;
  onPressAuthor?: (authorId: string) => void;
}) {
  const { token } = useAuth();
  // Estado otimista da curtida (atualiza a UI antes da resposta do servidor).
  const [liked, setLiked] = useState(post.likedByMe);
  const [count, setCount] = useState(post.likeCount);

  async function toggleLike() {
    const next = !liked;
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    try {
      const res = next ? await likePost(token!, post.id) : await unlikePost(token!, post.id);
      setLiked(res.liked);
      setCount(res.likeCount);
    } catch {
      // Reverte em caso de erro.
      setLiked(!next);
      setCount((c) => c + (next ? -1 : 1));
    }
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => onPressAuthor?.(post.author.id)}
        disabled={!onPressAuthor}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(post.author.name)}</Text>
        </View>
        <Text style={styles.author}>{post.author.name}</Text>
      </TouchableOpacity>

      <Text style={styles.text}>{post.text}</Text>
      {post.imageUrl ? <Image source={{ uri: post.imageUrl }} style={styles.image} /> : null}

      <View style={styles.footer}>
        <TouchableOpacity style={styles.likeBtn} onPress={toggleLike}>
          <Text style={[styles.likeIcon, liked && styles.likeIconActive]}>
            {liked ? "♥" : "♡"}
          </Text>
          <Text style={styles.likeCount}>{count}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primaryText, fontWeight: "800" },
  author: { color: colors.text, fontWeight: "700" },
  text: { color: colors.text, lineHeight: 21 },
  image: {
    width: "100%",
    height: 220,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceAlt,
  },
  footer: { flexDirection: "row", marginTop: spacing.md },
  likeBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  likeIcon: { color: colors.textMuted, fontSize: 22 },
  likeIconActive: { color: colors.danger },
  likeCount: { color: colors.textMuted, fontWeight: "600" },
});
