import React, { useCallback, useState } from "react";
import { View, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Chip, ErrorState } from "../components/ui";
import { notify } from "../lib/notify";
import { listMyChallenges, discoverChallenges, joinChallenge, scoreModeName, type Challenge } from "../api/challenges";
import { colors, spacing, radius } from "../theme";
import type { AppStackParams } from "../navigation/types";

function periodLabel(endAt: string): string {
  const days = Math.ceil((new Date(endAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "Encerrado";
  if (days === 0) return "Último dia";
  return `Termina em ${days} dia${days === 1 ? "" : "s"}`;
}

export function DesafiosScreen(_props: { embedded?: boolean } = {}) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [tab, setTab] = useState<"mine" | "discover">("mine");
  const [items, setItems] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(tab === "mine" ? await listMyChallenges(token!) : await discoverChallenges(token!));
      setError(false);
    } catch {
      setItems([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [tab, token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function join() {
    if (!code.trim()) return;
    setJoining(true);
    try {
      const c = await joinChallenge(token!, code.trim());
      setCode("");
      nav.navigate("DesafioDetail", { id: c.id });
    } catch (err) {
      notify("Não deu para entrar", (err as Error).message);
    } finally {
      setJoining(false);
    }
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      <Button title="Criar desafio" onPress={() => nav.navigate("CriarDesafio")} size="lg" glow />

      {/* Entrar por código */}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="Código do convite"
          placeholderTextColor={colors.text3}
          autoCapitalize="characters"
          style={{ flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 12, color: colors.text, fontSize: 16 }}
        />
        <Button title={joining ? "…" : "Entrar"} variant="secondary" onPress={join} disabled={joining} />
      </View>

      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
        <Chip label="Meus" active={tab === "mine"} onPress={() => setTab("mine")} />
        <Chip label="Descobrir" active={tab === "discover"} onPress={() => setTab("discover")} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.lime} style={{ marginTop: spacing.lg }} />
      ) : error && items.length === 0 ? (
        <ErrorState message="Não foi possível carregar os desafios." onRetry={load} />
      ) : items.length === 0 ? (
        <Card level={2}>
          <Txt variant="body" color={colors.text2}>
            {tab === "mine"
              ? "Você ainda não participa de nenhum desafio. Crie um ou entre por um código."
              : "Nenhum desafio público em aberto agora."}
          </Txt>
        </Card>
      ) : (
        items.map((c) => (
          <TouchableOpacity key={c.id} activeOpacity={0.85} onPress={() => nav.navigate("DesafioDetail", { id: c.id })}>
            <Card>
              <Txt variant="titleCard">{c.name}</Txt>
              <Txt variant="label" color={colors.text2} style={{ marginTop: 2 }}>
                {scoreModeName(c.scoreMode)} · {c.memberCount ?? 0} participante{(c.memberCount ?? 0) === 1 ? "" : "s"}
              </Txt>
              <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                {periodLabel(c.endAt)}
              </Txt>
            </Card>
          </TouchableOpacity>
        ))
      )}
    </Screen>
  );
}
