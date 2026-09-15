// A evolução da nutrição — e, principalmente, o que ela NÃO sabe.
//
// O pedido era "quero registrar quando eu falhar na dieta, pro gráfico ficar
// realista". O diagnóstico estava certo e a causa era outra: o gráfico mentiria
// mesmo sem falha nenhuma, porque quem come mal não abre o app naquele dia. O
// dado que falta não é a falha — é o dia inteiro.
//
// Daí as duas regras desta tela, que não são estéticas:
//
//   - o dia sem registro é BURACO visível, nunca zero e nunca interpolado (por
//     isso os nulos vão inteiros para o `LineChart`, sem filtro: filtrar
//     aproximaria os pontos e o buraco sumiria do eixo X);
//   - a média NUNCA aparece sozinha. Uma média de 12 dias apresentada como se
//     fosse de 30 é exatamente a mentira que esta tela existe para evitar.
//
// E o guardrail do projeto (docs/VISAO.md): nenhum texto aqui usa linguagem de
// vergonha corporal nem pune quem não registrou. O convite pergunta o que a
// pessoa comeu.
import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, TouchableOpacity, useWindowDimensions } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AppStackParams } from "../navigation/types";
import { useAuth } from "../context/AuthContext";
import {
  buscarEvolucaoDeNutricao,
  type DiaDeNutricao,
  type EvolucaoDeNutricao,
} from "../api/nutricao";
import { LineChart } from "../components/LineChart";
import { MacroRow } from "../components/MacroBar";
import { Txt, Card, Chip, ErrorState } from "../components/ui";
import { EmptyState } from "../components/EmptyState";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import { colors, spacing } from "../theme";

/** O `meta` de janela das rotas com corte por plano. */
interface MetaDaJanela {
  dias: number;
  diasPedidos?: number;
  limitadoPor?: "plano";
}

const JANELAS = [7, 30, 90] as const;
type Janela = (typeof JANELAS)[number];

/** Meio-dia de propósito: parsear `yyyy-mm-dd` cru vira UTC e, no fuso de São
 *  Paulo, a data volta um dia — o convite falaria do dia errado. */
function comoData(dia: string): Date {
  return new Date(`${dia}T12:00:00`);
}

/** "domingo", "segunda-feira". */
function diaDaSemana(dia: string): string {
  return comoData(dia).toLocaleDateString("pt-BR", { weekday: "long" });
}

/**
 * Uma linha do cabeçalho: o que é à esquerda, o número à direita.
 *
 * As três saem daqui para terem o mesmo peso de verdade — "igual peso" escrito
 * três vezes à mão é igual peso até alguém mexer em uma delas.
 */
function LinhaDoResumo({
  rotulo,
  valor,
  sufixo,
}: {
  rotulo: string;
  valor: number | string;
  sufixo?: string;
}) {
  return (
    <View style={styles.linhaDoResumo}>
      <Txt variant="label" color={colors.text2} style={{ flex: 1 }}>
        {rotulo}
      </Txt>
      <Txt variant="metricMd" tabular>
        {valor}
        {sufixo ? <Txt variant="label" color={colors.text2}>{sufixo}</Txt> : null}
      </Txt>
    </View>
  );
}

export function NutricaoProgressoScreen({ embedded }: { embedded?: boolean } = {}) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const { width } = useWindowDimensions();

  const [janela, setJanela] = useState<Janela>(30);
  const [evolucao, setEvolucao] = useState<EvolucaoDeNutricao | null>(null);
  const [meta, setMeta] = useState<MetaDaJanela | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await buscarEvolucaoDeNutricao(token!, janela);
      setEvolucao(r.data);
      setMeta(r.meta);
      setError(false);
    } catch {
      // Os dados da janela ANTERIOR não podem ficar na tela: o chip diria "90
      // dias" sobre a série de 7. E o cadeado tem que sumir junto, senão ele
      // afirma um corte de plano que esta resposta não trouxe.
      setEvolucao(null);
      setMeta(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token, janela]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const dias: DiaDeNutricao[] = evolucao?.dias ?? [];

  // Estável entre renders: o gráfico refaz as coordenadas quando `points` troca
  // de identidade. Os nulos vão INTEIROS — filtrar os dias vazios aproximaria os
  // pontos e apagaria o buraco do eixo X, que é a mentira voltando por outra
  // porta.
  const pontos = useMemo(() => dias.map((d) => ({ date: d.dia, value: d.kcal })), [dias]);

  // O alvo do último dia que teve alvo. A meta pode ter mudado no meio da
  // janela, e nesse caso ela não vale para os dias de antes da troca — por isso
  // ela é dita em texto, e não desenhada como uma reta por cima de dias que
  // tinham outra meta.
  const alvoVigente = useMemo(() => {
    for (let i = dias.length - 1; i >= 0; i--) {
      const alvo = dias[i]?.alvo;
      if (alvo) return alvo;
    }
    return null;
  }, [dias]);

  const alvoMudou = useMemo(
    () => new Set(dias.filter((d) => d.alvo).map((d) => d.alvo!.kcal)).size > 1,
    [dias]
  );

  /**
   * Os macros do período: a soma dos dias com registro contra a soma dos alvos
   * DESSES MESMOS dias.
   *
   * Só entram os dias que têm registro E meta. Um dia com registro e sem meta
   * somaria consumo contra alvo zero e encheria a barra sem que houvesse nada a
   * encher — a barra diria "bateu" sobre um dia que não tinha o que bater.
   */
  const macros = useMemo(() => {
    const base = dias.filter((d) => d.registros > 0 && d.alvo);
    if (base.length === 0) return null;
    const somar = (f: (d: DiaDeNutricao) => number) => base.reduce((s, d) => s + f(d), 0);
    return {
      dias: base.length,
      // A meta vai arredondada: `MacroRow` arredonda o valor, mas NÃO a meta, e
      // uma soma de trinta floats apareceria na tela como "1806.0000000000002 g".
      proteina: { v: somar((d) => d.proteinG ?? 0), t: Math.round(somar((d) => d.alvo!.proteinG)) },
      carbo: { v: somar((d) => d.carbsG ?? 0), t: Math.round(somar((d) => d.alvo!.carbsG)) },
      gordura: { v: somar((d) => d.fatG ?? 0), t: Math.round(somar((d) => d.alvo!.fatG)) },
    };
  }, [dias]);

  /**
   * O convite: ontem ou anteontem sem registro nenhum.
   *
   * Hoje fica de fora de propósito — o dia ainda não acabou, e cobrar o almoço
   * de alguém às dez da manhã seria afirmar uma falta que não existe. Os dias
   * vêm do servidor em ordem, do mais antigo ao mais recente, com hoje na ponta:
   * por isso ontem é o penúltimo, e não uma conta de datas com o relógio do
   * aparelho (que é outro fuso e outra fonte de verdade).
   */
  const convite = useMemo(() => {
    const ontem = dias[dias.length - 2];
    const anteontem = dias[dias.length - 3];
    const vazio =
      ontem && ontem.registros === 0 ? ontem : anteontem && anteontem.registros === 0 ? anteontem : null;
    return vazio ? diaDaSemana(vazio.dia) : null;
  }, [dias]);

  // Máx de 460px (bom no web e no celular), descontando gutter da tela e padding
  // do cartão.
  const larguraDoGrafico = Math.min(width - spacing.gutter * 2 - spacing.md * 2, 460);

  if (loading) {
    return (
      <View style={styles.esqueleto}>
        <Skeleton width="45%" height={22} />
        <Skeleton height={40} radius={12} />
        <SkeletonCard lines={3} height={200} />
      </View>
    );
  }

  const resumo = evolucao?.resumo ?? null;
  const vazio = resumo !== null && resumo.diasComRegistro === 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!embedded && <Txt variant="titleScreen">Evolução da nutrição</Txt>}

      {/* A janela fica acima de tudo e sobrevive ao erro: é por ela que a pessoa
          tenta outra coisa quando o que está na tela não serve. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {JANELAS.map((d) => (
          <Chip
            key={d}
            label={`${d} dias`}
            icon={meta?.limitadoPor === "plano" ? "cadeado" : undefined}
            active={janela === d}
            onPress={() => setJanela(d)}
          />
        ))}
      </ScrollView>

      {/* O corte dito com todas as letras: sem isto a tela mostra sete dias com
          o chip de noventa aceso, e a pessoa conclui que o app perdeu o
          histórico dela. */}
      {meta?.limitadoPor === "plano" && (
        <TouchableOpacity onPress={() => nav.navigate("Subscription")} activeOpacity={0.85}>
          <Card level={1}>
            <Txt variant="bodyStrong">Você está vendo os últimos {meta.dias} dias</Txt>
            <Txt variant="caption" color={colors.text2} style={{ marginTop: 2 }}>
              As janelas maiores fazem parte do Pro. Seus registros continuam todos aqui.
            </Txt>
            <Txt variant="label" color={colors.lime} style={{ marginTop: spacing.s8 }}>
              Conhecer o Pro
            </Txt>
          </Card>
        </TouchableOpacity>
      )}

      {error && (
        <ErrorState
          message="Não foi possível carregar sua nutrição."
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      )}

      {/* Sem nenhum dia registrado o `LineChart` devolve `null` e some da tela.
          Sem este estado, a pessoa veria um branco sem explicação. */}
      {!error && vazio && (
        <EmptyState
          icon="grafico"
          title="Nada registrado nesta janela"
          description="O gráfico começa no seu primeiro dia registrado. Enquanto não houver dia nenhum, não há o que mostrar aqui — e o app não vai inventar."
          actionLabel="Registrar uma refeição"
          onAction={() => nav.navigate("Diario")}
        />
      )}

      {!error && resumo !== null && !vazio && (
        <>
          {/* Cabeçalho honesto: três números do MESMO peso, no mesmo cartão, e
              nenhum deles sozinho.

              A média é a que mente sem os outros dois: uma média de 12 dias
              apresentada como se fosse de 30 é exatamente o que esta tela
              existe para não fazer. A contagem tira essa possibilidade.

              E "dias dentro da meta" é a resposta quantitativa para "eu bati
              minha meta?" — a pergunta que uma linha de referência no gráfico
              responderia mentindo, porque a reta usa UM alvo e este número
              compara cada dia contra o alvo que valia NAQUELE dia.

              Empilhados em vez de lado a lado porque os três precisam do mesmo
              tamanho de número: em três colunas, "2450" em `metricMd` não cabe
              na largura de um celular de 360px e vaza do cartão. */}
          <Card level={1}>
            <LinhaDoResumo rotulo="Média por dia registrado" valor={resumo.mediaKcal ?? "—"} sufixo=" kcal" />
            <LinhaDoResumo
              rotulo="Dias registrados"
              valor={resumo.diasComRegistro}
              sufixo={` de ${resumo.diasNaJanela}`}
            />
            {/* Sem alvo nenhum na janela, esta linha some. "0 dias dentro da
                meta" para quem não tem meta nenhuma leria como erro da pessoa,
                e é só ausência de dieta. */}
            {alvoVigente && (
              <LinhaDoResumo rotulo="Dias dentro da meta" valor={resumo.diasDentroDoAlvo} />
            )}
            <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s12 }}>
              A média é só dos dias em que houve registro. Os outros não entram na conta.
            </Txt>
            {alvoVigente && (
              <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.xs }}>
                Cada dia é comparado com o alvo que valia naquele dia, e não com o de hoje.
              </Txt>
            )}
          </Card>

          {/* Gráfico: os dias vazios chegam como `null` e a linha quebra neles. */}
          <Card level={1}>
            <Txt variant="titleCard">Calorias por dia</Txt>
            <View style={{ marginTop: spacing.s16 }}>
              <LineChart
                points={pontos}
                width={larguraDoGrafico}
                formatValue={(v) => String(Math.round(v))}
              />
            </View>
            <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
              {resumo.diasComRegistro === 1
                ? "Um dia só ainda não faz curva: ele aparece como ponto, e o resto da janela fica como buraco."
                : "Onde a linha some, não houve registro. O app deixa o buraco à mostra em vez de inventar o dia."}
            </Txt>
            {alvoVigente && (
              <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.xs }}>
                Sua meta mais recente nesta janela é {alvoVigente.kcal} kcal por dia.
                {alvoMudou ? " Ela mudou dentro desta janela, então não vale para os dias anteriores à troca." : ""}
              </Txt>
            )}
          </Card>

          {/* Macros do período: a mesma barra do diário, com a soma no lugar do
              valor do dia. */}
          {macros && (
            <Card level={1}>
              <Txt variant="titleCard">Macros do período</Txt>
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <MacroRow label="Proteína" v={macros.proteina.v} t={macros.proteina.t} />
                <MacroRow label="Carbo" v={macros.carbo.v} t={macros.carbo.t} />
                <MacroRow label="Gordura" v={macros.gordura.v} t={macros.gordura.t} />
              </View>
              <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s12 }}>
                Soma {macros.dias === 1 ? "do dia" : `dos ${macros.dias} dias`} com registro e meta,
                contra a soma das metas desses mesmos dias.
              </Txt>
            </Card>
          )}

          {/* Convite. O toque é da Tarefa 9 — aqui só existem a condição e o
              texto. Quando ela chegar, este cartão vira o gatilho do
              `QuickFoodAdd` para o dia de `convite`; o gancho é este. */}
          {convite && (
            <Card level={2}>
              <Txt variant="titleCard">Faltou registrar {convite}. O que você comeu?</Txt>
              <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
                Dá para preencher um dia que já passou a qualquer momento.
              </Txt>
            </Card>
          )}
        </>
      )}

      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.gutter, gap: spacing.card },
  esqueleto: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    gap: spacing.card,
  },
  chips: { gap: spacing.s8, paddingVertical: spacing.xs },
  linhaDoResumo: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
});
