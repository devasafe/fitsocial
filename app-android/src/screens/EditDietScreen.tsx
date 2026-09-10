// Edição MANUAL da dieta — busca o plano atual, edita calorias/macros/refeições e salva.
import React, { useCallback, useEffect, useState } from "react";
import { View, ActivityIndicator, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { getCurrentPlan, updatePlan, type Plan, type Diet } from "../api/plans";
import { Txt, Screen, Card, Button, Field, ErrorState } from "../components/ui";
import { notify } from "../lib/notify";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

interface ItemForm {
  food: string;
  quantity: string;
}
interface MealForm {
  name: string;
  timeHint: string;
  items: ItemForm[];
}

export function EditDietScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [notes, setNotes] = useState("");
  const [meals, setMeals] = useState<MealForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getCurrentPlan(token!)
      .then((p) => {
        setPlan(p);
        // A dieta pode não existir: quem só gerou treino não tem o que editar.
        const d = p?.diet;
        if (d) {
          setKcal(String(d.dailyCalories));
          setProtein(String(d.macros.proteinG));
          setCarbs(String(d.macros.carbsG));
          setFat(String(d.macros.fatG));
          setNotes(d.notes ?? "");
          setMeals(d.meals.map((m) => ({ name: m.name, timeHint: m.timeHint ?? "", items: m.items.map((it) => ({ food: it.food, quantity: it.quantity })) })));
        }
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function setMeal(mi: number, patch: Partial<MealForm>) {
    setMeals((prev) => prev.map((m, i) => (i === mi ? { ...m, ...patch } : m)));
  }
  function setItem(mi: number, ii: number, patch: Partial<ItemForm>) {
    setMeals((prev) =>
      prev.map((m, i) => (i === mi ? { ...m, items: m.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : m))
    );
  }
  function addItem(mi: number) {
    setMeals((prev) => prev.map((m, i) => (i === mi ? { ...m, items: [...m.items, { food: "", quantity: "" }] } : m)));
  }
  function removeItem(mi: number, ii: number) {
    setMeals((prev) => prev.map((m, i) => (i === mi ? { ...m, items: m.items.filter((_, j) => j !== ii) } : m)));
  }
  function addMeal() {
    setMeals((prev) => [...prev, { name: "Nova refeição", timeHint: "", items: [{ food: "", quantity: "" }] }]);
  }
  function removeMeal(mi: number) {
    setMeals((prev) => prev.filter((_, i) => i !== mi));
  }

  async function save() {
    if (!plan) return;
    const cal = Number(kcal) || 0;
    if (cal < 800 || cal > 6000) return notify("Calorias inválidas", "Informe entre 800 e 6000 kcal.");
    if (meals.length === 0) return notify("Dieta vazia", "Adicione ao menos uma refeição.");
    const diet: Diet = {
      dailyCalories: cal,
      macros: {
        proteinG: Math.max(0, Number(protein) || 0),
        carbsG: Math.max(0, Number(carbs) || 0),
        fatG: Math.max(0, Number(fat) || 0),
      },
      meals: meals.map((m) => ({
        name: m.name.trim() || "Refeição",
        timeHint: m.timeHint.trim(),
        items: m.items.filter((it) => it.food.trim()).map((it) => ({ food: it.food.trim(), quantity: it.quantity.trim() || "à vontade" })),
      })),
      notes: notes.trim(),
    };
    if (diet.meals.some((m) => m.items.length === 0)) {
      return notify("Refeição sem itens", "Cada refeição precisa de ao menos um alimento.");
    }
    setSaving(true);
    try {
      // Só a dieta vai no corpo — mandar o treino junto obrigaria a tê-lo.
      await updatePlan(token!, { diet });
      notify("Dieta atualizada", "Suas mudanças foram salvas.", () => nav.goBack());
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", paddingHorizontal: spacing.gutter }}>
        <ErrorState message="Não foi possível carregar a dieta." onRetry={load} />
      </View>
    );
  }
  if (!plan) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", paddingHorizontal: spacing.gutter }}>
        <Card level={2}>
          <Txt variant="titleCard">Gere um plano primeiro</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
            Na aba Início você gera ou importa seu plano — depois dá pra editar aqui.
          </Txt>
        </Card>
      </View>
    );
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      <Field label="Calorias por dia" value={kcal} onChangeText={setKcal} keyboardType="numeric" placeholder="2000" />
      {/* Empilhados: "Proteína (g)" não cabia num terço da largura. */}
      <Field label="Proteína (g)" value={protein} onChangeText={setProtein} keyboardType="numeric" placeholder="150" />
      <Field label="Carbo (g)" value={carbs} onChangeText={setCarbs} keyboardType="numeric" placeholder="200" />
      <Field label="Gordura (g)" value={fat} onChangeText={setFat} keyboardType="numeric" placeholder="60" />

      {meals.map((m, mi) => (
        <Card key={mi} level={2}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Txt variant="titleCard">Refeição {mi + 1}</Txt>
            <TouchableOpacity onPress={() => removeMeal(mi)} hitSlop={8}>
              <Txt variant="label" color={colors.danger}>
                Remover
              </Txt>
            </TouchableOpacity>
          </View>
          <View style={{ height: spacing.sm }} />
          <Field label="Nome" value={m.name} onChangeText={(t) => setMeal(mi, { name: t })} placeholder="Café da manhã" />
          <Field label="Horário / dica" value={m.timeHint} onChangeText={(t) => setMeal(mi, { timeHint: t })} placeholder="07:00, pós-treino…" />

          {m.items.map((it, ii) => (
            <View key={ii} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
              <View style={{ flex: 2 }}>
                <Field value={it.food} onChangeText={(t) => setItem(mi, ii, { food: t })} placeholder="Alimento" />
              </View>
              <View style={{ flex: 1 }}>
                <Field value={it.quantity} onChangeText={(t) => setItem(mi, ii, { quantity: t })} placeholder="100g" />
              </View>
              <TouchableOpacity onPress={() => removeItem(mi, ii)} hitSlop={8} style={{ paddingTop: 14 }}>
                <Txt variant="titleCard" color={colors.text3}>
                  ✕
                </Txt>
              </TouchableOpacity>
            </View>
          ))}

          <Button title="+ Adicionar item" variant="secondary" onPress={() => addItem(mi)} />
        </Card>
      ))}

      <Button title="+ Adicionar refeição" variant="secondary" onPress={addMeal} />
      <Field label="Observações (opcional)" value={notes} onChangeText={setNotes} placeholder="preferências, substituições…" multiline />
      <Button title="Salvar dieta" onPress={save} loading={saving} size="lg" glow />
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
