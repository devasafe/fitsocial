// Onboarding por FORMULÁRIO (substitui o chat com IA) — a pessoa preenche os
// campos certos rapidinho. Gera a mesma ficha que o coach usa pra montar o plano.
import React, { useState, useEffect, useRef } from "react";
import { View, TextInput } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { notify } from "../lib/notify";
import { registrarEvento } from "../lib/eventos";
import type { AppStackParams } from "../navigation/types";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Button, Chip } from "../components/ui";
import { submitProfile, type ProfileForm } from "../api/onboarding";
import { colors, spacing, radius } from "../theme";

type Goal = ProfileForm["goal"];
type Sex = ProfileForm["sex"];
type Level = ProfileForm["experienceLevel"];

const GOALS: { key: Goal; label: string }[] = [
  { key: "perder_gordura", label: "Perder gordura" },
  { key: "ganhar_massa", label: "Ganhar massa" },
  { key: "saude_geral", label: "Saúde geral" },
  { key: "performance", label: "Performance" },
];
const SEXES: { key: Sex; label: string }[] = [
  { key: "masculino", label: "Masculino" },
  { key: "feminino", label: "Feminino" },
  { key: "outro", label: "Outro" },
];
const LEVELS: { key: Level; label: string }[] = [
  { key: "iniciante", label: "Iniciante" },
  { key: "intermediario", label: "Intermediário" },
  { key: "avancado", label: "Avançado" },
];
const DAYS = [1, 2, 3, 4, 5, 6, 7];
const MINUTES = [30, 45, 60, 90];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Txt variant="label" color={colors.text2}>
        {title}
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{children}</View>
    </View>
  );
}

// Um campo por linha, com o rótulo em cima. Lado a lado, cada um ficava com um
// terço da largura e o número não cabia em tela estreita.
function numField(
  value: string,
  set: (t: string) => void,
  label: string,
  placeholder: string
) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Txt variant="label" color={colors.text2}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={set}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType="numeric"
        style={{
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.chip,
          paddingHorizontal: spacing.md,
          paddingVertical: 12,
          color: colors.text,
          fontSize: 18,
          fontVariant: ["tabular-nums"],
        }}
      />
    </View>
  );
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Onde o que foi digitado fica enquanto a pessoa não termina.
 *
 * Sem isto, fechar o app no meio do formulário apagava tudo: na volta, os oito
 * campos estavam em branco de novo. Quem já tinha desistido uma vez não
 * recomeça do zero uma segunda.
 */
const RASCUNHO = "fitsocial.onboarding.rascunho";

export function OnboardingForm() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token, user, refreshUser } = useAuth();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [diet, setDiet] = useState("");
  const [injuries, setInjuries] = useState("");
  const [saving, setSaving] = useState(false);

  // Quantos dos campos obrigatórios estão preenchidos AGORA. Fica numa ref, e
  // não em estado, porque quem lê é a saída da tela: o efeito de desmontagem
  // roda uma vez só, com o valor que ele capturou na montagem — e leria zero
  // para todo mundo se dependesse do estado.
  const preenchidos = useRef(0);
  preenchidos.current = [goal, sex, level, days, minutes].filter(Boolean).length
    + [age, height, weight].filter((v) => v.trim() !== "").length;

  const concluiu = useRef(false);
  const [carregando, setCarregando] = useState(true);

  // Volta o que ficou pela metade na última vez.
  useEffect(() => {
    (async () => {
      try {
        const cru = await AsyncStorage.getItem(RASCUNHO);
        if (cru) {
          const r = JSON.parse(cru) as Record<string, unknown>;
          if (r.goal) setGoal(r.goal as Goal);
          if (r.sex) setSex(r.sex as Sex);
          if (r.level) setLevel(r.level as Level);
          if (typeof r.age === "string") setAge(r.age);
          if (typeof r.height === "string") setHeight(r.height);
          if (typeof r.weight === "string") setWeight(r.weight);
          if (typeof r.days === "number") setDays(r.days);
          if (typeof r.minutes === "number") setMinutes(r.minutes);
          if (typeof r.diet === "string") setDiet(r.diet);
          if (typeof r.injuries === "string") setInjuries(r.injuries);
        }
      } catch {
        // Rascunho corrompido é rascunho perdido, e só isso: o formulário abre
        // vazio, como abria antes de existir rascunho nenhum.
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  // Guarda a cada mudança. Só depois de carregar, senão o estado inicial vazio
  // sobrescreveria o rascunho que acabou de ser lido.
  useEffect(() => {
    if (carregando) return;
    void AsyncStorage.setItem(
      RASCUNHO,
      JSON.stringify({ goal, sex, level, age, height, weight, days, minutes, diet, injuries })
    ).catch(() => {});
  }, [carregando, goal, sex, level, age, height, weight, days, minutes, diet, injuries]);

  // Rede de segurança da mudança de 23/09/2026.
  //
  // `initialRouteName` só é lido quando o navegador MONTA. Enquanto esta tela
  // era a única rota registrada, a árvore se reconstruía sozinha assim que a
  // ficha existia e ninguém precisava sair daqui. Agora, se por qualquer motivo
  // alguém com a ficha pronta cair nesta tela — dados chegando fora de ordem no
  // boot, ficha preenchida em outro aparelho — nada a tiraria daqui.
  useEffect(() => {
    if (user?.onboardingComplete) nav.replace("Tabs");
  }, [user?.onboardingComplete, nav]);

  // Saber QUANTOS campos a pessoa preencheu antes de desistir é o dado que diz
  // se o formulário é longo demais ou se ela nem começou.
  useEffect(() => {
    registrarEvento("onboarding_abriu");
    return () => {
      if (!concluiu.current) {
        registrarEvento("onboarding_saiu", { campos: preenchidos.current });
      }
    };
  }, []);

  async function save() {
    const a = Number(age);
    const h = Number(height);
    const w = Number(weight.replace(",", "."));
    if (!goal || !sex || !level || !days || !minutes) {
      notify("Faltou escolher", "Selecione objetivo, sexo, experiência, dias e duração.");
      return;
    }
    if (!(a >= 12 && a <= 100)) return notify("Idade inválida", "Informe uma idade entre 12 e 100.");
    if (!(h >= 100 && h <= 250)) return notify("Altura inválida", "Informe a altura em cm (100–250).");
    if (!(w >= 30 && w <= 400)) return notify("Peso inválido", "Informe o peso em kg (30–400).");

    setSaving(true);
    try {
      await submitProfile(token!, {
        goal,
        sex,
        age: a,
        heightCm: h,
        weightKg: w,
        experienceLevel: level,
        daysPerWeek: days,
        sessionMinutes: minutes,
        dietaryRestrictions: splitList(diet),
        injuriesConditions: splitList(injuries),
        notes: "",
      });
      concluiu.current = true;
      registrarEvento("onboarding_concluiu");
      await AsyncStorage.removeItem(RASCUNHO).catch(() => {});
      await refreshUser();
      // Navegar aqui virou obrigação: antes, `refreshUser` trocava a árvore de
      // rotas e isto acontecia sozinho. Agora as rotas existem desde o começo,
      // então ninguém sai desta tela por nós. `replace` para o formulário não
      // ficar no histórico — ele já cumpriu o que tinha para cumprir.
      nav.replace("Tabs");
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll contentStyle={{ gap: spacing.lg }}>
      <View>
        <Txt variant="titleScreen">Vamos montar seu perfil</Txt>
        <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.xs }}>
          Leva 1 minuto, e o coach usa isso pra criar seu treino e sua dieta. Dá para
          deixar pra depois — o que você preencher fica salvo.
        </Txt>
      </View>

      <Section title="Seu objetivo">
        {GOALS.map((g) => (
          <Chip key={g.key} label={g.label} active={goal === g.key} onPress={() => setGoal(g.key)} />
        ))}
      </Section>

      <Section title="Sexo">
        {SEXES.map((s) => (
          <Chip key={s.key} label={s.label} active={sex === s.key} onPress={() => setSex(s.key)} />
        ))}
      </Section>

      <View style={{ gap: spacing.md }}>
        {numField(age, setAge, "Idade", "28")}
        {numField(height, setHeight, "Altura em cm", "175")}
        {numField(weight, setWeight, "Peso em kg", "72")}
      </View>

      <Section title="Sua experiência">
        {LEVELS.map((l) => (
          <Chip key={l.key} label={l.label} active={level === l.key} onPress={() => setLevel(l.key)} />
        ))}
      </Section>

      <Section title="Dias de treino por semana">
        {DAYS.map((d) => (
          <Chip key={d} label={String(d)} active={days === d} onPress={() => setDays(d)} />
        ))}
      </Section>

      <Section title="Tempo por treino">
        {MINUTES.map((m) => (
          <Chip key={m} label={`${m} min`} active={minutes === m} onPress={() => setMinutes(m)} />
        ))}
      </Section>

      <View style={{ gap: spacing.sm }}>
        <Txt variant="label" color={colors.text2}>
          Restrições alimentares (opcional)
        </Txt>
        <TextInput
          value={diet}
          onChangeText={setDiet}
          placeholder="ex.: lactose, glúten"
          placeholderTextColor={colors.text3}
          style={{ backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 12, color: colors.text, fontSize: 15 }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Txt variant="label" color={colors.text2}>
          Lesões ou condições (opcional)
        </Txt>
        <TextInput
          value={injuries}
          onChangeText={setInjuries}
          placeholder="ex.: joelho, hérnia"
          placeholderTextColor={colors.text3}
          style={{ backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 12, color: colors.text, fontSize: 15 }}
        />
      </View>

      <Button title="Criar meu perfil" onPress={save} loading={saving} size="lg" glow />

      {/* A saída. Ela é o ponto desta mudança inteira: o plano do coach é UM dos
          caminhos do app, e quem ainda não quer responder oito perguntas também
          tem o que fazer aqui — registrar o treino que acabou de fazer, por
          exemplo. O que estiver preenchido fica guardado para a volta. */}
      <Button
        title="Agora não, quero ver o app"
        variant="ghost"
        onPress={() => {
          registrarEvento("onboarding_adiou", { campos: preenchidos.current });
          nav.replace("Tabs");
        }}
      />

      <Txt variant="caption" color={colors.text3} style={{ textAlign: "center", marginBottom: spacing.lg }}>
        As sugestões do coach não substituem profissional de saúde.
      </Txt>
    </Screen>
  );
}
