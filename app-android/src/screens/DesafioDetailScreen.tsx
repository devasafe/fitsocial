import React, { useCallback, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button } from "../components/ui";
import { Avatar } from "../components/Avatar";
import { notify } from "../lib/notify";
import {
  getChallenge,
  challengeLeaderboard,
  joinChallenge,
  scoreLabel,
  scoreModeName,
  type Challenge,
  type LeaderRow,
} from "../api/challenges";
import { colors, spacing, radius } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "DesafioDetail">;

function periodLabel(endAt: string): string {
  const days = Math.ceil((new Date(endAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "Encerrado";
  if (days === 0) return "Último dia";
  return `Termina em ${days} dia${days === 1 ? "" : "s"}`;
}

export function DesafioDetailScreen({ route }: Props) {
  const { id } = route.params;
  const { token } = useAuth();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([getChallenge(token!, id), challengeLeaderboard(token!, id)]);
      setChallenge(c);
      setBoard(b);
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function join() {
    if (!challenge) return;
    setJoining(true);
    try {
      await joinChallenge(token!, challenge.joinCode);
      await load();
    } catch (err) {
      notify("Não deu para entrar", (err as Error).message);
    } finally {
      setJoining(false);
    }
  }

  if (loading || !challenge) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <Screen scroll contentStyle={{ gap: spacing.card }}>
      <View>
        <Txt variant="titleScreen">{challenge.name}</Txt>
        <Txt variant="label" color={colors.text2} style={{ marginTop: 2 }}>
          {scoreModeName(challenge.scoreMode)} · {periodLabel(challenge.endAt)}
        </Txt>
      </View>

      {challenge.description ? (
        <Txt variant="body" color={colors.text2}>
          {challenge.description}
        </Txt>
      ) : null}

      {!challenge.isMember ? (
        <Button title={joining ? "Entrando…" : "Entrar no desafio"} onPress={join} disabled={joining} size="lg" glow />
      ) : (
        <Card level={2}>
          <Txt variant="label" color={colors.text2}>
            Código de convite
          </Txt>
          <Txt variant="metricMd" tabular style={{ letterSpacing: 2 }}>
            {challenge.joinCode}
          </Txt>
          <Txt variant="caption" color={colors.text3}>
            Compartilhe para chamar mais gente.
          </Txt>
        </Card>
      )}

      <Txt variant="titleSection" style={{ marginTop: spacing.sm }}>
        Ranking
      </Txt>
      {board.length === 0 ? (
        <Txt variant="body" color={colors.text2}>
          Ainda sem participantes.
        </Txt>
      ) : (
        board.map((r) => (
          <View
            key={r.userId}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: r.isMe ? colors.lime : colors.line,
              backgroundColor: r.isMe ? "rgba(200,250,75,0.10)" : colors.surface,
            }}
          >
            <Txt variant="titleCard" tabular color={colors.text2} style={{ width: 28 }}>
              {r.position}
            </Txt>
            <Avatar name={r.name} size={36} />
            <Txt variant="bodyStrong" style={{ flex: 1 }}>
              {r.name}
              {r.isMe ? " (você)" : ""}
            </Txt>
            <Txt variant="metricMd" tabular color={colors.lime}>
              {scoreLabel(challenge.scoreMode, r.score)}
            </Txt>
          </View>
        ))
      )}
    </Screen>
  );
}
