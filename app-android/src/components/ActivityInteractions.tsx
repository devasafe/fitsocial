// Curtir e comentar um treino direto do detalhe — opera sobre o post que
// compartilhou a atividade. Reusa os endpoints de social já existentes.
import React, { useEffect, useState } from "react";
import { View, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useAuth } from "../context/AuthContext";
import { likePost, unlikePost, getComments, createComment, type Comment } from "../api/social";
import { Txt, Card } from "./ui";
import { Avatar } from "./Avatar";
import { colors, radius, spacing } from "../theme";

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

export function ActivityInteractions({
  postId,
  initialLiked,
  initialLikeCount,
}: {
  postId: string;
  initialLiked: boolean;
  initialLikeCount: number;
}) {
  const { token } = useAuth();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialLikeCount);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    getComments(token!, postId)
      .then((r) => alive && setComments(r.comments))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [postId, token]);

  async function toggleLike() {
    const next = !liked;
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    try {
      const r = next ? await likePost(token!, postId) : await unlikePost(token!, postId);
      setLiked(r.liked);
      setCount(r.likeCount);
    } catch {
      setLiked(!next);
      setCount((c) => c + (next ? -1 : 1));
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { comment } = await createComment(token!, postId, text);
      setComments((prev) => [...prev, comment]);
      setDraft("");
    } catch {
      /* ignora — o usuário pode tentar de novo */
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      {/* Curtir */}
      <TouchableOpacity
        onPress={toggleLike}
        activeOpacity={0.7}
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.sm }}
      >
        <Txt variant="titleCard" color={liked ? colors.danger : colors.text2}>
          {liked ? "♥" : "♡"}
        </Txt>
        <Txt variant="bodyStrong" color={liked ? colors.danger : colors.text2} tabular>
          {count} {count === 1 ? "curtida" : "curtidas"}
        </Txt>
      </TouchableOpacity>

      {/* Comentários */}
      {loading ? (
        <ActivityIndicator color={colors.lime} style={{ marginVertical: spacing.sm }} />
      ) : comments.length === 0 ? (
        <Txt variant="caption" color={colors.text3} style={{ marginBottom: spacing.sm }}>
          Seja o primeiro a comentar.
        </Txt>
      ) : (
        <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
          {comments.map((c) => (
            <View key={c.id} style={{ flexDirection: "row", gap: spacing.sm }}>
              <Avatar name={c.author.name} size={28} />
              <View style={{ flex: 1 }}>
                <Txt variant="label">
                  {c.author.name}{" "}
                  <Txt variant="caption" color={colors.text3}>
                    · {timeAgo(c.createdAt)}
                  </Txt>
                </Txt>
                <Txt variant="body" color={colors.text2}>
                  {c.text}
                </Txt>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Composer */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Comentar…"
          placeholderTextColor={colors.text3}
          multiline
          style={{
            flex: 1,
            maxHeight: 90,
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.chip,
            paddingHorizontal: spacing.md,
            paddingVertical: 8,
            color: colors.text,
            fontSize: 15,
          }}
        />
        <TouchableOpacity
          onPress={send}
          disabled={!draft.trim() || sending}
          activeOpacity={0.85}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.lime,
            alignItems: "center",
            justifyContent: "center",
            opacity: !draft.trim() || sending ? 0.5 : 1,
          }}
        >
          {sending ? <ActivityIndicator color={colors.onLime} /> : <Txt style={{ fontSize: 20, color: colors.onLime }}>›</Txt>}
        </TouchableOpacity>
      </View>
    </Card>
  );
}
