import React, { useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import {
  getGreeting,
  sendOnboardingMessage,
  type ChatMessage,
} from "../api/onboarding";
import { Txt } from "../components/ui";
import { colors, radius, spacing, type as typeScale } from "../theme";
import { DisclaimerBanner } from "../components/DisclaimerBanner";

export function OnboardingChat() {
  const { token, refreshUser } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // Busca a saudação inicial do coach ao abrir a tela.
  useEffect(() => {
    (async () => {
      try {
        const { greeting } = await getGreeting(token!);
        setMessages([{ role: "assistant", content: greeting }]);
      } catch {
        setMessages([
          { role: "assistant", content: "Vamos começar! Qual é seu objetivo com os treinos?" },
        ]);
      } finally {
        setBooting(false);
      }
    })();
  }, [token]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const uiNext = [...messages, userMsg];
    setMessages(uiNext);
    setInput("");
    setSending(true);

    try {
      // Envia o histórico SEM a saudação inicial (o backend/LLM espera começar
      // por um turno do usuário).
      const history = uiNext.slice(1);
      const res = await sendOnboardingMessage(token!, history);
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);

      if (res.complete) {
        // Onboarding concluído: atualiza o usuário -> navegação troca para o app.
        setTimeout(refreshUser, 900);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Ops, tive um problema: ${(err as Error).message}. Pode repetir?`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (booting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  const canSend = !!input.trim() && !sending;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Txt variant="titleScreen">Seu coach</Txt>
        <Txt variant="caption" color={colors.text2} style={styles.headerSub}>
          Montando seu perfil
        </Txt>
      </View>

      <View style={styles.disclaimerWrap}>
        <DisclaimerBanner compact />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const mine = item.role === "user";
          return (
            <View style={[styles.bubble, mine ? styles.bubbleUser : styles.bubbleCoach]}>
              <Txt
                variant={mine ? "bodyStrong" : "body"}
                color={mine ? colors.onLime : colors.text}
              >
                {item.content}
              </Txt>
            </View>
          );
        }}
      />

      {sending && (
        <Txt variant="caption" color={colors.text3} style={styles.typing}>
          O coach está digitando…
        </Txt>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Escreva sua resposta"
          placeholderTextColor={colors.text3}
          multiline
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[styles.sendBtn, !canSend && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.85}
          accessibilityLabel="Enviar resposta"
        >
          <Txt variant="titleSection" color={colors.onLime} style={styles.sendText}>
            ›
          </Txt>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  header: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerSub: { marginTop: 2 },
  disclaimerWrap: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
  list: { padding: spacing.gutter, gap: spacing.s12 },
  bubble: { maxWidth: "82%", paddingVertical: spacing.s12, paddingHorizontal: spacing.md, borderRadius: radius.card },
  bubbleCoach: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignSelf: "flex-start",
    borderTopLeftRadius: 4,
  },
  bubbleUser: { backgroundColor: colors.lime, alignSelf: "flex-end", borderTopRightRadius: 4 },
  typing: { paddingHorizontal: spacing.gutter, marginBottom: spacing.xs },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.s12,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontFamily: typeScale.body.fontFamily,
    maxHeight: 120,
    fontSize: 16,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    backgroundColor: colors.lime,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { marginTop: -4, fontSize: 26 },
});
