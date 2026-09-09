import React, { useCallback, useState } from "react";
import { View, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Chip } from "../components/ui";
import { notify } from "../lib/notify";
import { getDay, logFood, deleteFood, MEAL_LABEL, type DaySummary, type Meal } from "../api/nutrition";
import { loadRecents, pushRecentFood, type RecentFood } from "../lib/foodRecents";
import { colors, spacing, radius } from "../theme";

const MEALS: Meal[] = ["cafe", "almoco", "lanche", "janta"];

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dateLabel(date: string): string {
  if (date === todayStr()) return "Hoje";
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function Bar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden", marginTop: 4 }}>
      <View style={{ width: `${pct}%`, height: 6, backgroundColor: colors.lime }} />
    </View>
  );
}

export function DiarioScreen() {
  const { token } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [day, setDay] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [meal, setMeal] = useState<Meal>("cafe");
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [saving, setSaving] = useState(false);
  const [recents, setRecents] = useState<RecentFood[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDay(await getDay(token!, date));
    } catch {
      setDay(null);
    } finally {
      setLoading(false);
    }
    loadRecents(token!).then(setRecents);
  }, [token, date]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function add() {
    if (!name.trim() || !kcal) {
      notify("Faltou preencher", "Informe o nome e as calorias do alimento.");
      return;
    }
    setSaving(true);
    try {
      const food = { name: name.trim(), kcal: Number(kcal) || 0, proteinG: Number(protein) || 0 };
      await logFood(token!, { date, meal, ...food });
      await pushRecentFood(food);
      setName("");
      setKcal("");
      setProtein("");
      await load();
    } catch (err) {
      notify("Não deu para adicionar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function del(id: string) {
    try {
      await deleteFood(token!, id);
      await load();
    } catch {
      /* ignora */
    }
  }

  const totals = day?.totals ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  const target = day?.target;

  const input = (v: string, set: (t: string) => void, ph: string, flex = 1) => (
    <TextInput
      value={v}
      onChangeText={set}
      placeholder={ph}
      placeholderTextColor={colors.text3}
      keyboardType={ph === "Alimento" ? "default" : "numeric"}
      style={{ flex, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text, fontSize: 15 }}
    />
  );

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      {/* Navegação de data */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <TouchableOpacity onPress={() => setDate((d) => shift(d, -1))} hitSlop={10}>
          <Txt variant="titleSection" color={colors.text2}>
            ‹
          </Txt>
        </TouchableOpacity>
        <Txt variant="titleSection">{dateLabel(date)}</Txt>
        <TouchableOpacity onPress={() => setDate((d) => shift(d, 1))} hitSlop={10} disabled={date === todayStr()}>
          <Txt variant="titleSection" color={date === todayStr() ? colors.text3 : colors.text2}>
            ›
          </Txt>
        </TouchableOpacity>
      </View>

      {/* Resumo do dia */}
      <Card level={2}>
        <Txt variant="label" color={colors.text2}>
          Calorias do dia
        </Txt>
        <Txt variant="metricLg" tabular color={colors.lime}>
          {totals.kcal}
          <Txt variant="titleSection" color={colors.text2}>
            {target ? ` / ${target.dailyCalories} kcal` : " kcal"}
          </Txt>
        </Txt>
        {target ? <Bar value={totals.kcal} target={target.dailyCalories} /> : null}
        {target?.macros ? (
          <View style={{ marginTop: spacing.md, gap: 8 }}>
            <MacroRow label="Proteína" v={totals.proteinG} t={target.macros.proteinG} />
            <MacroRow label="Carbo" v={totals.carbsG} t={target.macros.carbsG} />
            <MacroRow label="Gordura" v={totals.fatG} t={target.macros.fatG} />
          </View>
        ) : null}
      </Card>

      {/* Adicionar alimento */}
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm }}>
          {MEALS.map((m) => (
            <Chip key={m} label={MEAL_LABEL[m]} active={meal === m} onPress={() => setMeal(m)} />
          ))}
        </View>
        {recents.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm }}>
            {recents.slice(0, 6).map((f, idx) => (
              <TouchableOpacity
                key={`${f.name}-${idx}`}
                onPress={() => {
                  setName(f.name);
                  setKcal(String(f.kcal));
                  setProtein(String(f.proteinG));
                }}
                activeOpacity={0.8}
                style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface2 }}
              >
                <Txt variant="caption" color={colors.text2}>
                  {f.name} · {f.kcal}
                </Txt>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {input(name, setName, "Alimento")}
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
          {input(kcal, setKcal, "kcal")}
          {input(protein, setProtein, "proteína (g)")}
        </View>
        <Button title="Adicionar" onPress={add} loading={saving} style={{ marginTop: spacing.sm }} />
      </Card>

      {/* Refeições */}
      {loading ? (
        <ActivityIndicator color={colors.lime} />
      ) : (day?.logs ?? []).length === 0 ? (
        <Card>
          <Txt variant="titleCard">Nada registrado nesse dia</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
            Use o campo acima para adicionar o que você comeu.
          </Txt>
        </Card>
      ) : (
        MEALS.map((m) => {
          const items = (day?.logs ?? []).filter((l) => l.meal === m);
          if (items.length === 0) return null;
          return (
            <Card key={m}>
              <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
                {MEAL_LABEL[m]}
              </Txt>
              {items.map((l) => (
                <View key={l.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6 }}>
                  <Txt variant="body" style={{ flex: 1 }}>
                    {l.name}
                  </Txt>
                  <Txt variant="bodyStrong" tabular style={{ marginRight: spacing.md }}>
                    {l.kcal} kcal
                  </Txt>
                  <TouchableOpacity onPress={() => del(l.id)} hitSlop={8}>
                    <Txt variant="label" color={colors.danger}>
                      remover
                    </Txt>
                  </TouchableOpacity>
                </View>
              ))}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

function MacroRow({ label, v, t }: { label: string; v: number; t: number }) {
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Txt variant="label" color={colors.text2}>
          {label}
        </Txt>
        <Txt variant="label" tabular color={colors.text2}>
          {Math.round(v)} / {t} g
        </Txt>
      </View>
      <Bar value={v} target={t} />
    </View>
  );
}
