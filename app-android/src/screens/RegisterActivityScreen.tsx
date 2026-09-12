import React, { useState } from "react";
import { View, TextInput, TouchableOpacity } from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button } from "../components/ui";
import { SuggestField, type Suggestion } from "../components/SuggestField";
import { createActivity } from "../api/activities";
import { searchExercises, MUSCLE_GROUPS, type MuscleGroup, type ExerciseDef } from "../api/library";
import { lastEntries, type LastEntry } from "../api/checkins";
import { usePRCelebration } from "../components/PRCelebration";
import { usePerguntaDePrivacidade } from "../components/PrivacidadeTreinos";
import { colors, spacing, radius, sportColor } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterActivity">;

const STRENGTH_VARIANTS = ["musculacao", "calistenia", "powerlifting", "lpo"];

interface SetForm {
  weightKg: string;
  reps: string;
}
interface ExerciseForm {
  name: string;
  sets: SetForm[];
  /** Preenchidos quando o exercício veio do catálogo; a pessoa pode marcar o
   *  músculo à mão quando digitou um nome que o app não conhece. */
  exerciseId?: string | null;
  muscle?: MuscleGroup | null;
}

// Campo numérico com o rótulo em cima — o mesmo padrão do cadastro da pessoa
// (OnboardingForm). Lado a lado, cada um ficava com metade da largura menos o
// padding, e no navegador os dois nem cabiam: campo de texto não encolhe abaixo
// da largura que o conteúdo pede, então a linha estourava para fora da tela.
function NumInput({
  value,
  onChangeText,
  label,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Txt variant="label" color={colors.text2}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType="numeric"
        style={{
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.chip,
          paddingVertical: 12,
          paddingHorizontal: spacing.md,
          color: colors.text,
          fontSize: 20,
          fontVariant: ["tabular-nums"],
        }}
      />
    </View>
  );
}

/**
 * Qual músculo, quando o app não sabe.
 *
 * Só aparece para quem digitou o nome em vez de escolher da lista: aí o
 * servidor vai ter que adivinhar pelo nome, e às vezes não dá — "aquele
 * aparelho do canto" não é ninguém. Um toque aqui resolve de vez, e o treino
 * aparece no feed dizendo o que foi treinado.
 *
 * É opcional de propósito. Registrar treino tem que caber em segundos; isto é
 * uma oferta, nunca uma pergunta que trava o salvamento.
 */
function MusculoDoExercicio({
  visivel,
  escolhido,
  aoEscolher,
}: {
  visivel: boolean;
  escolhido: MuscleGroup | null;
  aoEscolher: (m: MuscleGroup | null) => void;
}) {
  if (!visivel) return null;

  return (
    <View style={{ marginTop: -2, marginBottom: spacing.md }}>
      <Txt variant="caption" color={colors.text3} style={{ marginBottom: spacing.xs }}>
        Qual músculo? (opcional)
      </Txt>
      {/* `rowGap` maior que `columnGap`: com 4px entre as fileiras, errar o
          toque marca o grupo da linha de cima. */}
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", rowGap: spacing.sm, columnGap: spacing.xs }}
      >
        {MUSCLE_GROUPS.map((m) => {
          const ativo = m === escolhido;
          return (
            <TouchableOpacity
              key={m}
              // Tocar no que já está marcado desmarca: dá para voltar atrás sem
              // ter que escolher outro grupo errado para se livrar do primeiro.
              onPress={() => aoEscolher(ativo ? null : m)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: ativo }}
              style={{
                // 44px: é tocado com o celular na mão, no meio do treino.
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: spacing.sm,
                borderRadius: radius.chip,
                borderWidth: 1,
                borderColor: ativo ? colors.lime : colors.line,
                backgroundColor: ativo ? colors.limeSoft : colors.surface2,
              }}
            >
              <Txt variant="caption" color={ativo ? colors.lime : colors.text2}>
                {m}
              </Txt>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export function RegisterActivityScreen({ route, navigation }: Props) {
  const { sportId, prefill } = route.params;
  const { token } = useAuth();
  const celebratePR = usePRCelebration();
  const perguntarPrivacidade = usePerguntaDePrivacidade();
  const [exercises, setExercises] = useState<ExerciseForm[]>(
    prefill && prefill.length ? prefill : [{ name: "", sets: [{ weightKg: "", reps: "" }] }]
  );
  const [last, setLast] = useState<Record<string, LastEntry>>({}); // última vez por exercício
  // Qual campo de exercício está com a lista de sugestões aberta. Enquanto
  // estiver, nada é desenhado embaixo dele.
  const [buscandoEm, setBuscandoEm] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Ao escolher um exercício, mostra a última vez e pré-preenche a 1ª série se vazia.
  //
  // Guarda também o id e o músculo do catálogo. O autocomplete já mostrava
  // "Quadríceps · Barra" na sugestão e jogava fora ao escolher — só o texto
  // sobrevivia, e o treino salvo ficava indistinguível de um nome digitado.
  async function pickExercise(ei: number, sug: Suggestion) {
    const doCatalogo = sug.data as ExerciseDef | undefined;
    const name = sug.label;
    setExercise(ei, { name, exerciseId: sug.id, muscle: doCatalogo?.muscle ?? null });
    if (last[name]) return;
    try {
      const e = await lastEntries(token!, [name]);
      const le = e[name];
      if (!le) return;
      setLast((prev) => ({ ...prev, [name]: le }));
      setExercises((prev) =>
        prev.map((ex, idx) => {
          if (idx !== ei) return ex;
          // A busca da "última vez" é assíncrona e este preenchimento é por
          // ÍNDICE. Se a pessoa trocou o exercício durante a ida e volta, a
          // carga do exercício antigo cairia no campo do novo.
          if (ex.name !== name) return ex;
          const s0 = ex.sets[0];
          if (!s0 || s0.weightKg !== "" || s0.reps !== "") return ex;
          const sets = [...ex.sets];
          sets[0] = { weightKg: le.weightKg ? String(le.weightKg) : "", reps: le.reps ? String(le.reps) : "" };
          return { ...ex, sets };
        })
      );
    } catch {
      /* sem dado da última vez — segue normal */
    }
  }

  function setExercise(i: number, patch: Partial<ExerciseForm>) {
    setExercises((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function setSet(ei: number, si: number, patch: Partial<SetForm>) {
    setExercises((prev) =>
      prev.map((e, idx) =>
        idx === ei ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : e
      )
    );
  }
  function addSet(ei: number) {
    setExercises((prev) =>
      prev.map((e, idx) => (idx === ei ? { ...e, sets: [...e.sets, { weightKg: "", reps: "" }] } : e))
    );
  }
  function addExercise() {
    setExercises((prev) => [
      ...prev,
      { name: "", sets: [{ weightKg: "", reps: "" }], exerciseId: null, muscle: null },
    ]);
  }

  /**
   * Digitou por cima do que tinha escolhido: o vínculo com o catálogo morre.
   * Manter o id de "Supino reto" num campo que agora diz "Agachamento" é pior
   * que não ter id nenhum.
   */
  function digitouNome(ei: number, texto: string) {
    setExercises((prev) =>
      prev.map((e, idx) => {
        if (idx !== ei) return e;
        const eraDoCatalogo = e.exerciseId != null && texto.trim() !== e.name.trim();
        return eraDoCatalogo
          ? { ...e, name: texto, exerciseId: null, muscle: null }
          : { ...e, name: texto };
      })
    );
  }

  async function save() {
    const payloadExercises = exercises
      .filter((e) => e.name.trim())
      .map((e) => ({
        name: e.name.trim(),
        ...(e.exerciseId ? { exerciseId: e.exerciseId } : {}),
        ...(e.muscle ? { muscle: e.muscle } : {}),
        sets: e.sets.map((s) => ({
          type: "valida" as const,
          weightKg: Number(s.weightKg.replace(",", ".")) || 0,
          reps: s.reps ? Number(s.reps) : null,
        })),
      }));

    if (payloadExercises.length === 0) {
      notify("Adicione um exercício", "Dê um nome a pelo menos um exercício para salvar.");
      return;
    }

    setSaving(true);
    try {
      const variant = STRENGTH_VARIANTS.includes(sportId) ? sportId : "musculacao";
      const res = await createActivity(token!, {
        sportId,
        kind: "strength",
        payload: { variant, exercises: payloadExercises },
      });
      celebratePR(res.meta.newPRs ?? []);
      // Só aparece para quem ainda não escolheu; o treino já está salvo.
      perguntarPrivacidade();
      navigation.navigate("CreatePost", { activity: res.data, newPRs: res.meta.newPRs ?? [] });
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll underHeader>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.section }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: sportColor(sportId) }} />
        <Txt variant="titleScreen">Novo treino</Txt>
      </View>

      {exercises.map((ex, ei) => (
        <Card key={ei} sport={sportId} style={{ marginBottom: spacing.card }}>
          <SuggestField
            label={`Exercício ${ei + 1}`}
            value={ex.name}
            onChangeText={(t) => digitouNome(ei, t)}
            placeholder="Supino reto, agachamento livre…"
            fetchSuggestions={(q) =>
              searchExercises(token!, q).then((list) =>
                list.map((e) => ({
                  id: e.id,
                  label: e.name,
                  sub: `${e.muscle} · ${e.equipment}`,
                  data: e,
                }))
              )
            }
            onPick={(s) => pickExercise(ei, s)}
            aoAbrirOuFechar={(aberto) =>
              setBuscandoEm((atual) => (aberto ? ei : atual === ei ? null : atual))
            }
          />
          <MusculoDoExercicio
            // Só quando o nome está firmado: durante a digitação a lista de
            // sugestões ocupa o espaço, e a pergunta ainda pode nem ser verdade.
            visivel={!!ex.name.trim() && !ex.exerciseId && buscandoEm !== ei}
            escolhido={ex.muscle ?? null}
            aoEscolher={(m) => setExercise(ei, { muscle: m })}
          />
          {last[ex.name] && (last[ex.name].weightKg || last[ex.name].reps) ? (
            <Txt variant="caption" color={colors.lime} style={{ marginTop: -6, marginBottom: 6 }}>
              última vez: {last[ex.name].weightKg || 0} kg × {last[ex.name].reps || 0}
            </Txt>
          ) : null}
          {ex.sets.map((s, si) => (
            <View key={si} style={{ gap: spacing.sm, marginBottom: spacing.md }}>
              <Txt variant="caption" color={colors.text3}>
                Série {si + 1}
              </Txt>
              <NumInput
                value={s.weightKg}
                onChangeText={(t) => setSet(ei, si, { weightKg: t })}
                label="Carga (kg)"
                placeholder="0"
              />
              <NumInput
                value={s.reps}
                onChangeText={(t) => setSet(ei, si, { reps: t })}
                label="Repetições"
                placeholder="0"
              />
            </View>
          ))}
          <TouchableOpacity onPress={() => addSet(ei)} activeOpacity={0.7} style={{ paddingVertical: spacing.sm }}>
            <Txt variant="label" color={colors.lime}>
              + Adicionar série
            </Txt>
          </TouchableOpacity>
        </Card>
      ))}

      <Button title="+ Adicionar exercício" variant="secondary" onPress={addExercise} style={{ marginBottom: spacing.section }} />

      <Button title="Salvar treino" onPress={save} loading={saving} size="lg" glow />
    </Screen>
  );
}
