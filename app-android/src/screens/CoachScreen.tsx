import React, { useCallback, useRef, useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getCoachMessages, sendCoachMessage } from "../api/coach";
import type { ChatMessage } from "../api/onboarding";
import { DisclaimerBanner } from "../components/DisclaimerBanner";
import { Txt } from "../components/ui";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function CoachScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const load = useCallback(async () => {
    try {
      const { greeting, messages } = await getCoachMessages(token!);
      // Saudação sempre no topo, seguida do histórico salvo.
      setMessages([{ role: "assistant", content: greeting }, ...messages]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setSending(true);
    try {
      const res = await sendCoachMessage(token!, text);
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);

      if (res.planAdjusted) {
        Alert.alert("Plano atualizado", "Seu coach ajustou o plano com base na conversa.");
      } else if (res.premiumRequired) {
        Alert.alert(
          "Recurso do plano Fundador",
          "O reajuste do plano pelo coach faz parte do acesso completo. Quer ver?",
          [
            { text: "Agora não", style: "cancel" },
            { text: "Ver acesso", onPress: () => nav.navigate("Subscription") },
          ]
        );
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Tive um problema por aqui: ${(err as Error).message}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Txt variant="titleScreen">Seu coach</Txt>
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

      {sending ? (
        <Txt variant="caption" color={colors.text2} style={styles.typing}>
          coach está digitando…
        </Txt>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Conte como está sendo o processo…"
          placeholderTextColor={colors.text3}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Enviar mensagem"
        >
          <Txt style={styles.sendText}>›</Txt>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  header: { paddingTop: spacing.xl, paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  disclaimerWrap: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.md, gap: spacing.sm },
  bubble: { maxWidth: "82%", paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.card },
  bubbleCoach: {
    backgroundColor: colors.surface2,
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
    padding: spacing.sm,
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
  sendText: { color: colors.onLime, fontSize: 28, fontWeight: "800", marginTop: -4 },
});
