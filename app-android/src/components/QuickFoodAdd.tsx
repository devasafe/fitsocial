// Registro rápido de alimento em bottom sheet — recentes em 1 toque + entrada manual.
// Abre da Home (card de nutrição) sem sair da tela. Registra no dia de hoje.
import React, { useCallback, useEffect, useState } from "react";
import { Modal, View, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Txt, Button, Chip } from "./ui";
import { notify } from "../lib/notify";
import { logFood, MEAL_LABEL, type Meal } from "../api/nutrition";
import { loadRecents, pushRecentFood, type RecentFood } from "../lib/foodRecents";
import { colors, spacing, radius } from "../theme";

const MEALS: Meal[] = ["cafe", "almoco", "lanche", "janta"];

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Refeição sugerida pelo horário — reduz uma decisão.
function defaultMeal(): Meal {
  const h = new Date().getHours();
  if (h < 11) return "cafe";
  if (h < 15) return "almoco";
  if (h < 18) return "lanche";
  return "janta";
}

export function QuickFoodAdd({
  visible,
  token,
  onClose,
  onAdded,
}: {
  visible: boolean;
  token: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [meal, setMeal] = useState<Meal>(defaultMeal());
  const [recents, setRecents] = useState<RecentFood[]>([]);
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setMeal(defaultMeal());
      loadRecents(token).then(setRecents);
    }
  }, [visible, token]);

  const commit = useCallback(
    async (food: RecentFood) => {
      setSaving(true);
      try {
        await logFood(token, { date: todayStr(), meal, name: food.name, kcal: food.kcal, proteinG: food.proteinG });
        await pushRecentFood(food);
        setRecents(await loadRecents(token));
        setName("");
        setKcal("");
        setProtein("");
        onAdded();
        notify("Adicionado", `${food.name} · ${food.kcal} kcal`);
      } catch (err) {
        notify("Não deu para adicionar", (err as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [token, meal, onAdded]
  );

  function addManual() {
    if (!name.trim() || !kcal) {
      notify("Faltou preencher", "Informe o nome e as calorias.");
      return;
    }
    commit({ name: name.trim(), kcal: Number(kcal) || 0, proteinG: Number(protein) || 0 });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              borderTopWidth: 1,
              borderColor: colors.line,
              paddingHorizontal: spacing.gutter,
              paddingTop: spacing.md,
              paddingBottom: spacing.xl,
              gap: spacing.md,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Txt variant="titleSection">Registrar alimento</Txt>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Txt variant="label" color={colors.text2}>
                  Concluir
                </Txt>
              </TouchableOpacity>
            </View>

            {/* Refeição */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {MEALS.map((m) => (
                <Chip key={m} label={MEAL_LABEL[m]} active={meal === m} onPress={() => setMeal(m)} />
              ))}
            </View>

            {/* Recentes — 1 toque */}
            {recents.length > 0 && (
              <View>
                <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
                  Recentes
                </Txt>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                  {recents.map((f, idx) => (
                    <TouchableOpacity
                      key={`${f.name}-${idx}`}
                      onPress={() => commit(f)}
                      disabled={saving}
                      activeOpacity={0.8}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: radius.chip,
                        borderWidth: 1,
                        borderColor: colors.line,
                        backgroundColor: colors.surface2,
                      }}
                    >
                      <Txt variant="label">{f.name}</Txt>
                      <Txt variant="caption" color={colors.text3}>
                        {f.kcal} kcal
                      </Txt>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Manual */}
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Alimento"
              placeholderTextColor={colors.text3}
              style={inputStyle}
            />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <TextInput value={kcal} onChangeText={setKcal} placeholder="kcal" placeholderTextColor={colors.text3} keyboardType="numeric" style={[inputStyle, { flex: 1 }]} />
              <TextInput value={protein} onChangeText={setProtein} placeholder="proteína (g)" placeholderTextColor={colors.text3} keyboardType="numeric" style={[inputStyle, { flex: 1 }]} />
            </View>
            <Button title="Adicionar" onPress={addManual} loading={saving} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const inputStyle = {
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.chip,
  paddingHorizontal: spacing.md,
  paddingVertical: 10,
  color: colors.text,
  fontSize: 15,
} as const;
