import React, { useCallback, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, ErrorState } from "../components/ui";
import { TreinoCard } from "../components/TreinoCard";
import { EmptyState } from "../components/EmptyState";
import { listActivities, type Activity } from "../api/activities";
import { calendario, type DiaDoCalendario } from "../api/evolucao";
import { Heatmap } from "../components/Heatmap";
import { colors, spacing } from "../theme";
import { SkeletonLista } from "../components/Skeleton";
import type { AppStackParams } from "../navigation/types";

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
      // O calendário é enfeite; a lista é a tela. Buscar os dois com
      // `Promise.all` fazia o endpoint novo poder derrubar uma tela que já
      // funcionava em produção — o `temTreino` abaixo já esconde o calendário
      // quando não há dado, então o caminho degradado é só ligar este catch.
      const res = await listActivities(token!);
      setItems(res.data);
      setCursor(res.meta.nextCursor);
      setError(false);

      calendario(token!, 365)
        .then(setDias)
        .catch(() => setDias([]));
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
        // O MESMO cartão do feed e do perfil. O daqui era de antes de ele
        // existir: dizia "Musculação" em toda linha, porque é esse o `sportId`
        // de todo check-in de plano — e o que a pessoa quer ler é o que ela
        // treinou, que agora sai no título e na lista de exercícios.
        // Num embrulho só: o cartão já traz a própria margem embaixo, e a tela
        // separa os BLOCOS. Sem isto, o espaço entre treinos viraria a soma dos
        // dois e a lista ficaria arejada demais para um histórico.
        // A margem negativa cancela o `marginBottom` do ÚLTIMO cartão: o `gap`
        // do Screen já separa este bloco do que vem depois, e os dois somados
        // abriam um vão antes do "Carregar mais".
        <View style={{ marginBottom: -spacing.sm }}>
          {items.map((a) => (
            <TreinoCard
              key={a.id}
              treino={a}
              onPress={() => nav.navigate("ActivityDetail", { activity: a })}
            />
          ))}
        </View>
      )}

      {cursor ? (
        <Button title={loadingMore ? "Carregando…" : "Carregar mais"} variant="secondary" onPress={loadMore} disabled={loadingMore} />
      ) : null}
    </Screen>
  );
}
