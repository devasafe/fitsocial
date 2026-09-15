import React, { useCallback, useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getComments, createComment, deleteComment, type Comment } from "../api/social";
import { PostCard } from "../components/PostCard";
import { Avatar } from "../components/Avatar";
import { Txt } from "../components/ui";
import { colors, radius, spacing, type as typeScale } from "../theme";
import { confirmDialog, notify } from "../lib/notify";
import type { AppStackParams } from "../navigation/types";
import { Icon } from "../components/Icon";

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
  return `há ${w} sem`;
}

export function PostDetailScreen() {
  const route = useRoute<RouteProp<AppStackParams, "PostDetail">>();
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token, user } = useAuth();
  const { post } = route.params;
  /** O dono do post apaga qualquer comentário; cada um apaga o seu. */
  const souDonoDoPost = user?.id === post.author.id;

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [apagando, setApagando] = useState<string | null>(null);

  /**
   * Apaga com confirmacao.
   *
   * Confirmar porque não há como desfazer, e o toque errado num item de lista
   * é o erro mais comum de todos. A lista é atualizada na hora, sem recarregar:
   * o servidor devolve a contagem nova junto.
   */
  function pedirParaApagar(comentario: Comment) {
    const meu = comentario.author.id === user?.id;
    confirmDialog(
      meu ? "Apagar seu comentário?" : "Apagar este comentário?",
      meu
        ? "Ele sai da publicação para todo mundo, e não tem como desfazer."
        : `O comentário de ${comentario.author.name} sai da sua publicação. Não tem como desfazer.`,
      () => void apagar(comentario.id),
      "Apagar"
    );
  }

  async function apagar(commentId: string) {
    if (!token) return;
    setApagando(commentId);
    try {
      await deleteComment(token, post.id, commentId);
      setComments((antes) => antes.filter((c) => c.id !== commentId));
    } catch (e) {
      notify("Não deu para apagar", (e as Error).message);
    } finally {
      setApagando(null);
    }
  }

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

  const canSend = !!text.trim() && !sending;

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
            <PostCard
              post={post}
              onPressAuthor={(id) => nav.navigate("UserProfile", { userId: id })}
              onPressActivity={(activityId) => nav.navigate("ActivityDetail", { activityId })}
            />
            <Txt variant="titleSection" style={styles.sectionTitle}>
              Comentários
            </Txt>
            {loading && <ActivityIndicator color={colors.lime} style={styles.loader} />}
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <Txt variant="body" color={colors.text2} style={styles.empty}>
              Ainda não há comentários. Escreva o primeiro.
            </Txt>
          ) : null
        }
        renderItem={({ item }) => {
          const podeApagar = item.author.id === user?.id || souDonoDoPost;
          return (
            <View style={styles.comment}>
              <Avatar uri={item.author.avatarUrl} name={item.author.name} size={36} />
              <View style={styles.commentBody}>
                <View style={styles.commentTop}>
                  {/* Nome e hora agrupados: o `space-between` do estilo tem
                      dois filhos, e um terceiro solto jogaria a hora para o
                      meio da linha. */}
                  <View style={styles.commentQuem}>
                    <Txt variant="label" color={colors.text}>
                      {item.author.name}
                    </Txt>
                    <Txt variant="caption" color={colors.text3}>
                      {timeAgo(item.createdAt)}
                    </Txt>
                  </View>
                  {podeApagar ? (
                    /* Discreto e à direita: é uma saída, não uma ação que se
                       oferece. Quem procura acha; quem está lendo não tropeça.
                       `hitSlop` porque o alvo do texto sozinho é pequeno. */
                    <TouchableOpacity
                      onPress={() => pedirParaApagar(item)}
                      disabled={apagando === item.id}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      {apagando === item.id ? (
                        <ActivityIndicator size="small" color={colors.text3} />
                      ) : (
                        <Txt variant="caption" color={colors.text3}>
                          apagar
                        </Txt>
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Txt variant="body" style={styles.commentText}>
                  {item.text}
                </Txt>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Escreva um comentário"
          placeholderTextColor={colors.text3}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, !canSend && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.85}
          accessibilityLabel="Enviar comentário"
        >
          <Icon name="setaCima" size={22} color={colors.onLime} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.gutter, gap: spacing.card },
  headerWrap: { gap: spacing.md },
  sectionTitle: { marginTop: spacing.sm },
  loader: { marginTop: spacing.md },
  empty: { textAlign: "center", paddingVertical: spacing.lg },
  comment: { flexDirection: "row", gap: spacing.s12 },
  commentBody: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.card,
    padding: spacing.s12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  commentQuem: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  commentTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  commentText: { marginTop: 2 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.s12,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.s12,
    color: colors.text,
    maxHeight: 120,
    fontFamily: typeScale.body.fontFamily,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.lime,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
});
