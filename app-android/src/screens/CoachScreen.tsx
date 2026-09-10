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
} from "react-native";
import { notify, confirmDialog } from "../lib/notify";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getCoachMessages, sendCoachMessage } from "../api/coach";
import { adjustPlan, generateDiet } from "../api/plans";
import type { ChatMessage } from "../api/onboarding";
import { DisclaimerBanner } from "../components/DisclaimerBanner";
import { Txt, ErrorState } from "../components/ui";
import { colors, radius, spacing } from "../theme";
import { SkeletonChat } from "../components/Skeleton";
import type { AppStackParams } from "../navigation/types";

export function CoachScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const load = useCallback(async () => {
    try {
      const { greeting, messages } = await getCoachMessages(token!);
      // Saudação sempre no topo, seguida do histórico salvo.
      setMessages([{ role: "assistant", content: greeting }, ...messages]);
      setError(false);
    } catch {
      setError(true);
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

      const ajuste = res.dietAdjustPending
        ? { rotulo: "sua dieta", executar: () => generateDiet(token!) }
        : res.adjustPending || res.planAdjusted
          ? { rotulo: "seu plano", executar: () => adjustPlan(token!) }
          : null;

      if (ajuste) {
        // O reajuste é uma segunda conversa com a IA e leva o seu tempo; avisa
        // que está acontecendo em vez de deixar a tela quieta.
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Estou refazendo ${ajuste.rotulo}, um instante…` },
        ]);
        try {
          await ajuste.executar();
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Pronto, ${ajuste.rotulo} foi atualizada.` },
          ]);
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Não consegui reajustar agora: ${(err as Error).message}` },
          ]);
        }
      } else if (res.premiumRequired) {
        confirmDialog(
          "Recurso do plano Fundador",
          "O reajuste do plano pelo coach faz parte do acesso completo. Quer ver?",
          () => nav.navigate("Subscription"),
          "Ver acesso"
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

  // Bolhas de conversa, não um spinner no vazio: a tela já parece o que vai ser.
  if (loading) {
    return (
      <View style={[styles.center, { justifyContent: "flex-start", padding: spacing.gutter }]}>
        <SkeletonChat itens={4} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { paddingHorizontal: spacing.gutter }]}>
        <ErrorState
          message="Não foi possível falar com o coach agora."
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
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
