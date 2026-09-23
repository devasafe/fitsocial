// Edita a ficha (objetivo, dias de treino, o que a pessoa busca...) depois do
// onboarding. Existe porque não havia caminho nenhum para quem errou uma
// resposta ou mudou de objetivo — só dava para preencher uma vez.
//
// Salvar aqui só atualiza o DADO. Nunca gera plano sozinho: a pessoa pode ter
// pego o treino com um profissional, ou só querer corrigir o cadastro sem
// reabrir tudo. Depois de salvar, a tela OFERECE atualizar o plano — como
// escolha explícita, nunca como consequência automática do PATCH.
import React, { useCallback, useState } from "react";
import { View, TextInput, ActivityIndicator } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { notify, confirmDialog } from "../lib/notify";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Button, Chip, ErrorState } from "../components/ui";
import { getFicha, updateFicha, type Ficha } from "../api/ficha";
import { generatePlan } from "../api/plans";
import { ApiHttpError } from "../api/client";
import { colors, spacing, radius } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Goal = Ficha["goal"];
type Sex = Ficha["sex"];
type Level = Ficha["experienceLevel"];
type Nav = NativeStackNavigationProp<AppStackParams>;

// Mesmas opções do onboarding — é a mesma ficha, só editada depois.
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

function numField(value: string, set: (t: string) => void, label: string) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Txt variant="label" color={colors.text2}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={set}
        keyboardType="numeric"
        placeholderTextColor={colors.text3}
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

function textField(value: string, set: (t: string) => void, label: string, placeholder: string) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Txt variant="label" color={colors.text2}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={set}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        style={{
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.chip,
          paddingHorizontal: spacing.md,
          paddingVertical: 12,
          color: colors.text,
          fontSize: 15,
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

export function EditarFichaScreen() {
  const nav = useNavigation<Nav>();
  const { token, user } = useAuth();

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Diferente de erro: aqui não houve falha nenhuma, a pessoa só ainda não
  // preencheu. Virou caso comum desde que o formulário deixou de ser obrigatório
  // para entrar no app — antes disso, chegar aqui sem ficha era impossível.
  const [semFicha, setSemFicha] = useState(false);
  const [salvando, setSalvando] = useState(false);

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
  const [notes, setNotes] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await getFicha(token!);
      if (!data) {
        // Só chega aqui numa conta que nunca terminou o onboarding — a tela
        // não sabe inventar uma ficha, então manda a pessoa para o começo.
        setErro("Você ainda não preencheu sua ficha.");
        return;
      }
      setGoal(data.goal);
      setSex(data.sex);
      setLevel(data.experienceLevel);
      setAge(String(data.age));
      setHeight(String(data.heightCm));
      setWeight(String(data.weightKg));
      setDays(data.daysPerWeek);
      setMinutes(data.sessionMinutes);
      setDiet(data.dietaryRestrictions.join(", "));
      setInjuries(data.injuriesConditions.join(", "));
      setNotes(data.notes);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 404) setSemFicha(true);
      else setErro((err as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void carregar();
    }, [carregar])
  );

  function ofereceAtualizarPlano() {
    confirmDialog(
      "Atualizar seu plano também?",
      "Seus dados foram salvos. Se quiser, o coach pode gerar um plano novo com base neles — o que você já tem continua do jeito que está até você pedir.",
      () => void atualizarPlano(),
      "Gerar plano novo"
    );
  }

  async function atualizarPlano() {
    try {
      await generatePlan(token!);
      notify("Plano atualizado", "Seu coach gerou um plano novo com a ficha atual.");
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 402) {
        nav.navigate("Subscription");
        return;
      }
      // Inclui o caso de quem tem treinador/nutricionista: o servidor recusa
      // com uma mensagem própria ("quem escreve seu treino é seu treinador"),
      // e essa mensagem já é a explicação certa para mostrar aqui.
      notify("Não deu para gerar", (err as Error).message);
    }
  }

  async function salvar() {
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

    setSalvando(true);
    try {
      await updateFicha(token!, {
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
        notes,
      });
      ofereceAtualizarPlano();
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <Screen underHeader style={{ alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} />
      </Screen>
    );
  }

  if (semFicha) {
    return (
      <Screen underHeader contentStyle={{ gap: spacing.md }}>
        <Txt variant="titleScreen">Sua ficha</Txt>
        <Txt variant="body" color={colors.text2}>
          Você ainda não preencheu. É ela que o coach usa para montar seu treino e sua
          dieta — e dá para continuar usando o app sem ela.
        </Txt>
        <Button
          title="Preencher agora"
          onPress={() => nav.navigate("Onboarding", { pedido: true })}
          size="lg"
          glow
        />
      </Screen>
    );
  }

  if (erro) {
    return (
      <Screen underHeader>
        <ErrorState message={erro} onRetry={() => void carregar()} />
      </Screen>
    );
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.lg }}>
      <View>
        <Txt variant="titleScreen">Sua ficha</Txt>
        <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.xs }}>
          O que o coach usa para montar treino e dieta. Editar aqui não muda sozinho o plano que
          {user?.pro?.coach || user?.pro?.nutri ? " seu profissional" : " você já"} tem.
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
        {numField(age, setAge, "Idade")}
        {numField(height, setHeight, "Altura em cm")}
        {numField(weight, setWeight, "Peso em kg")}
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

      {textField(diet, setDiet, "Restrições alimentares (opcional)", "ex.: lactose, glúten")}
      {textField(injuries, setInjuries, "Lesões ou condições (opcional)", "ex.: joelho, hérnia")}
      {textField(notes, setNotes, "Notas (opcional)", "algo mais que o coach deva saber")}

      <Button title="Salvar" onPress={salvar} loading={salvando} size="lg" glow />
    </Screen>
  );
}
