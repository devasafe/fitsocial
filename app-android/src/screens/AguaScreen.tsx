// Diário de água — meta, registro rápido e histórico do dia.
import React, { useCallback, useState } from "react";
import { View, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button } from "../components/ui";
import { notify } from "../lib/notify";
import { getWaterDay, addWater, deleteWater, setWaterGoal, type WaterDay } from "../api/water";
import { colors, spacing, radius } from "../theme";
import { SkeletonTiles } from "../components/Skeleton";

const PRESETS = [200, 250, 500];

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
function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function AguaScreen() {
  const { token } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [day, setDay] = useState<WaterDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const [editGoal, setEditGoal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDay(await getWaterDay(token!, date));
    } catch {
      setDay(null);
    } finally {
      setLoading(false);
    }
  }, [token, date]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function add(ml: number) {
    if (!ml || ml <= 0) return;
    setBusy(true);
    try {
      await addWater(token!, date, ml);
      setCustom("");
      await load();
    } catch (err) {
      notify("Não deu para registrar", (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    try {
      await deleteWater(token!, id);
      await load();
    } catch {
      /* ignora */
    }
  }

  async function saveGoal() {
    const ml = Number(goalDraft);
    if (!ml || ml < 500) {
      notify("Meta inválida", "Informe a meta em ml (ex.: 2500).");
      return;
    }
    try {
      await setWaterGoal(token!, ml);
      setEditGoal(false);
      await load();
    } catch (err) {
      notify("Não deu para salvar a meta", (err as Error).message);
    }
  }

  const total = day?.total ?? 0;
  const goal = day?.goalMl ?? 2000;
  const pct = goal > 0 ? Math.min(1, total / goal) : 0;
  const left = Math.max(0, goal - total);

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      {/* Navegação de data */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <TouchableOpacity onPress={() => setDate((d) => shift(d, -1))} hitSlop={10}>
          <Txt variant="titleSection" color={colors.text2}>‹</Txt>
        </TouchableOpacity>
        <Txt variant="titleSection">{dateLabel(date)}</Txt>
        <TouchableOpacity onPress={() => setDate((d) => shift(d, 1))} hitSlop={10} disabled={date === todayStr()}>
          <Txt variant="titleSection" color={date === todayStr() ? colors.text3 : colors.text2}>›</Txt>
        </TouchableOpacity>
      </View>

      {/* Progresso */}
      <Card level={2}>
        <Txt variant="label" color={colors.text2}>Água do dia</Txt>
        <Txt variant="metricLg" tabular color={colors.info}>
          {total}
          <Txt variant="titleSection" color={colors.text2}> / {goal} ml</Txt>
        </Txt>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surface3, marginTop: spacing.sm, overflow: "hidden" }}>
          <View style={{ width: `${pct * 100}%`, height: 8, borderRadius: 4, backgroundColor: colors.info }} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm }}>
          <Txt variant="caption" color={colors.text3}>
            {left > 0 ? `faltam ${left} ml` : "meta batida! 💧"}
          </Txt>
          <TouchableOpacity onPress={() => { setGoalDraft(String(goal)); setEditGoal((v) => !v); }} hitSlop={8}>
            <Txt variant="caption" color={colors.info}>
              {day?.goalIsCustom ? "editar meta" : "definir meta"}
            </Txt>
          </TouchableOpacity>
        </View>
        {editGoal ? (
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            <TextInput
              value={goalDraft}
              onChangeText={setGoalDraft}
              placeholder="meta (ml)"
              placeholderTextColor={colors.text3}
              keyboardType="numeric"
              style={inputStyle}
            />
            <Button title="Salvar" variant="secondary" onPress={saveGoal} />
          </View>
        ) : null}
      </Card>

      {/* Registro rápido */}
      <Card>
        <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>Adicionar</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {PRESETS.map((ml) => (
            <TouchableOpacity
              key={ml}
              onPress={() => add(ml)}
              disabled={busy}
              activeOpacity={0.8}
              style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface2 }}
            >
              <Txt variant="bodyStrong" color={colors.info}>+{ml} ml</Txt>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
          <TextInput
            value={custom}
            onChangeText={setCustom}
            placeholder="outro (ml)"
            placeholderTextColor={colors.text3}
            keyboardType="numeric"
            style={inputStyle}
          />
          <Button title="Adicionar" onPress={() => add(Number(custom) || 0)} loading={busy} />
        </View>
      </Card>

      {/* Histórico do dia */}
      {loading ? (
        <SkeletonTiles itens={3} />
      ) : (day?.logs ?? []).length === 0 ? (
        <Card>
          <Txt variant="titleCard">Nada registrado</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
            Toque em +250 ml assim que beber água.
          </Txt>
        </Card>
      ) : (
        <Card>
          {(day?.logs ?? []).map((l) => (
            <View key={l.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6 }}>
              <Txt variant="bodyStrong" tabular color={colors.info} style={{ width: 90 }}>{l.ml} ml</Txt>
              <Txt variant="caption" color={colors.text3} style={{ flex: 1 }}>{hhmm(l.createdAt)}</Txt>
              <TouchableOpacity onPress={() => del(l.id)} hitSlop={8}>
                <Txt variant="label" color={colors.danger}>remover</Txt>
              </TouchableOpacity>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const inputStyle = {
  flex: 1,
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.chip,
  paddingHorizontal: spacing.md,
  paddingVertical: 10,
  color: colors.text,
  fontSize: 15,
} as const;
