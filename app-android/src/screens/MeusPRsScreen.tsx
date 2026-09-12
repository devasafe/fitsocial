import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, ErrorState, SectionHeader } from "../components/ui";
import { EmptyState } from "../components/EmptyState";
import { listPRs, prTypeLabel, prValueLabel, type PersonalRecord } from "../api/prs";
import { listarConquistas, type Conquista } from "../api/evolucao";
import { colors, spacing } from "../theme";
import { SkeletonLista } from "../components/Skeleton";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

/** O recorde que representa o exercício na lista. Os outros ficam de apoio. */
const PRINCIPAL = ["carga_max", "best_time", "best_dist", "aulas", "horas"];

interface Agrupado {
  slug: string;
  nome: string;
  sportId: string;
  principal: PersonalRecord;
  apoio: PersonalRecord[];
}

export function MeusPRsScreen(_props: { embedded?: boolean } = {}) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [prs, setPRs] = useState<PersonalRecord[]>([]);
  const [conquistas, setConquistas] = useState<Conquista[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([listPRs(token!), listarConquistas(token!, { limit: 20 })])
      .then(([lista, historico]) => {
        setPRs(lista);
        setConquistas(historico.itens);
        setCursor(historico.nextCursor);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function carregarMais() {
    if (!cursor || carregandoMais) return;
    setCarregandoMais(true);
    try {
      const r = await listarConquistas(token!, { cursor, limit: 20 });
      setConquistas((atual) => [...atual, ...r.itens]);
      setCursor(r.nextCursor);
    } catch {
      // Falhar em carregar mais não pode apagar o que já está na tela.
    } finally {
      setCarregandoMais(false);
    }
  }

  // Um item por exercício, com um número em destaque — e não três linhas de
  // tipos por exercício, que enchiam a tela sem dizer mais.
  const agrupados = useMemo<Agrupado[]>(() => {
    const m = new Map<string, PersonalRecord[]>();
    for (const p of prs) {
      // Cai no nome quando o recorde é antigo e ainda não passou pelo backfill.
      const chave = p.exerciseSlug || p.exerciseName;
      const arr = m.get(chave) ?? [];
      arr.push(p);
      m.set(chave, arr);
    }

    const out: Agrupado[] = [];
    for (const [slug, lista] of m) {
      const principal = lista.find((p) => PRINCIPAL.includes(p.type)) ?? lista[0];
      out.push({
        slug,
        nome: principal.exerciseName,
        sportId: principal.sportId,
        principal,
        apoio: lista.filter((p) => p.id !== principal.id),
      });
    }
    return out.sort((a, b) => +new Date(b.principal.achievedAt) - +new Date(a.principal.achievedAt));
  }, [prs]);

  if (loading) {
    // Alinhado ao topo, como o conteúdo que vai substituí-lo: centralizado, ele
    // aparecia no meio da tela e saltava para cima quando os dados chegavam.
    return (
      <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
        <SkeletonLista itens={5} altura={72} />
      </Screen>
    );
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      {/* Benchmark é recorde também, mas de outra natureza: um WOD repetido ao
          longo do tempo, não uma carga máxima. Fica aqui perto, em tela
          própria — misturar as duas listas confundiria as duas. */}
      <TouchableOpacity onPress={() => nav.navigate("Benchmarks")} activeOpacity={0.85}>
        <Card level={2}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Txt variant="titleCard">Meus benchmarks</Txt>
              <Txt variant="body" color={colors.text2} style={{ marginTop: 2 }}>
                Fran, Cindy, Murph — e quanto você melhorou em cada um.
              </Txt>
            </View>
            <Txt variant="titleCard" color={colors.text3}>›</Txt>
          </View>
        </Card>
      </TouchableOpacity>

      {error && agrupados.length === 0 ? (
        <ErrorState message="Não foi possível carregar seus recordes." onRetry={load} />
      ) : agrupados.length === 0 ? (
        <EmptyState
          icon="🏆"
          title="Nenhum recorde ainda"
          description="Registre um treino de força e seus recordes de carga e 1RM aparecem aqui."
          actionLabel="Registrar treino"
          onAction={() => nav.navigate("Registrar")}
        />
      ) : (
        <>
          <Card level={1}>
            {agrupados.map((g, i) => (
              <View
                key={g.slug}
                style={{
                  paddingVertical: spacing.sm,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.line,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
                  <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {sportLabel(g.nome)}
                  </Txt>
                  <Txt variant="metricMd" tabular>
                    {prValueLabel(g.principal.type, g.principal.value, g.principal.unit)}
                  </Txt>
                </View>
                {g.apoio.length > 0 && (
                  <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                    {g.apoio
                      .map(
                        (p) =>
                          `${prTypeLabel(p.type, p.repRange)}: ${prValueLabel(p.type, p.value, p.unit)}`
                      )
                      .join(" · ")}
                  </Txt>
                )}
              </View>
            ))}
          </Card>

          {conquistas.length > 0 && (
            <>
              <SectionHeader title="Histórico de conquistas" />
              {conquistas.map((c) => (
                <Card key={c.id} level={1}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong" numberOfLines={1}>
                        {sportLabel(c.exerciseName)}
                      </Txt>
                      <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                        {prTypeLabel(c.type, c.repRange)} · de{" "}
                        {prValueLabel(c.type, c.previousValue, c.unit)} para{" "}
                        {prValueLabel(c.type, c.value, c.unit)}
                      </Txt>
                    </View>
                    <Txt variant="label" color={colors.text2} tabular>
                      {new Date(c.achievedAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </Txt>
                  </View>
                </Card>
              ))}

              {cursor && (
                <TouchableOpacity onPress={carregarMais} activeOpacity={0.85} disabled={carregandoMais}>
                  <Card level={1}>
                    <Txt variant="label" color={colors.text2} style={{ textAlign: "center" }}>
                      {carregandoMais ? "Carregando..." : "Ver conquistas mais antigas"}
                    </Txt>
                  </Card>
                </TouchableOpacity>
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
