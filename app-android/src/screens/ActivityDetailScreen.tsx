import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, TouchableOpacity } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Txt, Screen, Card, ErrorState } from "../components/ui";
import { Avatar } from "../components/Avatar";
import { ActivityInteractions } from "../components/ActivityInteractions";
import { RouteMap } from "../components/RouteMap";
import { useAuth } from "../context/AuthContext";
import { getActivity, type Activity } from "../api/activities";
import { colors, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import { clock, type GeoPoint } from "../lib/geo";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "ActivityDetail">;

interface Payload {
  points?: GeoPoint[];
  splits?: { km: number; timeSec: number }[];
  exercises?: { name: string; sets: { weightKg?: number; reps?: number | null }[] }[];
  name?: string;
  scoreType?: string;
  level?: string;
  resultTimeSec?: number | null;
  resultRounds?: number | null;
  resultReps?: number | null;
  resultLoadKg?: number | null;
  activityName?: string;
  description?: string | null;
  modality?: string;
  sessionType?: string;
  movements?: { name: string; loadKg?: number | null; reps?: number | null; timeSec?: number | null }[];
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
      <Txt variant="label" color={colors.text2}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" tabular>
        {value}
      </Txt>
    </View>
  );
}

export function ActivityDetailScreen({ route, navigation }: Props) {
  const { token } = useAuth();
  const passed = route.params.activity ?? null;
  const activityId = route.params.activityId;
  const [fetched, setFetched] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(!passed && !!activityId);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (passed || !activityId) return;
    let alive = true;
    setLoading(true);
    getActivity(token!, activityId)
      .then((res) => alive && (setFetched(res), setError(false)))
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [passed, activityId, token]);

  const a = passed ?? fetched;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }
  if (error || !a) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", paddingHorizontal: spacing.gutter }}>
        <ErrorState message="Não foi possível abrir este treino." />
      </View>
    );
  }

  const p = (a.payload ?? {}) as Payload;
  const m = a.metrics ?? {};
  const stroke = sportColor(a.sportId);
  const when = new Date(a.startedAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      {/* Dono do treino (ao ver de outra pessoa) */}
      {a.owner ? (
        <TouchableOpacity
          onPress={() => navigation.navigate("UserProfile", { userId: a.owner!.id })}
          activeOpacity={0.7}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
        >
          <Avatar uri={a.owner.avatarUrl} name={a.owner.name} size={36} />
          <View>
            <Txt variant="bodyStrong">{a.owner.name}</Txt>
            {a.owner.username ? (
              <Txt variant="caption" color={colors.text3}>
                @{a.owner.username}
              </Txt>
            ) : null}
          </View>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: stroke }} />
        <View>
          <Txt variant="titleScreen">{a.title?.trim() || sportLabel(a.sportId)}</Txt>
          <Txt variant="caption" color={colors.text3}>
            {when}
          </Txt>
        </View>
      </View>

      {a.kind === "endurance" && p.points && p.points.length >= 2 ? (
        <RouteMap points={p.points} sportId={a.sportId} height={240} />
      ) : null}

      {/* Métricas por formato */}
      <Card level={2}>
        {a.kind === "endurance" ? (
          <>
            <StatRow label="Distância" value={`${(m.distanceKm ?? 0).toFixed(2)} km`} />
            <StatRow label="Tempo" value={clock(a.durationSec)} />
            <StatRow label="Ritmo médio" value={m.avgPaceSecPerKm ? `${mmss(m.avgPaceSecPerKm)} /km` : "—"} />
            {m.elevationGainM ? <StatRow label="Elevação" value={`${Math.round(m.elevationGainM)} m`} /> : null}
          </>
        ) : a.kind === "strength" ? (
          <>
            <StatRow label="Volume total" value={`${Math.round(m.volumeTotalKg ?? 0)} kg`} />
            <StatRow label="Séries válidas" value={`${m.seriesValidas ?? 0}`} />
            <StatRow label="Duração" value={clock(a.durationSec)} />
          </>
        ) : a.kind === "wod" ? (
          <>
            <StatRow label="WOD" value={p.name ?? "—"} />
            <StatRow label="Nível" value={(p.level ?? "rx").toUpperCase()} />
            <StatRow
              label="Resultado"
              value={
                p.resultTimeSec != null
                  ? mmss(p.resultTimeSec)
                  : p.resultRounds != null
                    ? `${p.resultRounds} rounds`
                    : p.resultReps != null
                      ? `${p.resultReps} reps`
                      : p.resultLoadKg != null
                        ? `${p.resultLoadKg} kg`
                        : "—"
              }
            />
          </>
        ) : (
          <>
            <StatRow label="Duração" value={`${m.minutes ?? Math.round(a.durationSec / 60)} min`} />
            {p.activityName ? <StatRow label="Atividade" value={p.activityName} /> : null}
            {p.sessionType ? <StatRow label="Tipo" value={p.sessionType} /> : null}
          </>
        )}
      </Card>

      {/* Movimentos (WOD) */}
      {a.kind === "wod" && p.movements && p.movements.length > 0 ? (
        <Card>
          <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
            Movimentos
          </Txt>
          {p.movements.map((mv, i) => {
            const parts: string[] = [];
            if (mv.loadKg != null) parts.push(`${mv.loadKg} kg`);
            if (mv.reps != null) parts.push(`${mv.reps} reps`);
            if (mv.timeSec != null) parts.push(mmss(mv.timeSec));
            return <StatRow key={i} label={mv.name} value={parts.join(" · ") || "—"} />;
          })}
        </Card>
      ) : null}

      {/* Splits (endurance) */}
      {p.splits && p.splits.length > 0 ? (
        <Card>
          <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
            Parciais por km
          </Txt>
          {p.splits.map((s) => (
            <StatRow key={s.km} label={`Km ${s.km}`} value={mmss(s.timeSec)} />
          ))}
        </Card>
      ) : null}

      {/* Exercícios (strength) */}
      {p.exercises && p.exercises.length > 0 ? (
        <Card>
          <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
            Exercícios
          </Txt>
          {p.exercises.map((ex, i) => (
            <View key={i} style={{ paddingVertical: 6 }}>
              <Txt variant="bodyStrong">{ex.name}</Txt>
              <Txt variant="label" color={colors.text2}>
                {ex.sets.map((s) => `${s.weightKg ?? 0}kg×${s.reps ?? 0}`).join("  ·  ")}
              </Txt>
            </View>
          ))}
        </Card>
      ) : null}

      {a.notes ? (
        <Card>
          <Txt variant="body" color={colors.text2}>
            {a.notes}
          </Txt>
        </Card>
      ) : null}

      {/* Curtir / comentar (quando o treino foi compartilhado) */}
      {a.post ? (
        <ActivityInteractions
          postId={a.post.id}
          initialLiked={a.post.likedByMe}
          initialLikeCount={a.post.likeCount}
        />
      ) : null}
    </Screen>
  );
}
