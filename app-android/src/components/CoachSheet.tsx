// Coach em bottom sheet — chat acessível de qualquer lugar (header da Home) sem
// virar uma aba/tela cheia. Reusa api/coach; o coach vira camada transversal.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { notify, confirmDialog } from "../lib/notify";
import { getCoachMessages, sendCoachMessage } from "../api/coach";
import { adjustPlan, generateDiet } from "../api/plans";
import type { ChatMessage } from "../api/onboarding";
import { Txt, ErrorState } from "./ui";
import { DisclaimerBanner } from "./DisclaimerBanner";
import { colors, radius, spacing } from "../theme";

export function CoachSheet({
  visible,
  token,
  onClose,
  onOpenSubscription,
}: {
  visible: boolean;
  token: string;
  onClose: () => void;
  onOpenSubscription: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { greeting, messages } = await getCoachMessages(token);
      setMessages([{ role: "assistant", content: greeting }, ...messages]);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setSending(true);
    try {
      const res = await sendCoachMessage(token, text);
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
          () => {
            onClose();
            onOpenSubscription();
          },
          "Ver acesso"
        );
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Tive um problema por aqui: ${(err as Error).message}` }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View
            style={{
              height: "82%",
              backgroundColor: colors.bg,
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              borderTopWidth: 1,
              borderColor: colors.line,
            }}
          >
            {/* Cabeçalho */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.gutter, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Txt variant="titleSection" color={colors.lime}>
                  ✦
                </Txt>
                <Txt variant="titleSection">Seu coach</Txt>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Txt variant="label" color={colors.text2}>
                  Fechar
                </Txt>
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: spacing.gutter }}>
              <DisclaimerBanner compact />
            </View>

            {loading ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator color={colors.lime} />
              </View>
            ) : error ? (
              <View style={{ padding: spacing.gutter }}>
                <ErrorState message="Não foi possível falar com o coach agora." onRetry={load} />
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(_, i) => String(i)}
                contentContainerStyle={{ padding: spacing.gutter, gap: spacing.sm }}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                renderItem={({ item }) => {
                  const mine = item.role === "user";
                  return (
                    <View
                      style={{
                        alignSelf: mine ? "flex-end" : "flex-start",
                        maxWidth: "86%",
                        backgroundColor: mine ? colors.lime : colors.surface2,
                        borderRadius: radius.card,
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                      }}
                    >
                      <Txt variant="body" color={mine ? colors.onLime : colors.text}>
                        {item.content}
                      </Txt>
                    </View>
                  );
                }}
              />
            )}

            {/* Entrada */}
            {!error && (
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.gutter, paddingBottom: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="Pergunte ao seu coach…"
                  placeholderTextColor={colors.text3}
                  multiline
                  style={{ flex: 1, maxHeight: 100, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text, fontSize: 15 }}
                />
                <TouchableOpacity
                  onPress={handleSend}
                  disabled={!input.trim() || sending}
                  activeOpacity={0.85}
                  style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center", opacity: !input.trim() || sending ? 0.5 : 1 }}
                >
                  {sending ? <ActivityIndicator color={colors.onLime} /> : <Txt style={{ fontSize: 22, color: colors.onLime }}>›</Txt>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
