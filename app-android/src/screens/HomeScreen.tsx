import React, { useCallback, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator } from "react-native";
import { notify } from "../lib/notify";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, MetricTile } from "../components/ui";
import { getCurrentPlan, generatePlan, adjustPlan, type Plan } from "../api/plans";
import { getCheckInStats, type CheckInStats } from "../api/checkins";
import { ApiHttpError } from "../api/client";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { user, token, logout } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stats, setStats] = useState<CheckInStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

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

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <Screen scroll contentStyle={{ gap: spacing.md }}>
      {/* Cabeçalho */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Txt variant="titleScreen">Olá, {user?.name?.split(" ")[0]}</Txt>
          {user?.tier === "premium" ? (
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
        <TouchableOpacity onPress={logout} activeOpacity={0.7}>
          <Txt variant="label" color={colors.text3}>
            Sair
          </Txt>
        </TouchableOpacity>
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
          {/* Treino de hoje — cartão herói */}
          <Card level={2} sport="musculacao" style={{ marginTop: spacing.sm }}>
            <Txt variant="label" color={colors.text2}>
              Treino de hoje
            </Txt>
            <Txt variant="titleSection" style={{ marginTop: 2, marginBottom: spacing.md }}>
              {plan.workout.split}
            </Txt>
            <Button title="Começar treino" onPress={() => navigation.navigate("TodayWorkout")} size="lg" glow />
          </Card>

          {/* Sequência + semana + total */}
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

          {/* Atalhos */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.card }}>
            <Button title="Atividades" variant="secondary" onPress={() => navigation.navigate("MinhasAtividades")} style={{ flexBasis: "47%", flexGrow: 1 }} />
            <Button title="Recordes" variant="secondary" onPress={() => navigation.navigate("MeusPRs")} style={{ flexBasis: "47%", flexGrow: 1 }} />
            <Button title="Ranking" variant="secondary" onPress={() => navigation.navigate("Leaderboard")} style={{ flexBasis: "47%", flexGrow: 1 }} />
            <Button title="Evolução" variant="secondary" onPress={() => navigation.navigate("History")} style={{ flexBasis: "47%", flexGrow: 1 }} />
          </View>

          {/* Estratégia do coach */}
          <Card>
            <Txt variant="titleCard">Estratégia do seu coach</Txt>
            <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
              {plan.summary}
            </Txt>
          </Card>

          {/* Treino / Dieta */}
          <NavRow
            title="Meu treino"
            sub={plan.workout.split}
            onPress={() => navigation.navigate("Workout", { workout: plan.workout })}
          />
          <NavRow
            title="Minha dieta"
            sub={`${plan.diet.dailyCalories} kcal por dia`}
            onPress={() => navigation.navigate("Diet", { diet: plan.diet })}
          />

          <Button
            title={adjusting ? "Coach reajustando…" : "Pedir reajuste ao coach"}
            variant="secondary"
            onPress={handleAdjust}
            disabled={adjusting}
          />

          <Txt variant="caption" color={colors.text3}>
            {plan.disclaimer}
          </Txt>

          <TouchableOpacity onPress={handleRegenerate} disabled={generating} activeOpacity={0.7} style={{ paddingVertical: spacing.sm, alignItems: "center" }}>
            <Txt variant="label" color={colors.text2}>
              {generating ? "Gerando…" : "Gerar novo plano"}
            </Txt>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("ImportPlan")} activeOpacity={0.7} style={{ alignItems: "center" }}>
            <Txt variant="label" color={colors.text2}>
              Importar outro plano meu
            </Txt>
          </TouchableOpacity>
        </>
      )}
    </Screen>
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
