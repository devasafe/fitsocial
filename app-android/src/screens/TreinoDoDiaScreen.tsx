// O que o "+" abre quando a pessoa escolhe Musculação.
//
// Antes, o "+" levava direto a um formulário em branco. Quem já tinha ficha não
// achava o treino dela por ali, remontava tudo na mão, e o treino registrado
// assim nem contava como adesão ao plano — o caminho livre não preenche
// `planLink`. Era a queixa de "eu me perco criando treino pelo +".
//
// Agora a tela pergunta ao servidor o que é hoje e mostra um de quatro estados
// (`data.estado`). O destino de "Começar treino" continua sendo o `CheckIn`, que
// já sabe executar uma sessão da ficha — não há tela nova de execução.

import React, { useCallback, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { notify } from "../lib/notify";
import { Txt, Screen, Card, Button, ErrorState, Chip } from "../components/ui";
import { SkeletonCard } from "../components/Skeleton";
import { ApiHttpError } from "../api/client";
import {
  getTreinoDeHoje,
  salvarAgenda,
  type TreinoDeHoje,
  type MetaDeHoje,
  type SessaoSemDia,
} from "../api/plans";
import { DIAS_CURTOS, diaPorExtenso } from "../lib/semana";
import { colors, spacing, radius, sportColor } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "TreinoDoDia">;

export function TreinoDoDiaScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const [hoje, setHoje] = useState<TreinoDeHoje | null>(null);
  const [meta, setMeta] = useState<MetaDeHoje | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<number | null>(null);
  // A tela de encaixe também se abre por vontade própria, para mudar os dias
  // depois de já os ter escolhido.
  const [editandoDias, setEditandoDias] = useState(false);

  const carregar = useCallback(() => {
    setErro(null);
    // Devolve a promise: quem salva a agenda precisa ESPERAR o recarregamento
    // antes de soltar o botão, senão o formulário some só depois de um instante
    // em que a tela parece não ter feito nada.
    return getTreinoDeHoje(token!)
      .then((r) => {
        setHoje(r.data);
        setMeta(r.meta);
      })
      .catch((e: Error) => {
        // Servidor mais antigo, sem a rota: o deploy é manual, e o APK pode
        // chegar antes da API. Aí o "+" volta a fazer o que sempre fez — abrir
        // o formulário — em vez de virar uma tela de erro.
        if (e instanceof ApiHttpError && e.status === 404) {
          navigation.replace("RegisterActivity", { sportId });
          return;
        }
        setErro(e.message);
      });
  }, [token, navigation, sportId]);

  // As duas saídas desta tela usam `replace`, então na prática isto roda uma
  // vez. Fica em `useFocusEffect` para o dia em que alguma delas virar
  // `navigate` — aí o que é "hoje" pode ter mudado enquanto a pessoa esteve fora.
  useFocusEffect(
    useCallback(() => {
      void carregar();
    }, [carregar])
  );

  function criarTreinoNovo() {
    navigation.replace("RegisterActivity", { sportId });
  }

  /**
   * Abre a sessão de um dia qualquer.
   *
   * A semana só traz o resumo de cada sessão — o suficiente para escolher. Os
   * exercícios vêm na ida ao servidor com `?dia=`, que é para isso que ele
   * existe: carregar as sete sessões inteiras de uma vez encheria a resposta de
   * coisa que quase nunca é aberta.
   */
  async function abrirDia(dia: number) {
    setAbrindo(dia);
    try {
      const r = await getTreinoDeHoje(token!, dia);
      if (!r.data.sessao) {
        notify("Sem treino nesse dia", "Escolha outro dia ou crie um treino novo.");
        return;
      }
      navigation.replace("CheckIn", { session: r.data.sessao });
    } catch (e) {
      notify("Não deu para abrir o treino", (e as Error).message);
    } finally {
      setAbrindo(null);
    }
  }

  if (erro) {
    return (
      <Screen scroll underHeader>
        <ErrorState message={erro} onRetry={() => void carregar()} />
        {/* A saída importa mais que a mensagem: desde que o "+" desvia por
            aqui, este é o ÚNICO caminho para registrar musculação. Sem isto,
            wi-fi ruim na academia significa não conseguir registrar o treino. */}
        <Button
          title="Criar treino novo"
          variant="secondary"
          onPress={criarTreinoNovo}
          style={{ marginTop: spacing.md }}
        />
      </Screen>
    );
  }
  if (!hoje || !meta) {
    return (
      <Screen scroll underHeader>
        <SkeletonCard lines={2} height={140} />
      </Screen>
    );
  }

  if (hoje.estado === "sem_agenda" || editandoDias) {
    return (
      <Encaixe
        sessoes={hoje.sessoes ?? []}
        versao={hoje.planVersion ?? undefined}
        aoSalvar={async () => {
          await carregar();
          setEditandoDias(false);
        }}
        aoPular={editandoDias ? () => setEditandoDias(false) : criarTreinoNovo}
        rotuloDeSaida={editandoDias ? "Cancelar" : "Agora não — quero só registrar um treino"}
      />
    );
  }

  const cor = sportColor(sportId);
  const sessao = hoje.sessao;

  return (
    <Screen scroll underHeader>
      <Txt variant="label" color={colors.text2}>
        {diaPorExtenso(hoje.diaDaSemana)}
      </Txt>

      {sessao ? (
        <Card level={2} sport={sportId} style={{ marginTop: spacing.sm }}>
          <Txt variant="titleSection">{sessao.focus || sessao.day}</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: 2 }}>
            {sessao.exercises.length} exercício{sessao.exercises.length > 1 ? "s" : ""}
          </Txt>
          <View style={{ height: spacing.md }} />
          <Button
            title="Começar treino"
            onPress={() => navigation.replace("CheckIn", { session: sessao })}
            size="lg"
            glow
          />
        </Card>
      ) : (
        <Card level={2} style={{ marginTop: spacing.sm }}>
          <Txt variant="titleSection">
            {hoje.estado === "sem_plano" ? "Você ainda não tem um treino montado" : "Hoje é descanso"}
          </Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
            {hoje.estado === "sem_plano"
              ? "Monte o treino de hoje e, se quiser, guarde ele no seu plano."
              : "Não há treino marcado para hoje. Dá para treinar assim mesmo."}
          </Txt>
          <View style={{ height: spacing.md }} />
          <Button title="Criar treino novo" onPress={criarTreinoNovo} size="lg" glow />
        </Card>
      )}

      {/* A semana. Só aparece quando há alguma coisa nela para escolher. */}
      {hoje.semana.some((d) => d.sessao) ? (
        <View style={{ marginTop: spacing.section }}>
          <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
            Sua semana
          </Txt>
          {hoje.semana.map((d) => (
            <TouchableOpacity
              key={d.diaDaSemana}
              disabled={!d.sessao || abrindo !== null}
              onPress={() => void abrirDia(d.diaDaSemana)}
              activeOpacity={0.8}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: spacing.md,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.md,
                borderRadius: radius.chip,
                borderWidth: 1,
                borderColor: d.diaDaSemana === meta.diaDaSemana ? cor : colors.line,
                backgroundColor: colors.surface,
                marginBottom: spacing.sm,
                // Sem o retorno do toque a linha não reage por um ou dois
                // segundos e a tela lê como travada.
                opacity: abrindo === d.diaDaSemana ? 0.5 : d.sessao ? 1 : 0.55,
              }}
            >
              <Txt variant="label" color={d.diaDaSemana === meta.diaDaSemana ? cor : colors.text2}>
                {DIAS_CURTOS[d.diaDaSemana]}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {d.sessao ? d.sessao.focus || d.sessao.day : "descanso"}
                </Txt>
              </View>
              {abrindo === d.diaDaSemana ? (
                <ActivityIndicator color={cor} />
              ) : d.sessao ? (
                <Txt variant="caption" color={colors.text3}>
                  {d.sessao.exerciciosCount} ex.
                </Txt>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {sessao ? (
        <Button
          title="Criar treino novo"
          variant="secondary"
          onPress={criarTreinoNovo}
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      {(hoje.sessoes?.length ?? 0) > 0 ? (
        <TouchableOpacity
          onPress={() => setEditandoDias(true)}
          activeOpacity={0.7}
          style={{ paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm }}
        >
          <Txt variant="label" color={colors.text2}>
            {meta.naoAgendadas > 0
              ? `Mudar meus dias · ${meta.naoAgendadas} treino${meta.naoAgendadas > 1 ? "s" : ""} sem dia`
              : "Mudar meus dias"}
          </Txt>
        </TouchableOpacity>
      ) : null}
    </Screen>
  );
}

// --------------------------------------------------------------- tela de encaixe

/**
 * "Em que dias você treina?" — a pergunta que se faz uma vez.
 *
 * Todo plano que já existe tem `day` em texto livre ("Dia A", "Dia B") e nenhum
 * dia da semana: ninguém nunca escolheu. O servidor manda um palpite lido do
 * próprio nome (`sugestao`), que só pré-preenche — o que vale é o que a pessoa
 * marcar aqui.
 */
function Encaixe({
  sessoes,
  versao,
  aoSalvar,
  aoPular,
  rotuloDeSaida,
}: {
  sessoes: SessaoSemDia[];
  versao?: number;
  aoSalvar: () => void | Promise<void>;
  aoPular: () => void;
  rotuloDeSaida: string;
}) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  // O que já está marcado ganha do palpite: quem volta aqui para mudar um dia
  // não pode encontrar a grade remontada pelo que o nome da sessão sugere.
  const [grade, setGrade] = useState<number[][]>(() =>
    sessoes.map((s) => (s.weekdays.length ? s.weekdays : s.sugestao))
  );
  const [salvando, setSalvando] = useState(false);

  /**
   * Marcar um dia o TIRA de quem o tinha.
   *
   * O servidor recusa o mesmo dia em duas sessões, e com razão — "o treino de
   * terça" não pode ter duas respostas. Resolver aqui faz a tela se comportar
   * como a pessoa espera (arrastei o treino para a terça) em vez de devolver um
   * erro sobre uma regra que ela não sabia que existia.
   */
  function alternar(iSessao: number, dia: number) {
    setGrade((prev) =>
      prev.map((dias, i) => {
        if (i !== iSessao) return dias.filter((d) => d !== dia);
        return dias.includes(dia) ? dias.filter((d) => d !== dia) : [...dias, dia].sort();
      })
    );
  }

  async function salvar() {
    if (grade.every((d) => d.length === 0)) {
      notify("Escolha pelo menos um dia", "Marque em que dia cada treino acontece.");
      return;
    }
    setSalvando(true);
    try {
      await salvarAgenda(
        token!,
        sessoes.map((s, i) => ({ indice: s.indice, day: s.day, weekdays: grade[i] ?? [] })),
        versao
      );
      // `salvando` continua ligado até a tela trocar: soltar antes deixa um
      // instante em que o botão parou e nada aconteceu, que lê como falha.
      await aoSalvar();
    } catch (e) {
      notify("Não deu para salvar os dias", (e as Error).message);
      setSalvando(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.gutter,
          paddingTop: spacing.md,
          paddingBottom: spacing.xl,
        }}
      >
        <Txt variant="titleScreen">Em que dias você treina?</Txt>
        <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
          Seu plano tem os treinos, mas ainda não sabe o dia de cada um. Isso é perguntado uma vez.
        </Txt>

        <View style={{ height: spacing.lg }} />

        {sessoes.map((s, i) => (
          <Card key={s.indice} style={{ marginBottom: spacing.card }}>
            <Txt variant="titleCard">{s.focus || s.day}</Txt>
            <View style={{ flexDirection: "row", gap: spacing.xs, marginTop: spacing.md }}>
              {DIAS_CURTOS.map((rotulo, dia) => (
                // Sete colunas iguais: em duas linhas quebradas a semana lia
                // como "5 + 2" desalinhado, e escolher terça virava procurar.
                <View key={dia} style={{ flex: 1 }}>
                  <Chip
                    label={rotulo}
                    active={(grade[i] ?? []).includes(dia)}
                    onPress={() => alternar(i, dia)}
                  />
                </View>
              ))}
            </View>
          </Card>
        ))}
      </ScrollView>

      {/* Fora da rolagem. No dia em que isto entra no ar TODO MUNDO cai nesta
          tela — ninguém nunca escolheu dia nenhum —, e com três sessões num
          aparelho estreito o botão nascia abaixo da dobra, sem nada na tela
          dizendo que havia algo embaixo. */}
      <View
        style={{
          paddingHorizontal: spacing.gutter,
          paddingTop: spacing.md,
          paddingBottom: insets.bottom + spacing.md,
          borderTopWidth: 1,
          borderTopColor: colors.line,
        }}
      >
        <Button title="Salvar meus dias" onPress={salvar} loading={salvando} size="lg" glow />
        <TouchableOpacity
          onPress={aoPular}
          disabled={salvando}
          activeOpacity={0.7}
          style={{ paddingVertical: spacing.md, alignItems: "center" }}
        >
          <Txt variant="label" color={colors.text2}>
            {rotuloDeSaida}
          </Txt>
        </TouchableOpacity>
      </View>
    </View>
  );
}
