import React, { useCallback, useRef, useState } from "react";
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
  Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getCoachMessages, sendCoachMessage } from "../api/coach";
import type { ChatMessage } from "../api/onboarding";
import { DisclaimerBanner } from "../components/DisclaimerBanner";
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
        Alert.alert("Plano reajustado! 🔁", "Seu coach atualizou o plano com base na conversa.");
      } else if (res.premiumRequired) {
        Alert.alert(
          "Recurso Premium",
          "O reajuste do plano pelo coach é Premium. Quer assinar?",
          [
            { text: "Agora não", style: "cancel" },
            { text: "Ver Premium", onPress: () => nav.navigate("Subscription") },
          ]
        );
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Ops, tive um problema: ${(err as Error).message}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
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
        <Text style={styles.headerTitle}>Seu coach 💬</Text>
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
            style={[styles.bubble, item.role === "user" ? styles.bubbleUser : styles.bubbleCoach]}
          >
            <Text style={item.role === "user" ? styles.textUser : styles.textCoach}>
              {item.content}
            </Text>
          </View>
        )}
      />

      {sending && <Text style={styles.typing}>coach está digitando…</Text>}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Conte como está sendo o processo…"
          placeholderTextColor={colors.textMuted}
          multiline
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
  header: { paddingTop: spacing.xl, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  disclaimerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
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
