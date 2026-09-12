import React, { useCallback, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator, useWindowDimensions } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, ErrorState } from "../components/ui";
import { EmptyState } from "../components/EmptyState";
import { listActivities, type Activity } from "../api/activities";
import { calendario, type DiaDoCalendario } from "../api/evolucao";
import { Heatmap } from "../components/Heatmap";
import { colors, spacing } from "../theme";
import { SkeletonLista } from "../components/Skeleton";
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

export function MinhasAtividadesScreen(_props: { embedded?: boolean } = {}) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [items, setItems] = useState<Activity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dias, setDias] = useState<DiaDoCalendario[]>([]);
  const { width } = useWindowDimensions();

  const loadFirst = useCallback(async () => {
    try {
      const [res, ano] = await Promise.all([listActivities(token!), calendario(token!, 365)]);
      setItems(res.data);
      setCursor(res.meta.nextCursor);
      setDias(ano);
      setError(false);
    } catch {
      setError(true);
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
        <SkeletonLista itens={5} />
      </View>
    );
  }

  // O ano inteiro em casinhas, acima da lista. A lista conta cada treino; o
  // calendario conta a constancia, que e o que some primeiro quando alguem esta
  // desistindo — e que nao da para ver rolando uma lista.
  const temTreino = dias.some((d) => d.treinos > 0);

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      {temTreino && (
        <Card level={1}>
          <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
            Seu ano
          </Txt>
          <Heatmap dias={dias} width={width - spacing.gutter * 2 - spacing.md * 2} />
        </Card>
      )}

      {error && items.length === 0 ? (
        <ErrorState
          message="Não foi possível carregar suas atividades."
          onRetry={() => {
            setLoading(true);
            loadFirst();
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🏋️"
          title="Nenhuma atividade ainda"
          description="Registre seu primeiro treino e ele aparece aqui, com métricas e histórico."
          actionLabel="Registrar treino"
          onAction={() => nav.navigate("Registrar")}
        />
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
