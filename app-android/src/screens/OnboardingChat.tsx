import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
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
import { colors, radius, spacing } from "../theme";
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
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Seu coach</Text>
        <Text style={styles.headerSub}>Montando seu perfil</Text>
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
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user" ? styles.bubbleUser : styles.bubbleCoach,
            ]}
          >
            <Text style={item.role === "user" ? styles.textUser : styles.textCoach}>
              {item.content}
            </Text>
          </View>
        )}
      />

      {sending && (
        <Text style={styles.typing}>coach está digitando…</Text>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Digite sua resposta…"
          placeholderTextColor={colors.textMuted}
          multiline
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendText}>›</Text>
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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  headerSub: { color: colors.primary, fontSize: 13, marginTop: 2 },
  disclaimerWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  list: { padding: spacing.md, gap: spacing.sm },
  bubble: { maxWidth: "82%", padding: spacing.md, borderRadius: radius.lg },
  bubbleCoach: { backgroundColor: colors.surface, alignSelf: "flex-start", borderTopLeftRadius: 4 },
  bubbleUser: { backgroundColor: colors.primary, alignSelf: "flex-end", borderTopRightRadius: 4 },
  textCoach: { color: colors.text, lineHeight: 21 },
  textUser: { color: colors.primaryText, lineHeight: 21, fontWeight: "600" },
  typing: { color: colors.textMuted, fontStyle: "italic", paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
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
    maxHeight: 120,
    fontSize: 16,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: colors.primaryText, fontSize: 28, fontWeight: "800", marginTop: -4 },
});
