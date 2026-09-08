import React, { useState } from "react";
import { View, StyleSheet, Image, TouchableOpacity } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useAuth } from "../context/AuthContext";
import { likePost, unlikePost, type Post } from "../api/social";
import { colors, radius, spacing } from "../theme";
import { Card, Txt } from "./ui";
import { Avatar } from "./Avatar";

// Tempo relativo em caixa de frase, sem juntar metadados por ponto médio.
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `há ${w} sem`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `há ${mo} ${mo > 1 ? "meses" : "mês"}`;
  const y = Math.floor(d / 365);
  return `há ${y} ${y > 1 ? "anos" : "ano"}`;
}

function HeartIcon({ filled, color }: { filled?: boolean; color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path
        d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CommentIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path
        d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PostCard({
  post,
  onPressAuthor,
  onPressComments,
}: {
  post: Post;
  onPressAuthor?: (authorId: string) => void;
  onPressComments?: (post: Post) => void;
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

  const when = timeAgo(post.createdAt);

  return (
    <Card style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => onPressAuthor?.(post.author.id)}
        disabled={!onPressAuthor}
        activeOpacity={0.7}
      >
        <Avatar name={post.author.name} size={40} />
        <View style={styles.headerText}>
          <Txt variant="titleCard">{post.author.name}</Txt>
          {when ? (
            <Txt variant="caption" color={colors.text3}>
              {when}
            </Txt>
          ) : null}
        </View>
      </TouchableOpacity>

      {post.text ? <Txt variant="body">{post.text}</Txt> : null}
      {post.imageUrl ? <Image source={{ uri: post.imageUrl }} style={styles.image} /> : null}

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.action}
          onPress={toggleLike}
          activeOpacity={0.7}
          accessibilityLabel={liked ? "Descurtir" : "Curtir"}
        >
          <HeartIcon filled={liked} color={liked ? colors.danger : colors.text2} />
          <Txt variant="label" tabular color={liked ? colors.danger : colors.text2}>
            {count}
          </Txt>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.action}
          onPress={() => onPressComments?.(post)}
          disabled={!onPressComments}
          activeOpacity={0.7}
          accessibilityLabel="Comentários"
        >
          <CommentIcon color={colors.text2} />
          <Txt variant="label" tabular color={colors.text2}>
            {post.commentCount}
          </Txt>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.s12 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.s12 },
  headerText: { flex: 1 },
  image: {
    width: "100%",
    height: 240,
    borderRadius: radius.media,
    backgroundColor: colors.surface2,
  },
  footer: { flexDirection: "row", gap: spacing.s24, marginTop: spacing.xs },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
});
