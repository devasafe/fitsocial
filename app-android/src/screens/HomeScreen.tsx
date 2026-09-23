import React, { useCallback, useEffect, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator } from "react-native";
import { notify, confirmDialog } from "../lib/notify";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { useContadores } from "../context/ContadoresContext";
import { updateSettings } from "../api/settings";
import { BadgeSobreposto } from "../components/Badge";
import { EsperaLonga, PASSOS } from "../components/Espera";
import { CenaLime, type Origem } from "../components/CenaLime";
import {
  useCena,
  origemDoToque,
  esperar,
  COBERTURA_MS,
  type ToqueBruto,
} from "../components/CenaContext";
import { Txt, Screen, Card, Button, MetricTile } from "../components/ui";
import { AvisosDoAcompanhamento } from "../components/AvisosDoAcompanhamento";
import { CartaoDoTreinador } from "../components/CartaoDoTreinador";
import { useAcompanhamento, treinadorDe } from "../hooks/useAcompanhamento";
import { QuickFoodAdd } from "../components/QuickFoodAdd";
import { CoachSheet } from "../components/CoachSheet";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import {
  getCurrentPlan,
  generatePlan,
  adjustPlan,
  generateDiet,
  zerarPlano,
  zerarParteDoPlano,
  getTreinoDeHoje,
  type Plan,
  type TreinoDeHoje,
} from "../api/plans";
import { getCheckInStats, type CheckInStats } from "../api/checkins";
import { getDay, type DaySummary } from "../api/nutrition";
import { getWaterDay, addWater, type WaterDay } from "../api/water";
import { coachLine } from "../lib/coachContext";
import { registrarEvento } from "../lib/eventos";
import { ApiHttpError } from "../api/client";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";
import { Icon } from "../components/Icon";

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { user, token, refreshUser } = useAuth();
  const { contadores, refrescar: refrescarContadores } = useContadores();
  const [plan, setPlan] = useState<Plan | null>(null);
  // Qual sessão é a de hoje, segundo o servidor (que calcula o dia em São
  // Paulo). Nulo enquanto não chega, ou quando a rota não existe ainda — o
  // deploy é manual, e o app pode rodar contra um servidor mais antigo.
  const [hoje, setHoje] = useState<TreinoDeHoje | null>(null);
  const [stats, setStats] = useState<CheckInStats | null>(null);
  const [day, setDay] = useState<DaySummary | null>(null);
  const [water, setWater] = useState<WaterDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [erroPlano, setErroPlano] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [escolhendoProgramacao, setEscolhendoProgramacao] = useState(false);
  const [gerandoDieta, setGerandoDieta] = useState(false);
  // Onde o dedo tocou: é daí que a gota nasce. Sem isso ela viria do centro,
  // e o efeito perderia a ligação com a causa.
  const [origemDaGota, setOrigemDaGota] = useState<Origem | null>(null);
  // Gerar o plano leva uns trinta segundos. Quem quiser sair da cena e ver a
  // Home enquanto isso, sai — a geração continua, e a EsperaLonga do card
  // conta a mesma história em uma linha.
  const [cenaDoPlano, setCenaDoPlano] = useState(true);
  const cena = useCena();

  useEffect(() => {
    if (generating) setCenaDoPlano(true);
  }, [generating]);

  // De onde vem o treino desta pessoa. Sem plano e sem escolha, a Home pergunta.
  const programacao = user?.settings?.programacao ?? null;
  const seguePropria = programacao === "propria";

  /**
   * Quem tem treinador não recebe treino da IA.
   *
   * Uma pergunta só serve os dois cartões daqui (este e o de avisos), e ela já
   * era feita: a Home pergunta por convites e mensagens a cada vinte segundos.
   * Com o treinador na mesma resposta, o cartão dele aparece e some sozinho,
   * sem recarregar a tela.
   *
   * O servidor recusa `POST /plans/generate` para quem tem treinador — esconder
   * os botões aqui é o mesmo assunto dito na tela, e não a regra em si.
   */
  const acompanhamento = useAcompanhamento();
  const treinador = treinadorDe(acompanhamento);
  /**
   * Enquanto não sei, não decido.
   *
   * Sem isto, toda abertura da Home piscava o cartão da IA e a oferta de gerar
   * um plano antes de a resposta chegar — para quem tem treinador, um convite
   * de alguns quadros para fazer o que o servidor vai recusar.
   */
  const seiQuemCuida = acompanhamento.carregado;

  async function escolherProgramacao(escolha: "plano" | "propria" | null, evento?: ToqueBruto) {
    setOrigemDaGota(origemDoToque(evento));
    setEscolhendoProgramacao(true);
    try {
      await updateSettings(token!, { programacao: escolha });
      await refreshUser();
      if (escolha === "plano") void handleGenerate();
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setEscolhendoProgramacao(false);
    }
  }

  /**
   * O treino prescrito chega pelo poll; o plano, não.
   *
   * `load()` só roda no foco da tela. Quem está com a Home aberta esperando o
   * primeiro treino via o cartão do treinador mudar lá embaixo enquanto o
   * cartão principal continuava dizendo "assim que ele montar" — até sair da
   * tela e voltar. O id da última prescrição é o sinal de que há o que buscar.
   */
  const ultimaPrescricao = treinador?.ultima?.plan ?? null;

  const reloadDay = useCallback(() => {
    getDay(token!, todayStr())
      .then(setDay)
      .catch(() => {});
  }, [token]);

  const reloadWater = useCallback(() => {
    getWaterDay(token!, todayStr())
      .then(setWater)
      .catch(() => {});
  }, [token]);

  async function quickWater(ml: number) {
    try {
      await addWater(token!, todayStr(), ml);
      reloadWater();
    } catch {
      /* best-effort */
    }
  }

  const load = useCallback(async () => {
    try {
      // O treino de hoje vem NO MESMO lote, e não depois.
      //
      // Buscado à parte, a Home saía do skeleton com `hoje === null` garantido,
      // caía no fallback e mostrava `sessions[0]` sob o rótulo "Treino de hoje"
      // por uma volta de rede inteira — a mentira que esta frente veio corrigir,
      // e clicável: tocar "Começar treino" nessa janela abria o check-in da
      // sessão errada e gravava o `sessionDay` errado.
      //
      // `undefined` no catch é diferente de `null`: significa "não consegui
      // saber", e aí o que já estava na tela continua valendo. Com `null`, um
      // blip de rede num refoco REBAIXAVA uma Home que já estava certa.
      const [p, s, h] = await Promise.all([
        getCurrentPlan(token!),
        getCheckInStats(token!),
        getTreinoDeHoje(token!)
          .then((r) => r.data)
          .catch(() => undefined),
      ]);
      setPlan(p);
      setStats(s.stats);
      if (h !== undefined) setHoje(h);
    } catch (err) {
      notify("Erro", (err as Error).message);
    } finally {
      setLoading(false);
    }
    // Best-effort — a nutrição do dia nunca quebra o carregamento da Home.
    // O sino não busca mais aqui: o número vem do contexto que serve todos os
    // badges, então não há dois lugares dizendo coisas diferentes.
    void refrescarContadores();
    getDay(token!, todayStr())
      .then(setDay)
      .catch(() => {});
    getWaterDay(token!, todayStr())
      .then(setWater)
      .catch(() => {});
  }, [token, refrescarContadores]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Prescrição nova detectada pelo poll: busca o plano sem esperar a pessoa
  // sair da tela e voltar.
  useEffect(() => {
    if (ultimaPrescricao) void load();
  }, [ultimaPrescricao, load]);

  async function handleGenerate() {
    setGenerating(true);
    setErroPlano(null);
    try {
      const { plan } = await generatePlan(token!);
      setPlan(plan);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 402) {
        navigation.navigate("Subscription");
      } else {
        // Fica na tela, com botão de tentar de novo, em vez de um alerta que
        // some e deixa a pessoa sem saber o que fazer.
        // Avisa TAMBÉM por notificação: o `erroPlano` só é desenhado dentro do
        // cartão "Como você treina?", que não existe para quem já tem treino —
        // e aí a mensagem do servidor ("quem escreve o seu treino é o seu
        // treinador") era jogada fora e o botão parecia não funcionar.
        setErroPlano((err as Error).message);
        notify("Não deu para gerar", (err as Error).message);
      }
    } finally {
      setGenerating(false);
    }
  }

  function handleRegenerate() {
    if (user?.tier === "premium") handleGenerate();
    else navigation.navigate("Subscription");
  }

  async function handleAdjust() {
    if (user?.tier !== "premium") {
      navigation.navigate("Subscription");
      return;
    }
    setAdjusting(true);
    try {
      const { plan } = await adjustPlan(token!);
      setPlan(plan);
      notify("Plano reajustado", "Seu coach atualizou o plano com base na sua evolução.");
    } catch (err) {
      notify("Não foi possível reajustar", (err as Error).message);
    } finally {
      setAdjusting(false);
    }
  }

  // Cada metade do plano existe por conta própria: dá para ter só a dieta
  // (quem treina pela programação do box) ou só o treino.
  // Por CONTEÚDO, não por existência. O servidor devolve a metade que falta
  // como forma vazia em vez de null — é o que impede o app instalado de fechar
  // ao fazer `plan.workout.sessions.map(...)` sem guarda.
  const temTreino = (plan?.workout?.sessions?.length ?? 0) > 0;
  const temDieta = (plan?.diet?.meals?.length ?? 0) > 0;

  // O que a pessoa ENCONTRA ao chegar. Quem cai numa Home sem plano e sem
  // preferência escolhida vê um cartão de decisão, não um treino — e é essa a
  // tela que precisa ser comparada, antes e depois, com a taxa de quem segue
  // para o registro.
  //
  // Espera `seiQuemCuida` de propósito: antes disso o cartão principal ainda
  // não decidiu o que mostrar, e o evento diria um estado que ninguém viu.
  const estadoDaHome = treinador
    ? "com_treinador"
    : temTreino
      ? "com_plano"
      : seguePropria
        ? "programacao_propria"
        : "sem_escolha";

  useEffect(() => {
    if (!seiQuemCuida) return;
    registrarEvento("home_viu", { estado: estadoDaHome });
    // Uma vez por estado: voltar para a Home dez vezes no mesmo dia não são dez
    // chegadas diferentes, e o funil conta pessoas, não visitas.
  }, [seiQuemCuida, estadoDaHome]);
  /**
   * O treino de hoje.
   *
   * Era `sessions[0]`: a Home mostrava sempre a primeira sessão do plano,
   * fosse terça ou domingo, e "Treino de hoje" era um rótulo que mentia. Agora
   * quem responde é o servidor, pelo dia da semana em São Paulo.
   *
   * A queda para `sessions[0]` continua de propósito: quem ainda não escolheu
   * os dias (`sem_agenda`) e quem roda contra um servidor sem a rota nova veem
   * exatamente o que viam antes, em vez de uma Home vazia.
   */
  const semAgenda = hoje === null || hoje.estado === "sem_agenda";
  const ehDescanso = hoje?.estado === "descanso";
  const todaySession = semAgenda ? plan?.workout?.sessions?.[0] : (hoje?.sessao ?? undefined);

  async function gerarDieta() {
    setGerandoDieta(true);
    try {
      const { plan } = await generateDiet(token!);
      setPlan(plan);
    } catch (err) {
      notify("Não deu para gerar a dieta", (err as Error).message);
    } finally {
      setGerandoDieta(false);
    }
  }

  function zerarTudo() {
    confirmDialog(
      "Zerar o plano?",
      "Seu treino e sua dieta são apagados, e você escolhe de novo como treina. Os treinos que você já registrou não são afetados.",
      async () => {
        try {
          await zerarPlano(token!);
          setPlan(null);
          await refreshUser();
        } catch (err) {
          notify("Não deu para zerar", (err as Error).message);
        }
      },
      "Zerar"
    );
  }

  function zerarParte(parte: "workout" | "diet") {
    const rotulo = parte === "workout" ? "o treino" : "a dieta";
    confirmDialog(
      `Zerar ${rotulo}?`,
      parte === "workout"
        ? "O treino é apagado e você escolhe de novo como treina. Sua dieta continua."
        : "A dieta é apagada. Seu treino continua.",
      async () => {
        try {
          const r = await zerarParteDoPlano(token!, parte);
          setPlan(r.data.plan);
          await refreshUser();
        } catch (err) {
          notify("Não deu para zerar", (err as Error).message);
        }
      },
      "Zerar"
    );
  }

  async function startToday(evento?: ToqueBruto) {
    // Pela cena do provedor, não pela daqui: esta tela some por baixo da pilha
    // assim que o treino abre, e a cena tem que continuar na frente.
    cena.abrir({ passos: PASSOS.comecarTreino, origem: origemDoToque(evento) });

    // Passagem, não espera: o treino não fica meio segundo mais longe por causa
    // de um efeito. A troca acontece escondida atrás do lime.
    await esperar(COBERTURA_MS);
    if (todaySession) navigation.navigate("CheckIn", { session: todaySession });
    else navigation.navigate("TodayWorkout");

    await esperar(360);
    cena.fechar();
  }

  if (loading) {
    return (
      <Screen scroll contentStyle={{ gap: spacing.md }}>
        <Skeleton width="55%" height={26} />
        {/* Três cartões do mesmo tamanho — treino, comida e água —, na mesma
            ordem em que chegam prontos. Um só, maior que os outros (como era
            antes), faria a tela "pular" ao sair do esqueleto. */}
        <SkeletonCard lines={1} height={104} />
        <SkeletonCard lines={1} height={104} />
        <SkeletonCard lines={1} height={104} />
        <View style={{ flexDirection: "row", gap: spacing.card }}>
          <View style={{ flex: 1 }}>
            <SkeletonCard lines={1} height={72} />
          </View>
          <View style={{ flex: 1 }}>
            <SkeletonCard lines={1} height={72} />
          </View>
          <View style={{ flex: 1 }}>
            <SkeletonCard lines={1} height={72} />
          </View>
        </View>
        <SkeletonCard lines={2} />
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={{ gap: spacing.md }}>
      {/* Antes de tudo, inclusive do cabeçalho: é o que alguém está esperando
          de você — um convite sem resposta ou uma mensagem sem ler. Some
          sozinho quando não há nada pendente. */}
      <AvisosDoAcompanhamento avisos={acompanhamento} />

      {/* Cabeçalho */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Txt variant="titleScreen">Olá, {user?.name?.split(" ")[0]}</Txt>
          {user?.isFounder && user?.founderMessage ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
              <Icon name="faisca" size={13} color={colors.lime} />
              {/* `flex: 1` porque no React Native o `flexShrink` padrão é 0:
                  sem isto a mensagem estoura para fora da coluna em vez de
                  quebrar, e o fundador lê meia frase. */}
              <Txt variant="label" color={colors.lime} style={{ flex: 1 }}>
                {user.founderMessage}
              </Txt>
            </View>
          ) : user?.tier === "premium" ? (
            <Txt variant="label" color={colors.text2} style={{ marginTop: 2 }}>
              Plano Premium
            </Txt>
          ) : (
            <TouchableOpacity onPress={() => navigation.navigate("Subscription")} activeOpacity={0.7}>
              <Txt variant="label" color={colors.lime} style={{ marginTop: 2 }}>
                Plano grátis · Seja Premium
              </Txt>
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
          <TouchableOpacity onPress={() => setCoachOpen(true)} activeOpacity={0.7} hitSlop={8}>
            <Icon name="faisca" size={22} color={colors.lime} accessibilityLabel="Falar com a assistente" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("Notificacoes")} activeOpacity={0.7} hitSlop={8}>
            <Icon name="sino" size={22} color={colors.text} accessibilityLabel="Notificações" />
            <BadgeSobreposto valor={contadores.notificacoes} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ---- Hoje: treino, comida e água, no mesmo tamanho e peso visual ----
           Os três andam juntos — nenhum é "mais importante" (pedido do dono).
           Antes o treino sozinho ocupava três blocos antes de a comida
           aparecer; agora é um cartão do tamanho dos outros dois, e quem quer
           o detalhe (lista de exercícios, ajustes, avisos) o encontra na tela
           do treino, que é para onde ele leva de qualquer forma. */}
      <Txt
        variant="label"
        color={colors.text2}
        style={{ marginTop: spacing.xs, textTransform: "uppercase", letterSpacing: 0.5 }}
      >
        Hoje
      </Txt>

      {temTreino && plan?.workout ? (
        /* AÇÃO PRINCIPAL — treino de hoje, começa em 1 toque. Tocar fora do
           botão abre a tela do treino, como nos cartões de comida e água. */
        <TouchableOpacity onPress={() => navigation.navigate("TodayWorkout")} activeOpacity={0.85}>
          <Card>
            <Txt variant="label" color={colors.text2}>
              {ehDescanso ? "Hoje" : "Treino de hoje"}
            </Txt>
            <Txt variant="titleSection" style={{ marginTop: 2 }}>
              {ehDescanso
                ? "Dia de descanso"
                : todaySession
                  ? todaySession.focus || todaySession.day
                  : plan.workout.split}
            </Txt>
            {/* Quem assinou. Só aparece quando há um nome para dizer: sem
                treinador, "seu coach" já é como o resto da tela chama a IA, e
                dois nomes para o mesmo sujeito na mesma tela confundem mais do
                que a ausência do rótulo. */}
            {plan.autor ? (
              <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                prescrito por {plan.autor.nome}
              </Txt>
            ) : treinador ? (
              // O plano é o velho, da IA, e já existe treinador: dizer isso é
              // melhor que deixar a tela afirmar duas coisas opostas ao mesmo
              // tempo — "montado pela assistente" aqui e "Fulana cuida do seu
              // treino" no cartão abaixo.
              <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                {`montado antes de ${treinador.profissional.nome.split(" ")[0]} assumir`}
              </Txt>
            ) : null}
            {/* Descanso planejado não é falta: o cartão diz isso e oferece o
                caminho, sem cobrar nada de ninguém (brief §7).
                Por isso o botão daqui — e o "Falar com" do estado com
                treinador — são secundários: a regra desta seção é UMA ação
                primária por compromisso do dia, e nestes dois estados não há
                compromisso de treino nenhum. Zero primário aqui é escolha, não
                esquecimento: preencher o botão criaria urgência falsa num dia
                em que a pessoa não deve nada. */}
            {ehDescanso ? (
              <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.xs }}>
                Nada marcado para hoje. Se quiser treinar assim mesmo, é só escolher.
              </Txt>
            ) : null}
            {ehDescanso ? (
              <Button
                title="Escolher um treino"
                variant="secondary"
                onPress={() => navigation.navigate("TodayWorkout")}
                style={{ marginTop: spacing.md }}
              />
            ) : (
              <Button
                title="Começar treino"
                onPress={(e) => void startToday(e)}
                style={{ marginTop: spacing.md }}
              />
            )}
          </Card>
        </TouchableOpacity>
      ) : seguePropria ? (
        /* Quem segue a programação do box não tem "treino de hoje" para abrir —
           tem um treino para registrar depois de fazer. Tocar fora do botão
           abre "Meus treinos", que antes era um link à parte. */
        <TouchableOpacity onPress={() => navigation.navigate("MinhasAtividades")} activeOpacity={0.85}>
          <Card>
            <Txt variant="label" color={colors.text2}>
              Hoje
            </Txt>
            <Txt variant="titleSection" style={{ marginTop: 2 }}>
              Treinou? Registra aqui.
            </Txt>
            <Button
              title="Registrar treino"
              onPress={() => navigation.navigate("Registrar")}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        </TouchableOpacity>
      ) : (
        !seiQuemCuida ? null : treinador ? (
        /* Com treinador, não há o que escolher: o treino dele está a caminho.
           Oferecer "montar um plano pra mim" aqui seria a IA disputando o lugar
           de quem já foi contratado — e o servidor recusaria de qualquer jeito. */
        <TouchableOpacity
          onPress={() =>
            navigation.navigate("Conversa", {
              linkId: treinador.id,
              nome: treinador.profissional.nome,
            })
          }
          activeOpacity={0.85}
        >
          <Card>
            <Txt variant="label" color={colors.text2}>
              Treino de hoje
            </Txt>
            <Txt variant="titleSection" style={{ marginTop: 2 }}>
              {treinador.profissional.nome} cuida do seu treino
            </Txt>
            <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.xs }}>
              Assim que o treino estiver pronto, ele aparece aqui — e você recebe um aviso.
            </Txt>
            <Button
              title={`Falar com ${treinador.profissional.nome.split(" ")[0]}`}
              variant="secondary"
              onPress={() =>
                navigation.navigate("Conversa", {
                  linkId: treinador.id,
                  nome: treinador.profissional.nome,
                })
              }
              style={{ marginTop: spacing.md }}
            />
          </Card>
        </TouchableOpacity>
      ) : (
        /* Ainda não escolheu. Três caminhos, e nenhum deles é obrigatório.
           É a única exceção ao "mesmo tamanho dos outros dois": uma decisão
           de configuração única (não um dado do dia) tem legitimamente mais
           conteúdo, e some assim que a pessoa escolhe. */
        <Card level={2}>
          <Txt variant="titleCard">Como você treina?</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm, marginBottom: spacing.md }}>
            Dá para mudar depois, em Configurações.
          </Txt>

          {erroPlano && !generating ? (
            <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
              <Txt variant="body" color={colors.danger}>
                {erroPlano}
              </Txt>
              <Button title="Tentar de novo" onPress={handleGenerate} size="lg" glow />
            </View>
          ) : null}

          {generating ? (
            <EsperaLonga ativo passos={PASSOS.plano} />
          ) : erroPlano ? null : (
            <View style={{ gap: spacing.sm }}>
              <Button
                title="Montar um plano pra mim"
                onPress={(e) => void escolherProgramacao("plano", e)}
                size="lg"
                glow
                disabled={escolhendoProgramacao}
              />
              <Button
                title="Sigo a programação do meu box"
                variant="secondary"
                onPress={() => void escolherProgramacao("propria")}
                disabled={escolhendoProgramacao}
              />
              <TouchableOpacity onPress={() => navigation.navigate("ImportPlan")} activeOpacity={0.7} style={{ paddingVertical: spacing.sm, alignItems: "center" }}>
                <Txt variant="bodyStrong" color={colors.text2}>
                  Já tenho um plano? Importar o meu
                </Txt>
              </TouchableOpacity>
            </View>
          )}
        </Card>
      )
      )}

      <NutritionToday
        day={day}
        fallbackTarget={plan?.diet?.dailyCalories}
        onOpen={() => navigation.navigate("Diario")}
        onRegister={() => setQuickAdd(true)}
      />

      <WaterToday water={water} onOpen={() => navigation.navigate("Agua")} onAdd={quickWater} />

      {/* ---- Daqui para baixo, nada depende de existir um plano ----
           Antes tudo isto vivia dentro do ramo "tem plano": quem não tinha via
           uma tela com um cartão só. Água, comida, constância e coach nunca
           dependeram de plano nenhum — estavam escondidos atrás dele.
           A constância (streak/semana/total) descia para cá de propósito: é
           reforço de quem já fez, não o convite do dia — esse é o trio acima. */}

      {stats && (
        <View style={{ flexDirection: "row", gap: spacing.card }}>
          <View style={{ flex: 1, borderRadius: 20, padding: spacing.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line }}>
            <Txt variant="metricLg" tabular color={colors.lime}>
              {stats.streak}
            </Txt>
            <Txt variant="label" color={colors.text2}>
              dias seguidos
            </Txt>
          </View>
          <MetricTile value={String(stats.week)} label="na semana" style={{ flex: 1 }} />
          <MetricTile value={String(stats.total)} label="no total" style={{ flex: 1 }} />
        </View>
      )}

      {/* Quem cuida do treino. Gente, quando há gente — e aí a IA desce para
          onde ela continua útil: tirar dúvida, e não mandar no plano. */}
      {!seiQuemCuida ? null : treinador ? (
        <>
          <CartaoDoTreinador
            treinador={treinador}
            temTreinoDele={plan?.autor?.id === treinador.profissional.id}
          />
          <TouchableOpacity
            onPress={() => setCoachOpen(true)}
            activeOpacity={0.7}
            style={{ alignItems: "center", paddingVertical: spacing.sm }}
          >
            <Txt variant="label" color={colors.text2}>
              Tirar dúvida com a assistente
            </Txt>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity onPress={() => setCoachOpen(true)} activeOpacity={0.85}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm }}>
              <Icon name="faisca" size={20} color={colors.lime} />
              <Txt variant="titleCard">Seu coach</Txt>
            </View>
            {stats && (
              <Txt variant="bodyStrong" style={{ marginBottom: spacing.sm }}>
                {coachLine(stats)}
              </Txt>
            )}
            <Txt variant="body" color={colors.text2}>
              {plan?.summary ?? "Pergunte sobre treino, técnica ou alimentação quando quiser."}
            </Txt>
            <Txt variant="label" color={colors.lime} style={{ marginTop: spacing.sm }}>
              Conversar com o coach
            </Txt>
          </Card>
        </TouchableOpacity>
      )}

      {/* Referência: cada metade aparece só se existir. */}
      {temTreino && plan?.workout ? (
        <NavRow title="Meu treino" sub={plan.workout.split} onPress={() =>
            navigation.navigate("Workout", {
              workout: plan.workout!,
              prescritoPor: plan.autor?.nome,
            })
          } />
      ) : null}
      {temDieta && plan?.diet ? (
        <NavRow title="Minha dieta" sub={`${plan.diet.dailyCalories} kcal por dia`} onPress={() => navigation.navigate("Diet", { diet: plan.diet! })} />
      ) : (
        /* Sem dieta — inclusive para quem segue a programação do box. Antes a
           dieta só existia dentro de um plano completo, então pedir dieta
           obrigava a gerar um treino que a pessoa não ia usar. */
        <TouchableOpacity onPress={() => void gerarDieta()} activeOpacity={0.7} disabled={gerandoDieta}>
          <Card>
            <Txt variant="titleCard">{gerandoDieta ? "Sua dieta" : "Quer uma dieta?"}</Txt>
            {gerandoDieta ? (
              <EsperaLonga ativo passos={PASSOS.dieta} style={{ marginTop: spacing.sm }} />
            ) : (
              <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.xs }}>
                O coach monta a partir do seu perfil. Independente do treino.
              </Txt>
            )}
          </Card>
        </TouchableOpacity>
      )}

      {/* Gerar, reajustar e importar somem para quem tem treinador: os três
          escreveriam por cima do que ele prescreveu. O servidor já recusa; o
          que muda aqui é não oferecer um botão que só pode dar erro. */}
      {temTreino && !treinador ? (
        /* Ações secundárias do plano de treino */
        <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing.xl, marginTop: spacing.sm }}>
          <TouchableOpacity onPress={handleAdjust} disabled={adjusting} activeOpacity={0.7}>
            <Txt variant="label" color={colors.text2}>
              {adjusting ? "Reajustando…" : "Pedir reajuste"}
            </Txt>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRegenerate} disabled={generating} activeOpacity={0.7}>
            <Txt variant="label" color={colors.text2}>
              {generating ? "Gerando…" : "Gerar novo plano"}
            </Txt>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("ImportPlan")} activeOpacity={0.7}>
            <Txt variant="label" color={colors.text2}>
              Importar plano
            </Txt>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Voltar atrás. Sempre disponível: escolher como treina não pode ser
          uma porta de mão única. */}
      {/* Zerar também some com treinador: `DELETE /plans/current` apagaria a
          prescrição inteira, e o treinador continuaria vendo no painel um
          treino que não existe mais. O servidor já recusa. */}
      {(plan || seguePropria) && !treinador ? (
        <View style={{ alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
          {temTreino && temDieta ? (
            <TouchableOpacity onPress={() => zerarParte("diet")} activeOpacity={0.7}>
              <Txt variant="label" color={colors.text3}>
                Zerar só a dieta
              </Txt>
            </TouchableOpacity>
          ) : null}
          {plan ? (
            <TouchableOpacity onPress={zerarTudo} activeOpacity={0.7}>
              <Txt variant="label" color={colors.danger}>
                Zerar meu plano e escolher de novo
              </Txt>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => void escolherProgramacao(null)}
              activeOpacity={0.7}
              disabled={escolhendoProgramacao}
            >
              <Txt variant="label" color={colors.text3}>
                Mudar como eu treino
              </Txt>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {plan?.disclaimer ? (
        <Txt variant="caption" color={colors.text3} style={{ textAlign: "center" }}>
          {plan.disclaimer}
        </Txt>
      ) : null}

      {/* A cena. Fica por cima de tudo, inclusive da barra de abas. */}
      <CenaLime
        visivel={generating && cenaDoPlano}
        origem={origemDaGota}
        passos={PASSOS.plano}
        aoPedirSaida={() => setCenaDoPlano(false)}
      />

      <QuickFoodAdd
        visible={quickAdd}
        token={token!}
        onClose={() => setQuickAdd(false)}
        onAdded={reloadDay}
      />
      <CoachSheet
        visible={coachOpen}
        token={token!}
        onClose={() => setCoachOpen(false)}
        onOpenSubscription={() => navigation.navigate("Subscription")}
        temTreinador={!!treinador}
      />
    </Screen>
  );
}

// Card de nutrição do dia: kcal registradas vs meta + barra + botão de
// registrar. Toque no card (fora do botão) abre o diário.
//
// Rótulo + linha principal + botão, do mesmo tamanho do cartão de treino ao
// lado: era número grande (metricMd, 28px) e um link minúsculo — maior e mais
// discreto ao mesmo tempo, o oposto de "mesmo peso" (brief da hierarquia).
function NutritionToday({ day, fallbackTarget, onOpen, onRegister }: { day: DaySummary | null; fallbackTarget?: number; onOpen: () => void; onRegister: () => void }) {
  const kcal = day?.totals.kcal ?? 0;
  // Sem plano não há meta — e sem meta o card mostra só o que foi comido, em
  // vez de "0 / 0 kcal". Registrar comida não devia depender de ter um plano.
  const target = day?.target?.dailyCalories ?? fallbackTarget ?? 0;
  const temMeta = target > 0;
  const pct = temMeta ? Math.min(1, kcal / target) : 0;
  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.85}>
      <Card>
        <Txt variant="label" color={colors.text2}>
          Nutrição de hoje
        </Txt>
        <Txt variant="titleSection" tabular style={{ marginTop: 2 }}>
          {kcal}
          <Txt variant="body" color={colors.text2}>
            {temMeta ? ` / ${target} kcal` : " kcal"}
          </Txt>
        </Txt>
        {temMeta ? (
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, marginTop: spacing.sm, overflow: "hidden" }}>
            <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.lime }} />
          </View>
        ) : null}
        {/* Primário, como o botão do treino. A regra desta seção é UMA ação
            primária por cartão: num fundo escuro, um botão preenchido em lima
            puxa o olho muito mais que 14px de altura ou espessura de borda, e
            deixar só o treino preenchido recriaria a hierarquia que esta tela
            existe para desfazer — só que na cor, em vez de na ordem. */}
        <Button title="Registrar refeição" onPress={onRegister} style={{ marginTop: spacing.md }} />
      </Card>
    </TouchableOpacity>
  );
}

// Card de água do dia: total vs meta + barra + os dois atalhos de quantidade.
// Toque no card (fora dos botões) abre a tela de água.
function WaterToday({ water, onOpen, onAdd }: { water: WaterDay | null; onOpen: () => void; onAdd: (ml: number) => void }) {
  const total = water?.total ?? 0;
  const goal = water?.goalMl ?? 2000;
  const pct = goal > 0 ? Math.min(1, total / goal) : 0;
  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.85}>
      <Card>
        <Txt variant="label" color={colors.text2}>
          Água de hoje
        </Txt>
        <Txt variant="titleSection" tabular style={{ marginTop: 2 }}>
          {total}
          <Txt variant="body" color={colors.text2}> / {goal} ml</Txt>
        </Txt>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, marginTop: spacing.sm, overflow: "hidden" }}>
          <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.info }} />
        </View>
        {/* Dois botões lado a lado, cada um com metade da largura: em
            ~360px, com o número grande acima, é aqui que uma quebra de
            linha dobraria a altura do cartão — por isso o texto do botão
            é curto e de uma linha só (o próprio Button já garante isso). */}
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
          {/* Só o +250 é primário: é a ação única deste cartão, e o +500 é
              atalho da MESMA ação, não uma concorrente. Dois preenchidos aqui
              dariam à água o dobro do peso do treino e da comida. */}
          <Button title="+250 ml" onPress={() => onAdd(250)} style={{ flex: 1 }} />
          <Button title="+500 ml" variant="secondary" onPress={() => onAdd(500)} style={{ flex: 1 }} />
        </View>
      </Card>
    </TouchableOpacity>
  );
}

function NavRow({ title, sub, onPress }: { title: string; sub: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Card style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Txt variant="titleCard">{title}</Txt>
          <Txt variant="label" color={colors.text2} style={{ marginTop: 2 }}>
            {sub}
          </Txt>
        </View>
          <Icon name="chevronDireita" size={20} color={colors.text3} />
      </Card>
    </TouchableOpacity>
  );
}
