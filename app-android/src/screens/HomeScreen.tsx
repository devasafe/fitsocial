import React, { useCallback, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator } from "react-native";
import { notify } from "../lib/notify";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, MetricTile } from "../components/ui";
import { QuickFoodAdd } from "../components/QuickFoodAdd";
import { CoachSheet } from "../components/CoachSheet";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import { getCurrentPlan, generatePlan, adjustPlan, type Plan } from "../api/plans";
import { getCheckInStats, type CheckInStats } from "../api/checkins";
import { getDay, type DaySummary } from "../api/nutrition";
import { getWaterDay, addWater, type WaterDay } from "../api/water";
import { listNotifications } from "../api/notifications";
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
  const { user, token } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stats, setStats] = useState<CheckInStats | null>(null);
  const [day, setDay] = useState<DaySummary | null>(null);
  const [water, setWater] = useState<WaterDay | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);

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
    // Best-effort — sino e nutrição do dia nunca quebram o carregamento da Home.
    listNotifications(token!)
      .then((res) => setUnread(res.unread))
      .catch(() => {});
    getDay(token!, todayStr())
      .then(setDay)
      .catch(() => {});
    getWaterDay(token!, todayStr())
      .then(setWater)
      .catch(() => {});
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleGenerate() {
    setGenerating(true);
    try {
      const { plan } = await generatePlan(token!);
      setPlan(plan);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 402) {
        navigation.navigate("Subscription");
      } else {
        notify("Não foi possível gerar o plano", (err as Error).message);
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

  // Sessão de hoje = a primeira do plano (1 toque para começar; "escolher outro" leva à lista).
  const todaySession = plan?.workout.sessions?.[0];

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
            {unread > 0 && (
              <View
                style={{
                  position: "absolute",
                  top: -4,
                  right: -6,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  paddingHorizontal: 4,
                  backgroundColor: colors.lime,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Txt variant="caption" color={colors.onLime} style={{ fontSize: 10, lineHeight: 14 }}>
                  {unread > 9 ? "9+" : unread}
                </Txt>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {!plan ? (
        <Card level={2} style={{ marginTop: spacing.sm }}>
          <Txt variant="titleCard">Seu plano ainda não foi criado</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm, marginBottom: spacing.md }}>
            Seu coach monta um treino e uma dieta sob medida a partir do seu perfil. Leva alguns segundos.
          </Txt>
          {generating ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <ActivityIndicator color={colors.lime} />
              <Txt variant="body" color={colors.text2}>
                Montando seu plano…
              </Txt>
            </View>
          ) : (
            <>
              <Button title="Gerar meu plano" onPress={handleGenerate} size="lg" glow />
              <TouchableOpacity onPress={() => navigation.navigate("ImportPlan")} activeOpacity={0.7} style={{ paddingVertical: spacing.md, alignItems: "center" }}>
                <Txt variant="bodyStrong" color={colors.text2}>
                  Já tenho um plano? Importar o meu
                </Txt>
              </TouchableOpacity>
            </>
          )}
        </Card>
      ) : (
        <>
          {/* AÇÃO PRINCIPAL — treino de hoje, começa em 1 toque */}
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

          {/* Progresso do dia/semana */}
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

          {/* Nutrição de hoje — registro rápido + porta do diário */}
          <NutritionToday
            day={day}
            fallbackTarget={plan.diet.dailyCalories}
            onOpen={() => navigation.navigate("Diario")}
            onRegister={() => setQuickAdd(true)}
          />

          {/* Água de hoje */}
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
                {plan.summary}
              </Txt>
              <Txt variant="label" color={colors.lime} style={{ marginTop: spacing.sm }}>
                Conversar com o coach ›
              </Txt>
            </Card>
          </TouchableOpacity>

          {/* Referência: treino e dieta completos */}
          <NavRow title="Meu treino" sub={plan.workout.split} onPress={() => navigation.navigate("Workout", { workout: plan.workout })} />
          <NavRow title="Minha dieta" sub={`${plan.diet.dailyCalories} kcal por dia`} onPress={() => navigation.navigate("Diet", { diet: plan.diet })} />

          {/* Ações secundárias do plano */}
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

          <Txt variant="caption" color={colors.text3} style={{ textAlign: "center" }}>
            {plan.disclaimer}
          </Txt>
        </>
      )}

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
function NutritionToday({ day, fallbackTarget, onOpen, onRegister }: { day: DaySummary | null; fallbackTarget: number; onOpen: () => void; onRegister: () => void }) {
  const kcal = day?.totals.kcal ?? 0;
  const target = day?.target?.dailyCalories ?? fallbackTarget;
  const pct = target > 0 ? Math.min(1, kcal / target) : 0;
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
            {" "}
            / {target} kcal
          </Txt>
        </Txt>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, marginTop: spacing.sm, overflow: "hidden" }}>
          <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.lime }} />
        </View>
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
