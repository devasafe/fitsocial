// O que a pessoa vê no instante em que o treino entra no banco.
//
// Antes, salvar levava direto ao compositor de post: quem queria só registrar
// caía numa tela de escrever legenda, tocava "Agora não" e voltava às abas sem
// nenhuma confirmação de que o treino existia. Publicar e registrar eram a
// mesma ação, e não são.
//
// Aqui o treino JÁ ESTÁ SALVO. Nada nesta tela pode falhar, e nada nela é
// obrigatório: compartilhar é uma escolha, e "Agora não" é um fim legítimo.
//
// Sobre o verde: o brief (§2.2) proíbe fundo inundado de lima, e a cena do
// projeto (`CenaLime`) trata verde pleno como passagem, não como destino. Então
// o verde aqui é acento forte — disco sólido, painel em `limeSoft`, borda lima
// — sobre o fundo de sempre. Lê como tela de sucesso sem virar template.

import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, BackHandler, Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Txt, Button } from "../components/ui";
import { usePerguntaDePrivacidade } from "../components/PrivacidadeTreinos";
import { registrarEvento } from "../lib/eventos";
import { SalvarNoPlano } from "../components/SalvarNoPlano";
import { useAuth } from "../context/AuthContext";
import { getTreinoDeHoje } from "../api/plans";
import { sportLabel } from "../lib/sportLabel";
import { duracao, numero, ritmo, tituloDoTreino } from "../lib/formatoDeTreino";
import { colors, radius, spacing, sportColor } from "../theme";
import type { Activity } from "../api/activities";
import type { AppStackParams } from "../navigation/types";
import { Icon } from "../components/Icon";

type Props = NativeStackScreenProps<AppStackParams, "TreinoConcluido">;

/**
 * Os números do treino que acabou de ser salvo.
 *
 * Mais generoso que o cartão do feed de propósito: ali o assunto é o que foi
 * treinado, aqui é a prova de que o esforço virou dado. É o que o brief pede na
 * tela 17 — duração, volume, séries.
 */
function destaques(a: Activity): { valor: string; rotulo: string }[] {
  const m = a.metrics ?? {};
  // O registro rápido de força não manda duração; o servidor às vezes só grava
  // os minutos. Ler os dois evita mostrar "0min" para um treino real.
  const seg = a.durationSec > 0 ? a.durationSec : Math.round((m.minutes ?? 0) * 60);
  const out: { valor: string; rotulo: string }[] = [];

  if (a.kind === "endurance") {
    if ((m.distanceKm ?? 0) > 0) {
      out.push({ valor: `${numero(m.distanceKm!, 2)} km`, rotulo: "distância" });
    }
    if (seg > 0) out.push({ valor: duracao(seg), rotulo: "tempo" });
    if ((m.avgPaceSecPerKm ?? 0) > 0) {
      out.push({ valor: ritmo(m.avgPaceSecPerKm!), rotulo: "ritmo" });
    }
    return out;
  }

  if (a.kind === "strength") {
    if ((m.seriesValidas ?? 0) > 0) out.push({ valor: numero(m.seriesValidas!), rotulo: "séries" });
    if ((m.volumeTotalKg ?? 0) > 0) {
      out.push({ valor: `${numero(m.volumeTotalKg!)} kg`, rotulo: "volume" });
    }
    if (seg > 0) out.push({ valor: duracao(seg), rotulo: "tempo" });
    return out;
  }

  if (seg > 0) out.push({ valor: duracao(seg), rotulo: "tempo" });
  return out;
}

/** A linha sob o título: o esporte e, quando houver, o tamanho do treino. */
function subtitulo(a: Activity): string {
  const partes = [sportLabel(a.sportId)];
  const total = a.movimentosTotal ?? 0;
  if (a.kind === "strength" && total > 0) {
    partes.push(`${total} exercício${total > 1 ? "s" : ""}`);
  }
  return partes.join(" · ");
}

export function TreinoConcluidoScreen({ route, navigation }: Props) {
  const { activity, newPRs } = route.params;
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const { token } = useAuth();
  const perguntarPrivacidade = usePerguntaDePrivacidade();

  // O fim do caminho dentro do app, e o começo do caminho para fora dele: a
  // distância entre este evento e `compartilhar_tocou` é a taxa que diz se a
  // tela convence alguém a publicar.
  useEffect(() => {
    registrarEvento("concluido_viu", { kind: activity.kind });
  }, [activity.kind]);
  const cor = sportColor(activity.sportId);
  const stats = destaques(activity);

  // Pelo mesmo formatador do compositor: "Fran" e "Escalada indoor" vivem no
  // payload, e sem olhar lá a confirmação não menciona o que a pessoa escreveu.
  // Quando ele não tem nada melhor a dizer, devolve o nome do esporte — que a
  // linha de cima já diz. Repetir "Corrida / Corrida" é pior que não ter linha.
  const assunto = tituloDoTreino(activity);
  const mostrarAssunto = assunto && assunto !== sportLabel(activity.sportId);

  // O disco acompanha a fonte do sistema, e o check acompanha o disco.
  const disco = Math.round(72 * Math.min(Math.max(fontScale, 1), 2));

  // ---- "quer adicionar este treino ao plano?"
  //
  // Só faz sentido para um treino de musculação que NÃO veio da ficha: se ele
  // veio (`planLink`), ele já é uma sessão do plano, e perguntar seria oferecer
  // duplicar. Os outros esportes ficam de fora porque a ficha não tem esporte —
  // `Plan.workout` é musculação na prática.
  const podeVirarSessao =
    activity.kind === "strength" && activity.sportId === "musculacao" && !activity.planLink;
  const [ofereceSalvar, setOfereceSalvar] = useState(false);
  const [sheetAberta, setSheetAberta] = useState(false);
  const [salvoNoPlano, setSalvoNoPlano] = useState<string | null>(null);
  const [diaDeHoje, setDiaDeHoje] = useState(0);

  useEffect(() => {
    if (!podeVirarSessao) return;
    let vivo = true;
    // Uma ida ao servidor, e só no caso que a usa: é dela que vem o dia de hoje
    // (calculado em São Paulo, não pelo relógio do aparelho) e a permissão —
    // quem tem treinador não acrescenta sessão à prescrição.
    getTreinoDeHoje(token!)
      .then((r) => {
        if (!vivo) return;
        setDiaDeHoje(r.meta.diaDaSemana);
        setOfereceSalvar(r.meta.podeEditarPlano);
      })
      // Falhou? A tela de conclusão não depende disso para cumprir o papel
      // dela. A pergunta volta no próximo treino.
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [podeVirarSessao, token]);

  /** Sair para as abas. A pergunta de privacidade vem agora, e não antes: por
   *  cima desta tela seriam duas confirmações disputando a mesma atenção. */
  const agoraNao = useCallback(() => {
    navigation.navigate("Tabs");
    perguntarPrivacidade();
  }, [navigation, perguntarPrivacidade]);

  function compartilhar() {
    registrarEvento("compartilhar_tocou", { kind: activity.kind });
    navigation.navigate("CreatePost", { activity, newPRs: newPRs ?? [] });
    perguntarPrivacidade();
  }

  // Voltar do Android é sair, não voltar um passo.
  //
  // Preso ao FOCO, e não ao ciclo de vida: um native-stack não desmonta a tela
  // de baixo ao empilhar outra. Com `useEffect` o listener continuaria vivo por
  // baixo do compositor, e "voltar" lá — depois de escrever a legenda e subir a
  // foto — jogaria a pessoa nas abas com tudo perdido.
  //
  // No web o BackHandler é um stub que grita no console a cada montagem; lá o
  // treino já saiu da pilha (`replace`) e não há para onde voltar.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        agoraNao();
        return true;
      });
      return () => sub.remove();
    }, [agoraNao])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: spacing.gutter,
          paddingTop: insets.top + spacing.xl,
          paddingBottom: spacing.xl,
        }}
      >
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.limeSoft,
            borderWidth: 1,
            borderColor: colors.lime,
            borderRadius: radius.hero,
            paddingVertical: spacing.xl,
            paddingHorizontal: spacing.md,
          }}
        >
          <View
            style={{
              width: disco,
              height: disco,
              borderRadius: radius.full,
              backgroundColor: colors.lime,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="check" size={Math.round(disco * 0.44)} color={colors.onLime} strokeWidth={2.5} />
          </View>

          <Txt variant="titleScreen" style={{ marginTop: spacing.md, textAlign: "center" }}>
            Treino concluído
          </Txt>
          <Txt variant="label" color={cor} style={{ marginTop: spacing.xs, textAlign: "center" }}>
            {subtitulo(activity)}
          </Txt>
          {mostrarAssunto ? (
            <Txt variant="body" color={colors.text2} style={{ marginTop: 2, textAlign: "center" }}>
              {assunto}
            </Txt>
          ) : null}
        </View>

        {stats.length > 0 ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: spacing.xl,
              marginTop: spacing.lg,
            }}
          >
            {stats.map((s) => (
              <View key={s.rotulo} style={{ alignItems: "center" }}>
                <Txt variant="metricMd" tabular>
                  {s.valor}
                </Txt>
                <Txt variant="caption" color={colors.text3}>
                  {s.rotulo}
                </Txt>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* Fora da rolagem: a ação principal nunca fica abaixo da dobra, nem com
          a fonte grande do sistema. */}
      <View
        style={{
          paddingHorizontal: spacing.gutter,
          paddingTop: spacing.md,
          paddingBottom: insets.bottom + spacing.md,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          gap: spacing.sm,
        }}
      >
        <Txt variant="titleCard">Compartilhar no feed?</Txt>
        <Txt variant="body" color={colors.text2} style={{ marginBottom: spacing.sm }}>
          Seu treino já está salvo. Compartilhar é opcional — dá para fazer isso depois, pelo
          treino em Minhas atividades.
        </Txt>
        <Button title="Compartilhar no feed" onPress={compartilhar} size="lg" glow />

        {salvoNoPlano !== null ? (
          <View style={{ paddingVertical: spacing.sm }}>
            <Txt variant="label" color={colors.lime} style={{ textAlign: "center" }}>
              Guardado no seu plano
            </Txt>
            {salvoNoPlano ? (
              <Txt variant="caption" color={colors.text3} style={{ textAlign: "center", marginTop: 2 }}>
                {salvoNoPlano}
              </Txt>
            ) : null}
          </View>
        ) : ofereceSalvar ? (
          <Button
            title="Salvar no meu plano"
            variant="secondary"
            onPress={() => setSheetAberta(true)}
          />
        ) : null}

        <Button title="Agora não" variant="ghost" onPress={agoraNao} />
      </View>

      {ofereceSalvar ? (
        <SalvarNoPlano
          visivel={sheetAberta}
          aoFechar={() => setSheetAberta(false)}
          activityId={activity.id}
          nomeSugerido={assunto}
          diaSugerido={diaDeHoje}
          aoSalvar={(aviso) => {
            setSheetAberta(false);
            setSalvoNoPlano(aviso ?? "");
          }}
        />
      ) : null}
    </View>
  );
}
