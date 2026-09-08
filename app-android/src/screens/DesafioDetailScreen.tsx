import React, { useCallback, useState } from "react";
import { View, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Chip } from "../components/ui";
import { Avatar } from "../components/Avatar";
import { notify } from "../lib/notify";
import {
  getChallenge,
  challengeLeaderboard,
  joinChallenge,
  listChallengePosts,
  createChallengePost,
  likeChallengePost,
  listChallengeComments,
  createChallengeComment,
  scoreLabel,
  scoreModeName,
  type Challenge,
  type LeaderRow,
  type ChallengePost,
  type ChallengeComment,
} from "../api/challenges";
import { colors, spacing, radius } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "DesafioDetail">;

function periodLabel(endAt: string): string {
  const days = Math.ceil((new Date(endAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "Encerrado";
  if (days === 0) return "Último dia";
  return `Termina em ${days} dia${days === 1 ? "" : "s"}`;
}
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

export function DesafioDetailScreen({ route }: Props) {
  const { id } = route.params;
  const { token } = useAuth();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [posts, setPosts] = useState<ChallengePost[]>([]);
  const [tab, setTab] = useState<"ranking" | "mural">("ranking");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, ChallengeComment[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [c, b, p] = await Promise.all([
        getChallenge(token!, id),
        challengeLeaderboard(token!, id),
        listChallengePosts(token!, id),
      ]);
      setChallenge(c);
      setBoard(b);
      setPosts(p);
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function join() {
    if (!challenge) return;
    setJoining(true);
    try {
      await joinChallenge(token!, challenge.joinCode);
      await load();
    } catch (err) {
      notify("Não deu para entrar", (err as Error).message);
    } finally {
      setJoining(false);
    }
  }

  async function publish() {
    if (!text.trim()) return;
    setPosting(true);
    try {
      const post = await createChallengePost(token!, id, text.trim());
      setPosts((prev) => [post, ...prev]);
      setText("");
    } catch (err) {
      notify("Não deu para publicar", (err as Error).message);
    } finally {
      setPosting(false);
    }
  }

  async function toggleLike(post: ChallengePost) {
    const next = !post.likedByMe;
    setPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, likedByMe: next, likeCount: p.likeCount + (next ? 1 : -1) } : p))
    );
    try {
      const r = await likeChallengePost(token!, id, post.id, next);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, likedByMe: r.liked, likeCount: r.likeCount } : p)));
    } catch {
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, likedByMe: !next, likeCount: p.likeCount + (next ? -1 : 1) } : p))
      );
    }
  }

  async function toggleComments(postId: string) {
    if (expanded === postId) {
      setExpanded(null);
      return;
    }
    setExpanded(postId);
    if (!comments[postId]) {
      try {
        const c = await listChallengeComments(token!, id, postId);
        setComments((prev) => ({ ...prev, [postId]: c }));
      } catch {
        setComments((prev) => ({ ...prev, [postId]: [] }));
      }
    }
  }

  async function sendComment(postId: string) {
    const draft = (drafts[postId] ?? "").trim();
    if (!draft) return;
    try {
      const c = await createChallengeComment(token!, id, postId, draft);
      setComments((prev) => ({ ...prev, [postId]: [...(prev[postId] ?? []), c] }));
      setDrafts((prev) => ({ ...prev, [postId]: "" }));
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p)));
    } catch (err) {
      notify("Não deu para comentar", (err as Error).message);
    }
  }

  if (loading || !challenge) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <Screen scroll contentStyle={{ gap: spacing.card }}>
      <View>
        <Txt variant="titleScreen">{challenge.name}</Txt>
        <Txt variant="label" color={colors.text2} style={{ marginTop: 2 }}>
          {scoreModeName(challenge.scoreMode)} · {periodLabel(challenge.endAt)}
        </Txt>
      </View>

      {!challenge.isMember ? (
        <Button title={joining ? "Entrando…" : "Entrar no desafio"} onPress={join} disabled={joining} size="lg" glow />
      ) : (
        <Card level={2}>
          <Txt variant="label" color={colors.text2}>
            Código de convite
          </Txt>
          <Txt variant="metricMd" tabular style={{ letterSpacing: 2 }}>
            {challenge.joinCode}
          </Txt>
        </Card>
      )}

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Chip label="Ranking" active={tab === "ranking"} onPress={() => setTab("ranking")} />
        <Chip label="Mural" active={tab === "mural"} onPress={() => setTab("mural")} />
      </View>

      {tab === "ranking" ? (
        board.length === 0 ? (
          <Txt variant="body" color={colors.text2}>
            Ainda sem participantes.
          </Txt>
        ) : (
          board.map((r) => (
            <View
              key={r.userId}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                padding: spacing.md,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: r.isMe ? colors.lime : colors.line,
                backgroundColor: r.isMe ? "rgba(200,250,75,0.10)" : colors.surface,
              }}
            >
              <Txt variant="titleCard" tabular color={colors.text2} style={{ width: 28 }}>
                {r.position}
              </Txt>
              <Avatar name={r.name} size={36} />
              <Txt variant="bodyStrong" style={{ flex: 1 }}>
                {r.name}
                {r.isMe ? " (você)" : ""}
              </Txt>
              <Txt variant="metricMd" tabular color={colors.lime}>
                {scoreLabel(challenge.scoreMode, r.score)}
              </Txt>
            </View>
          ))
        )
      ) : (
        <>
          {challenge.isMember ? (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Escreva algo pro grupo…"
                placeholderTextColor={colors.text3}
                multiline
                style={{ flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 12, color: colors.text, fontSize: 15 }}
              />
              <Button title={posting ? "…" : "Publicar"} variant="secondary" onPress={publish} disabled={posting} />
            </View>
          ) : null}

          {posts.length === 0 ? (
            <Txt variant="body" color={colors.text2}>
              Nada no mural ainda. Seja o primeiro a postar.
            </Txt>
          ) : (
            posts.map((p) => (
              <Card key={p.id} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Avatar name={p.author.name} size={32} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{p.author.name}</Txt>
                    <Txt variant="caption" color={colors.text3}>
                      {timeAgo(p.createdAt)}
                    </Txt>
                  </View>
                </View>
                <Txt variant="body">{p.text}</Txt>
                <View style={{ flexDirection: "row", gap: spacing.lg }}>
                  <TouchableOpacity
                    onPress={() => toggleLike(p)}
                    activeOpacity={0.7}
                    disabled={!challenge.isMember}
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 }}
                  >
                    <Txt variant="bodyStrong" color={p.likedByMe ? colors.danger : colors.text2}>
                      {p.likedByMe ? "♥" : "♡"}
                    </Txt>
                    <Txt variant="label" tabular color={colors.text2}>
                      {p.likeCount}
                    </Txt>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => toggleComments(p.id)}
                    activeOpacity={0.7}
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 }}
                  >
                    <Txt variant="bodyStrong" color={colors.text2}>
                      💬
                    </Txt>
                    <Txt variant="label" tabular color={colors.text2}>
                      {p.commentCount}
                    </Txt>
                  </TouchableOpacity>
                </View>

                {expanded === p.id ? (
                  <View style={{ gap: spacing.sm, marginTop: 2 }}>
                    {(comments[p.id] ?? []).map((c) => (
                      <View key={c.id}>
                        <Txt variant="label" color={colors.text}>
                          {c.author.name}
                        </Txt>
                        <Txt variant="body" color={colors.text2}>
                          {c.text}
                        </Txt>
                      </View>
                    ))}
                    {challenge.isMember ? (
                      <View style={{ flexDirection: "row", gap: spacing.sm }}>
                        <TextInput
                          value={drafts[p.id] ?? ""}
                          onChangeText={(t) => setDrafts((prev) => ({ ...prev, [p.id]: t }))}
                          placeholder="Comentar…"
                          placeholderTextColor={colors.text3}
                          style={{ flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 8, color: colors.text }}
                        />
                        <Button title="Enviar" variant="secondary" size="sm" onPress={() => sendComment(p.id)} />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </Card>
            ))
          )}
        </>
      )}
    </Screen>
  );
}
