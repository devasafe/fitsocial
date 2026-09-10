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
import { GerandoPlano, type Origem } from "../components/GerandoPlano";
import { Txt, Screen, Card, Button, MetricTile } from "../components/ui";
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
  type Plan,
} from "../api/plans";
import { getCheckInStats, type CheckInStats } from "../api/checkins";
import { getDay, type DaySummary } from "../api/nutrition";
import { getWaterDay, addWater, type WaterDay } from "../api/water";
import { coachLine } from "../lib/coachContext";
import { ApiHttpError } from "../api/client";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

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

  // De onde vem o treino desta pessoa. Sem plano e sem escolha, a Home pergunta.
  const programacao = user?.settings?.programacao ?? null;
  const seguePropria = programacao === "propria";

  async function escolherProgramacao(
    escolha: "plano" | "propria" | null,
    evento?: { nativeEvent: { pageX: number; pageY: number } }
  ) {
    if (evento) {
      setOrigemDaGota({ x: evento.nativeEvent.pageX, y: evento.nativeEvent.pageY });
    }
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
      const [p, s] = await Promise.all([getCurrentPlan(token!), getCheckInStats(token!)]);
      setPlan(p);
      setStats(s.stats);
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
        setErroPlano((err as Error).message);
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
  const todaySession = plan?.workout?.sessions?.[0];

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

  function startToday() {
    if (todaySession) navigation.navigate("CheckIn", { session: todaySession });
    else navigation.navigate("TodayWorkout");
  }

  if (loading) {
    return (
      <Screen scroll contentStyle={{ gap: spacing.md }}>
        <Skeleton width="55%" height={26} />
        <SkeletonCard lines={1} height={120} />
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
      {/* Cabeçalho */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Txt variant="titleScreen">Olá, {user?.name?.split(" ")[0]}</Txt>
          {user?.isFounder && user?.founderMessage ? (
            <Txt variant="label" color={colors.lime} style={{ marginTop: 2 }}>
              ✦ {user.founderMessage}
            </Txt>
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
            <Txt variant="titleCard" color={colors.lime}>✦</Txt>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("Notificacoes")} activeOpacity={0.7} hitSlop={8}>
            <Txt variant="titleCard">🔔</Txt>
            <BadgeSobreposto valor={contadores.notificacoes} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ---- Bloco de treino: muda conforme de onde vem a programação ---- */}
      {temTreino && plan?.workout ? (
        /* AÇÃO PRINCIPAL — treino de hoje, começa em 1 toque */
        <Card level={2} sport="musculacao" style={{ marginTop: spacing.sm }}>
          <Txt variant="label" color={colors.text2}>
            Treino de hoje
          </Txt>
          <Txt variant="titleSection" style={{ marginTop: 2, marginBottom: spacing.md }}>
            {todaySession ? todaySession.focus || todaySession.day : plan.workout.split}
          </Txt>
          <Button title="Começar treino" onPress={startToday} size="lg" glow />
          <TouchableOpacity onPress={() => navigation.navigate("TodayWorkout")} activeOpacity={0.7} style={{ paddingTop: spacing.md, alignItems: "center" }}>
            <Txt variant="label" color={colors.text2}>
              Escolher outro treino
            </Txt>
          </TouchableOpacity>
        </Card>
      ) : seguePropria ? (
        /* Quem segue a programação do box não tem "treino de hoje" para abrir —
           tem um treino para registrar depois de fazer. */
        <Card level={2} style={{ marginTop: spacing.sm }}>
          <Txt variant="label" color={colors.text2}>
            Hoje
          </Txt>
          <Txt variant="titleSection" style={{ marginTop: 2, marginBottom: spacing.md }}>
            Treinou? Registra aqui.
          </Txt>
          <Button title="Registrar treino" onPress={() => navigation.navigate("Registrar")} size="lg" glow />
          <TouchableOpacity onPress={() => navigation.navigate("MinhasAtividades")} activeOpacity={0.7} style={{ paddingTop: spacing.md, alignItems: "center" }}>
            <Txt variant="label" color={colors.text2}>
              Ver meus treinos
            </Txt>
          </TouchableOpacity>
        </Card>
      ) : (
        /* Ainda não escolheu. Três caminhos, e nenhum deles é obrigatório. */
        <Card level={2} style={{ marginTop: spacing.sm }}>
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
      )}

      {/* ---- Daqui para baixo, nada depende de existir um plano ----
           Antes tudo isto vivia dentro do ramo "tem plano": quem não tinha via
           uma tela com um cartão só. Água, comida, constância e coach nunca
           dependeram de plano nenhum — estavam escondidos atrás dele. */}

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

      <NutritionToday
        day={day}
        fallbackTarget={plan?.diet?.dailyCalories}
        onOpen={() => navigation.navigate("Diario")}
        onRegister={() => setQuickAdd(true)}
      />

      <WaterToday water={water} onOpen={() => navigation.navigate("Agua")} onAdd={quickWater} />

      {/* Coach contextual */}
      <TouchableOpacity onPress={() => setCoachOpen(true)} activeOpacity={0.85}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm }}>
            <Txt variant="titleCard" color={colors.lime}>✦</Txt>
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
            Conversar com o coach ›
          </Txt>
        </Card>
      </TouchableOpacity>

      {/* Referência: cada metade aparece só se existir. */}
      {temTreino && plan?.workout ? (
        <NavRow title="Meu treino" sub={plan.workout.split} onPress={() => navigation.navigate("Workout", { workout: plan.workout! })} />
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

      {temTreino ? (
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
      {plan || seguePropria ? (
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
      <GerandoPlano visivel={generating} origem={origemDaGota} passos={PASSOS.plano} />

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
      />
    </Screen>
  );
}

// Card de nutrição do dia: kcal registradas vs meta + barra. Toque no card abre o
// diário; "Registrar" abre o quick-add sem sair da Home.
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
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Txt variant="titleCard">Nutrição de hoje</Txt>
          <TouchableOpacity onPress={onRegister} hitSlop={8}>
            <Txt variant="label" color={colors.lime}>
              + Registrar
            </Txt>
          </TouchableOpacity>
        </View>
        <Txt variant="metricMd" tabular color={colors.text} style={{ marginTop: spacing.xs }}>
          {kcal}
          <Txt variant="titleSection" color={colors.text2}>
            {temMeta ? ` / ${target} kcal` : " kcal"}
          </Txt>
        </Txt>
        {temMeta ? (
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, marginTop: spacing.sm, overflow: "hidden" }}>
            <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.lime }} />
          </View>
        ) : null}
      </Card>
    </TouchableOpacity>
  );
}

// Card de água do dia: total vs meta + barra + atalho +250 ml. Toque abre a tela.
function WaterToday({ water, onOpen, onAdd }: { water: WaterDay | null; onOpen: () => void; onAdd: (ml: number) => void }) {
  const total = water?.total ?? 0;
  const goal = water?.goalMl ?? 2000;
  const pct = goal > 0 ? Math.min(1, total / goal) : 0;
  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.85}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Txt variant="titleCard">Água de hoje</Txt>
          <TouchableOpacity onPress={() => onAdd(250)} hitSlop={8}>
            <Txt variant="label" color={colors.info}>+ 250 ml</Txt>
          </TouchableOpacity>
        </View>
        <Txt variant="metricMd" tabular color={colors.text} style={{ marginTop: spacing.xs }}>
          {total}
          <Txt variant="titleSection" color={colors.text2}> / {goal} ml</Txt>
        </Txt>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, marginTop: spacing.sm, overflow: "hidden" }}>
          <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.info }} />
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
        <Txt variant="metricMd" color={colors.text3}>
          ›
        </Txt>
      </Card>
    </TouchableOpacity>
  );
}
