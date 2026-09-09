// Onboarding por FORMULÁRIO (substitui o chat com IA) — a pessoa preenche os
// campos certos rapidinho. Gera a mesma ficha que o coach usa pra montar o plano.
import React, { useState } from "react";
import { View, TextInput } from "react-native";
import { notify } from "../lib/notify";
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

function numField(value: string, set: (t: string) => void, placeholder: string) {
  return (
    <TextInput
      value={value}
      onChangeText={set}
      placeholder={placeholder}
      placeholderTextColor={colors.text3}
      keyboardType="numeric"
      style={{
        flex: 1,
        backgroundColor: colors.surface2,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.chip,
        paddingHorizontal: spacing.md,
        paddingVertical: 12,
        color: colors.text,
        fontSize: 18,
        textAlign: "center",
        fontVariant: ["tabular-nums"],
      }}
    />
  );
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function OnboardingForm() {
  const { token, refreshUser } = useAuth();
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
      await refreshUser(); // libera o app (RootNavigator vai pras Tabs)
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
          Leva 1 minuto. O coach usa isso pra criar seu treino e sua dieta.
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

      <View style={{ gap: spacing.sm }}>
        <Txt variant="label" color={colors.text2}>
          Idade · Altura (cm) · Peso (kg)
        </Txt>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {numField(age, setAge, "Idade")}
          {numField(height, setHeight, "Altura")}
          {numField(weight, setWeight, "Peso")}
        </View>
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
      <Txt variant="caption" color={colors.text3} style={{ textAlign: "center", marginBottom: spacing.lg }}>
        As sugestões do coach não substituem profissional de saúde.
      </Txt>
    </Screen>
  );
}
