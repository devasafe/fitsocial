import React, { useCallback, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button } from "../components/ui";
import { listActivities, type Activity } from "../api/activities";
import { colors, spacing } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function summary(a: Activity): string {
  const m = a.metrics ?? {};
  if (a.kind === "endurance" && m.distanceKm != null) {
    const pace = m.avgPaceSecPerKm ? ` · ${mmss(m.avgPaceSecPerKm)} /km` : "";
    return `${m.distanceKm.toFixed(2)} km${pace}`;
  }
  if (a.kind === "strength" && m.volumeTotalKg != null) return `${Math.round(m.volumeTotalKg)} kg de volume`;
  if (m.minutes != null) return `${m.minutes} min`;
  return "";
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function MinhasAtividadesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [items, setItems] = useState<Activity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFirst = useCallback(async () => {
    try {
      const res = await listActivities(token!);
      setItems(res.data);
      setCursor(res.meta.nextCursor);
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadFirst();
    }, [loadFirst])
  );

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listActivities(token!, cursor);
      setItems((prev) => [...prev, ...res.data]);
      setCursor(res.meta.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <Screen scroll contentStyle={{ gap: spacing.card }}>
      {items.length === 0 ? (
        <Card level={2} style={{ marginTop: spacing.md }}>
          <Txt variant="titleCard">Nenhuma atividade ainda</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
            Registre um treino pelo botão + e ele aparece aqui.
          </Txt>
        </Card>
      ) : (
        items.map((a) => (
          <TouchableOpacity key={a.id} activeOpacity={0.85} onPress={() => nav.navigate("ActivityDetail", { activity: a })}>
            <Card sport={a.sportId} style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Txt variant="titleCard">{a.title?.trim() || sportLabel(a.sportId)}</Txt>
                <Txt variant="label" color={colors.text2} style={{ marginTop: 2 }}>
                  {summary(a)}
                </Txt>
              </View>
              <Txt variant="label" color={colors.text3}>
                {shortDate(a.startedAt)}
              </Txt>
            </Card>
          </TouchableOpacity>
        ))
      )}

      {cursor ? (
        <Button title={loadingMore ? "Carregando…" : "Carregar mais"} variant="secondary" onPress={loadMore} disabled={loadingMore} />
      ) : null}
    </Screen>
  );
}
