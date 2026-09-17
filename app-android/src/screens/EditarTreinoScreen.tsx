// Corrigir o próprio treino (Tarefa 7) — "Editei o de ontem sem querer, e
// agora?" O motivo de existir: as pessoas registravam o mesmo treino duas
// vezes por engano, e não tinham como corrigir nem apagar.
//
// O envelope (título, data, duração, esforço, sensação, notas, privacidade) é
// igual para qualquer tipo de treino. Os NÚMEROS mudam com o `kind` — e aqui
// reaproveitam os mesmos campos das telas de registro (`Campo`/`Linha` do
// CrossFit, `SuggestField` da força, `Chip` da aula), em vez de reescrever
// cada um: duas implementações do mesmo campo divergem, e o treino passaria a
// se editar diferente de como se registra.
//
// O que o servidor recusa (ver `editarAtividade` em
// api/src/services/activities.ts), a tela nem oferece:
// - trocar `kind`/`sportId` — isso é outro treino, não edição;
// - mexer nos números de um endurance com trajeto de GPS gravado — eles vêm
//   do trajeto, e ficariam contradizendo ele.

import React, { useState } from "react";
import { View, Switch, TouchableOpacity, StyleSheet } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, Field, Chip } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { EditorDeBloco } from "../components/crossfit/EditorDeBloco";
import { ColarOQuadro } from "../components/crossfit/ColarOQuadro";
import { SuggestField } from "../components/SuggestField";
import { Campo, Linha, paraInteiro } from "../components/crossfit/campos";
import { editarAtividade, type Activity, type EditarAtividadePatch } from "../api/activities";
import { searchExercises, type ExerciseDef } from "../api/library";
import { blocoVazio, type Bloco, type PayloadDeCrossfit } from "../api/crossfit";
import { ehDescanso } from "../lib/crossfitResumo";
import { SESSION_TYPES } from "./RegisterClassScreen";
import { temAlgo, resumo } from "./RegisterCrossfitScreen";
import { notify } from "../lib/notify";
import { sportLabel } from "../lib/sportLabel";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "EditarTreino">;

type Feeling = "otimo" | "bom" | "normal" | "ruim" | "pessimo";

const SENSACOES: { id: Feeling; label: string }[] = [
  { id: "otimo", label: "Ótimo" },
  { id: "bom", label: "Bom" },
  { id: "normal", label: "Normal" },
  { id: "ruim", label: "Ruim" },
  { id: "pessimo", label: "Péssimo" },
];

const VISIBILIDADES: { id: Activity["visibility"]; label: string }[] = [
  { id: "private", label: "Só eu" },
  { id: "followers", label: "Seguidores" },
  { id: "public", label: "Público" },
];

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

function dataTextoDe(iso: string): string {
  const d = new Date(iso);
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function horaTextoDe(iso: string): string {
  const d = new Date(iso);
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

/** "dd/mm/aaaa" + "hh:mm" → Date local, ou null se não der para entender. */
function combinarDataHora(dataTexto: string, horaTexto: string): Date | null {
  const md = dataTexto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const mh = horaTexto.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!md || !mh) return null;
  const d = new Date(
    Number(md[3]),
    Number(md[2]) - 1,
    Number(md[1]),
    Number(mh[1]),
    Number(mh[2])
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Um endurance com trajeto de GPS gravado tem distância/pace DERIVADOS do
 *  trajeto — a mesma checagem do servidor (`temTrajetoGravado`, em
 *  api/src/services/activities.ts). Editá-los à mão contradiria o trajeto
 *  que continua gravado ao lado, e o servidor recusa com 400. */
function temTrajetoGravado(a: Activity): boolean {
  if (a.kind !== "endurance") return false;
  const pontos = (a.payload as { points?: unknown[] } | null | undefined)?.points;
  return Array.isArray(pontos) && pontos.length >= 2;
}

/**
 * `weightKg`/`reps` são os únicos números que esta tela edita numa série.
 * `extra` guarda o resto do jeito que veio — `type`, `holdSec`, e os campos
 * legados de check-in migrado (`durationMin`/`distanceKm`, ver
 * api/src/models/strength.ts) — porque o PATCH REESCREVE o payload inteiro:
 * o que a tela não sabe que existe, ela não pode deixar de mandar de volta.
 */
interface SetForm {
  weightKg: string;
  reps: string;
  extra: Record<string, unknown>;
}
interface ExerciseForm {
  name: string;
  /** `exerciseId`, `muscle`, `slug`… — o mesmo motivo do `extra` da série. */
  extra: Record<string, unknown>;
  sets: SetForm[];
}

function exerciciosIniciais(a: Activity): ExerciseForm[] {
  const exercises = (a.payload as { exercises?: Record<string, unknown>[] } | null | undefined)
    ?.exercises;
  if (!exercises?.length) {
    return [{ name: "", extra: {}, sets: [{ weightKg: "", reps: "", extra: { type: "valida" } }] }];
  }
  return exercises.map((raw) => {
    const { name, sets, ...extra } = raw as {
      name?: string;
      sets?: Record<string, unknown>[];
      [k: string]: unknown;
    };
    return {
      name: typeof name === "string" ? name : "",
      extra,
      sets: sets?.length
        ? sets.map((s) => {
            const { weightKg, reps, ...extraDoSet } = s as {
              weightKg?: number;
              reps?: number | null;
              [k: string]: unknown;
            };
            return {
              weightKg: weightKg != null ? String(weightKg) : "",
              reps: reps != null ? String(reps) : "",
              extra: extraDoSet,
            };
          })
        : [{ weightKg: "", reps: "", extra: { type: "valida" } }],
    };
  });
}

/** Leitura simples de um número já salvo (km, elevação…). */
function StatSomenteLeitura({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
      <Txt variant="label" color={colors.text2}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" tabular>
        {value}
      </Txt>
    </View>
  );
}

export function EditarTreinoScreen({ route, navigation }: Props) {
  const { activity } = route.params;
  const { token } = useAuth();

  // ---- Envelope: igual para qualquer tipo de treino ----
  const [titulo, setTitulo] = useState(activity.title ?? "");
  const [dataTexto, setDataTexto] = useState(dataTextoDe(activity.startedAt));
  const [horaTexto, setHoraTexto] = useState(horaTextoDe(activity.startedAt));
  const [duracaoMin, setDuracaoMin] = useState(
    activity.durationSec ? String(Math.round(activity.durationSec / 60)) : ""
  );
  const [esforco, setEsforco] = useState(
    activity.perceivedEffort ? String(activity.perceivedEffort) : ""
  );
  const [sensacao, setSensacao] = useState<Feeling | null>(
    (activity.feeling as Feeling | null) ?? null
  );
  const [notas, setNotas] = useState(activity.notes ?? "");
  const [visibilidade, setVisibilidade] = useState<Activity["visibility"]>(activity.visibility);
  const [salvando, setSalvando] = useState(false);

  // ---- Números: um bloco de estado por `kind`. Só o do tipo do treino é
  // usado — os outros ficam ociosos, sem custo (nenhuma rede a mais). ----

  // strength
  const [exercicios, setExercicios] = useState<ExerciseForm[]>(() => exerciciosIniciais(activity));

  // endurance
  const trajeto = temTrajetoGravado(activity);
  const enduracePayload = (activity.payload ?? {}) as {
    subType?: string;
    distanceM?: number;
    elevationGainM?: number | null;
  };
  const [km, setKm] = useState(
    enduracePayload.distanceM ? String(Math.round(enduracePayload.distanceM) / 1000) : ""
  );
  const [elevacao, setElevacao] = useState(
    enduracePayload.elevationGainM ? String(Math.round(enduracePayload.elevationGainM)) : ""
  );

  // class
  const classPayload = (activity.payload ?? {}) as {
    modality?: string;
    sessionType?: string;
    gi?: boolean | null;
    rounds?: number | null;
  };
  const [sessionType, setSessionType] = useState<string | null>(classPayload.sessionType ?? null);
  const [gi, setGi] = useState(classPayload.gi ?? false);

  // generic
  const genericPayload = (activity.payload ?? {}) as {
    activityName?: string;
    description?: string | null;
    customMetrics?: { label: string; value: string; unit?: string | null }[];
  };
  const [nomeAtividade, setNomeAtividade] = useState(genericPayload.activityName ?? "");
  const [descricao, setDescricao] = useState(genericPayload.description ?? "");
  const primeiraMetrica = genericPayload.customMetrics?.[0];
  const [metricaLabel, setMetricaLabel] = useState(primeiraMetrica?.label ?? "");
  const [metricaValor, setMetricaValor] = useState(primeiraMetrica?.value ?? "");

  // wod (crossfit) — os mesmos campos e o mesmo editor de bloco do registro.
  const wodInicial: PayloadDeCrossfit = activity.crossfit ?? {
    v: 3,
    box: null,
    quadro: null,
    tamanhoDoTime: 1,
    parceiros: null,
    blocos: [],
  };
  const [blocos, setBlocos] = useState<Bloco[]>(wodInicial.blocos);
  const [box, setBox] = useState(wodInicial.box ?? "");
  const [quadro, setQuadro] = useState(wodInicial.quadro ?? "");
  const [time, setTime] = useState(String(wodInicial.tamanhoDoTime || 1));
  const [parceiros, setParceiros] = useState((wodInicial.parceiros ?? []).join(", "));
  const [editandoBloco, setEditandoBloco] = useState<number | null>(null);
  const [colando, setColando] = useState(false);
  const tamanhoDoTime = Math.max(1, paraInteiro(time) ?? 1);
  const emEquipe = tamanhoDoTime > 1;

  // ---- Força: mesma lógica de digitar-por-cima do RegisterActivityScreen —
  // trocar o nome de um exercício vindo do catálogo solta o vínculo com ele. ----
  function digitouNome(ei: number, texto: string) {
    setExercicios((prev) =>
      prev.map((e, idx) => {
        if (idx !== ei) return e;
        const eraDoCatalogo = e.extra.exerciseId != null && texto.trim() !== e.name.trim();
        return eraDoCatalogo
          ? { ...e, name: texto, extra: { ...e.extra, exerciseId: null, muscle: null } }
          : { ...e, name: texto };
      })
    );
  }
  function escolheuDoCatalogo(ei: number, s: { id: string; label: string; data?: unknown }) {
    const doCatalogo = s.data as ExerciseDef | undefined;
    setExercicios((prev) =>
      prev.map((e, idx) =>
        idx === ei
          ? { ...e, name: s.label, extra: { ...e.extra, exerciseId: s.id, muscle: doCatalogo?.muscle ?? null } }
          : e
      )
    );
  }
  function setSet(ei: number, si: number, patch: Partial<Pick<SetForm, "weightKg" | "reps">>) {
    setExercicios((prev) =>
      prev.map((e, idx) =>
        idx === ei ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : e
      )
    );
  }
  function addSet(ei: number) {
    setExercicios((prev) =>
      prev.map((e, idx) =>
        idx === ei ? { ...e, sets: [...e.sets, { weightKg: "", reps: "", extra: { type: "valida" } }] } : e
      )
    );
  }
  function addExercicio() {
    setExercicios((prev) => [
      ...prev,
      { name: "", extra: {}, sets: [{ weightKg: "", reps: "", extra: { type: "valida" } }] },
    ]);
  }

  function adicionarBloco() {
    setBlocos((prev) => [...prev, blocoVazio()]);
    setEditandoBloco(blocos.length);
  }

  async function salvar() {
    const dataHora = combinarDataHora(dataTexto, horaTexto);
    if (!dataHora) {
      notify("Data inválida", "Use o formato dd/mm/aaaa para a data e hh:mm para a hora.");
      return;
    }
    if (dataHora.getTime() > Date.now()) {
      notify("Não dá para registrar um treino no futuro", "Corrija a data ou a hora.");
      return;
    }

    const patch: EditarAtividadePatch = {
      title: titulo.trim(),
      notes: notas.trim(),
      visibility: visibilidade,
      durationSec: Math.round((Number(duracaoMin.replace(",", ".")) || 0) * 60),
      startedAt: dataHora.toISOString(),
    };
    const rpe = paraInteiro(esforco);
    if (rpe != null) patch.perceivedEffort = rpe;
    if (sensacao) patch.feeling = sensacao;

    // Base de todo payload editável: o que já estava salvo. Sobrescrevemos só
    // os campos que a tela realmente mostra — o resto (inclusive o que esta
    // tela nem conhece) sobrevive, porque o PATCH REESCREVE o payload
    // inteiro no servidor (não é um merge — ver `editarAtividade` em
    // api/src/services/activities.ts).
    const payloadOriginal = (activity.payload ?? {}) as Record<string, unknown>;

    if (activity.kind === "strength") {
      const validos = exercicios.filter((e) => e.name.trim());
      if (!validos.length) {
        notify("Adicione um exercício", "Dê um nome a pelo menos um exercício para salvar.");
        return;
      }
      patch.payload = {
        ...payloadOriginal,
        exercises: validos.map((e) => ({
          ...e.extra,
          name: e.name.trim(),
          sets: e.sets.map((s) => ({
            ...s.extra,
            weightKg: Number(s.weightKg.replace(",", ".")) || 0,
            reps: s.reps ? Number(s.reps) : null,
          })),
        })),
      };
    } else if (activity.kind === "endurance" && !trajeto) {
      const kmN = Number(km.replace(",", ".")) || 0;
      patch.payload = {
        ...payloadOriginal,
        distanceM: Math.round(kmN * 1000),
        elevationGainM: elevacao ? Number(elevacao.replace(",", ".")) || 0 : undefined,
      };
    } else if (activity.kind === "class") {
      patch.payload = {
        ...payloadOriginal,
        modality: classPayload.modality ?? activity.sportId,
        sessionType: sessionType ?? undefined,
        gi,
      };
    } else if (activity.kind === "generic") {
      if (!nomeAtividade.trim()) {
        notify("Dê um nome à atividade", "Ex.: surf, skate, escalada…");
        return;
      }
      const metricas = [...(genericPayload.customMetrics ?? [])];
      if (metricaLabel.trim() && metricaValor.trim()) {
        metricas[0] = { label: metricaLabel.trim(), value: metricaValor.trim() };
      } else if (metricas.length) {
        metricas.shift();
      }
      patch.payload = {
        ...payloadOriginal,
        activityName: nomeAtividade.trim(),
        description: descricao.trim() || undefined,
        customMetrics: metricas.length ? metricas : undefined,
      };
    } else if (activity.kind === "wod") {
      const limpos = blocos.filter(temAlgo);
      if (!limpos.length && !quadro.trim()) {
        notify("Treino vazio", "Escreva ao menos um bloco, ou cole o quadro da aula.");
        return;
      }
      patch.payload = {
        // O payload cru vem primeiro, pelo mesmo motivo do editor de força: o
        // PATCH SUBSTITUI o payload inteiro, não faz merge. Reconstruir só os
        // campos que esta tela mostra apagaria em silêncio o que ela não
        // mostra — hoje o `nome` do benchmark (raiz do schema de crossfit), e
        // amanhã qualquer campo que alguém acrescente sem lembrar desta tela.
        ...((activity.payload ?? {}) as Record<string, unknown>),
        v: 3,
        box: box.trim() || null,
        quadro: quadro.trim() || null,
        tamanhoDoTime,
        parceiros: parceiros.trim() ? parceiros.split(",").map((p) => p.trim()).filter(Boolean) : null,
        blocos: limpos,
      };
    }

    setSalvando(true);
    try {
      const atualizada = await editarAtividade(token!, activity.id, patch);
      // "ActivityDetail" já está na pilha (foi daqui que se chegou ao editor)
      // — navegar de volta para ela funde os parâmetros na MESMA tela, em vez
      // de empilhar outra. A pessoa vê o treino corrigido na hora.
      navigation.navigate("ActivityDetail", { activity: atualizada });
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      <Txt variant="titleScreen">Editar {sportLabel(activity.sportId).toLowerCase()}</Txt>

      <Card>
        <Field label="Título" value={titulo} onChangeText={setTitulo} placeholder={sportLabel(activity.sportId)} />
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Field label="Data" value={dataTexto} onChangeText={setDataTexto} placeholder="dd/mm/aaaa" keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Hora" value={horaTexto} onChangeText={setHoraTexto} placeholder="hh:mm" keyboardType="numeric" />
          </View>
        </View>
        <Field label="Duração (min)" value={duracaoMin} onChangeText={setDuracaoMin} keyboardType="numeric" placeholder="60" />
      </Card>

      <Card>
        <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
          Números do treino
        </Txt>

        {activity.kind === "strength" ? (
          <>
            {exercicios.map((ex, ei) => (
              <Card key={ei} level={2} style={{ marginBottom: spacing.sm }}>
                <SuggestField
                  label={`Exercício ${ei + 1}`}
                  value={ex.name}
                  onChangeText={(t) => digitouNome(ei, t)}
                  placeholder="Supino reto, agachamento livre…"
                  fetchSuggestions={(q) =>
                    searchExercises(token!, q).then((list) =>
                      list.map((e: ExerciseDef) => ({
                        id: e.id,
                        label: e.name,
                        sub: `${e.muscle} · ${e.equipment}`,
                        data: e,
                      }))
                    )
                  }
                  onPick={(s) => escolheuDoCatalogo(ei, s)}
                />
                {ex.sets.map((s, si) => (
                  <Linha key={si}>
                    <Campo
                      rotulo={`Série ${si + 1} — carga (kg)`}
                      valor={s.weightKg}
                      aoMudar={(t) => setSet(ei, si, { weightKg: t })}
                      teclado="numeric"
                      placeholder="0"
                    />
                    <Campo
                      rotulo="Repetições"
                      valor={s.reps}
                      aoMudar={(t) => setSet(ei, si, { reps: t })}
                      teclado="numeric"
                      placeholder="0"
                    />
                  </Linha>
                ))}
                <TouchableOpacity onPress={() => addSet(ei)} activeOpacity={0.7} style={{ paddingVertical: spacing.sm }}>
                  <Txt variant="label" color={colors.lime}>
                    + Adicionar série
                  </Txt>
                </TouchableOpacity>
              </Card>
            ))}
            <Button title="+ Adicionar exercício" variant="secondary" onPress={addExercicio} />
          </>
        ) : activity.kind === "endurance" ? (
          trajeto ? (
            <>
              <StatSomenteLeitura label="Distância" value={`${((activity.metrics?.distanceKm ?? 0)).toFixed(2)} km`} />
              {activity.metrics?.elevationGainM ? (
                <StatSomenteLeitura label="Elevação" value={`${Math.round(activity.metrics.elevationGainM)} m`} />
              ) : null}
              <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.sm }}>
                Estes números vêm do trajeto de GPS gravado — para corrigi-los, apague o treino e
                registre de novo.
              </Txt>
            </>
          ) : (
            <>
              <Field label="Distância (km)" value={km} onChangeText={setKm} keyboardType="numeric" placeholder="5" />
              <Field
                label="Ganho de elevação (m, opcional)"
                value={elevacao}
                onChangeText={setElevacao}
                keyboardType="numeric"
                placeholder="0"
              />
            </>
          )
        ) : activity.kind === "class" ? (
          <>
            <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
              Tipo de sessão
            </Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
              {SESSION_TYPES.map((t) => (
                <Chip
                  key={t.id}
                  label={t.label}
                  active={sessionType === t.id}
                  onPress={() => setSessionType(sessionType === t.id ? null : t.id)}
                />
              ))}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Txt variant="bodyStrong">Com kimono (gi)</Txt>
              <Switch value={gi} onValueChange={setGi} trackColor={{ true: colors.lime, false: colors.line }} thumbColor={colors.text} />
            </View>
          </>
        ) : activity.kind === "generic" ? (
          <>
            <Field label="O que você fez?" value={nomeAtividade} onChangeText={setNomeAtividade} placeholder="Surf, skate, escalada…" />
            <Field label="Descrição (opcional)" value={descricao} onChangeText={setDescricao} placeholder="Como foi?" multiline />
            <Field label="Sua métrica (opcional)" value={metricaLabel} onChangeText={setMetricaLabel} placeholder="ondas, pegadas…" />
            <Field label="Quanto" value={metricaValor} onChangeText={setMetricaValor} keyboardType="numeric" placeholder="12" />
          </>
        ) : activity.kind === "wod" ? (
          <>
            <Linha>
              <Campo rotulo="Box" valor={box} aoMudar={setBox} placeholder="Onde treinou" flex={2} />
              <Campo rotulo="Quantos treinaram" valor={time} aoMudar={setTime} placeholder="1" teclado="numeric" />
            </Linha>
            {emEquipe ? (
              <View style={{ marginTop: spacing.sm }}>
                <Campo rotulo="Com quem" valor={parceiros} aoMudar={setParceiros} placeholder="Bruno, Ana" />
              </View>
            ) : null}

            <View style={{ marginTop: spacing.md }}>
              {blocos.map((b, i) => {
                const linhas = resumo(b);
                return (
                  <TouchableOpacity key={i} onPress={() => setEditandoBloco(i)} activeOpacity={0.85}>
                    <Card level={2} style={{ marginBottom: spacing.sm }}>
                      <Txt variant="label" color={ehDescanso(b) ? colors.text3 : colors.lime}>
                        {b.modo.trim() || "sem modo"}
                      </Txt>
                      {linhas.length ? (
                        linhas.map((l, j) => (
                          <Txt
                            key={j}
                            variant={j === 0 ? "bodyStrong" : "body"}
                            color={j === 0 ? colors.text : colors.text2}
                            style={{ marginTop: 2 }}
                          >
                            {l}
                          </Txt>
                        ))
                      ) : (
                        <Txt variant="body" color={colors.text3} style={{ marginTop: 2 }}>
                          Toque para preencher
                        </Txt>
                      )}
                    </Card>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity onPress={adicionarBloco} activeOpacity={0.7} style={styles.adicionar}>
                <Txt variant="bodyStrong" color={colors.text2}>
                  + Adicionar bloco
                </Txt>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setColando(true)} activeOpacity={0.7}>
                <Txt variant="label" color={colors.lime}>
                  {quadro ? "Quadro colado · tocar para trocar" : "Colar o quadro corrigido"}
                </Txt>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </Card>

      <Card>
        <Campo rotulo="Esforço (1-10)" valor={esforco} aoMudar={setEsforco} teclado="numeric" placeholder="8" />

        <View style={{ marginTop: spacing.md }}>
          <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
            Sensação
          </Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {SENSACOES.map((s) => (
              <Chip
                key={s.id}
                label={s.label}
                active={sensacao === s.id}
                onPress={() => setSensacao(sensacao === s.id ? null : s.id)}
              />
            ))}
          </View>
        </View>

        <View style={{ marginTop: spacing.md }}>
          <Field label="Notas" value={notas} onChangeText={setNotas} placeholder="Como foi?" multiline />
        </View>

        <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
          Quem vê
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {VISIBILIDADES.map((v) => (
            <Chip
              key={v.id}
              label={v.label}
              active={visibilidade === v.id}
              onPress={() => setVisibilidade(v.id)}
            />
          ))}
        </View>
      </Card>

      <Button title="Salvar alterações" onPress={() => void salvar()} loading={salvando} size="lg" glow />

      {activity.kind === "wod" ? (
        <>
          <ColarOQuadro
            visivel={colando}
            aoFechar={() => setColando(false)}
            aoLer={({ blocos: lidos, box: caixa, quadro: texto, tamanhoDoTime: time2 }) => {
              setBlocos(lidos);
              setQuadro(texto);
              if (caixa) setBox(caixa);
              if (time2 > 1) setTime(String(time2));
            }}
          />
          <Sheet visivel={editandoBloco != null} aoFechar={() => setEditandoBloco(null)}>
            <View style={{ paddingHorizontal: spacing.gutter }}>
              {editandoBloco != null && blocos[editandoBloco] ? (
                <EditorDeBloco
                  bloco={blocos[editandoBloco]}
                  emEquipe={emEquipe}
                  aoMudar={(b) => setBlocos((prev) => prev.map((x, j) => (j === editandoBloco ? b : x)))}
                  aoRemover={() => {
                    setBlocos((prev) => prev.filter((_, j) => j !== editandoBloco));
                    setEditandoBloco(null);
                  }}
                />
              ) : null}
              <View style={{ marginTop: spacing.md }}>
                <Button title="Pronto" size="lg" onPress={() => setEditandoBloco(null)} />
              </View>
            </View>
          </Sheet>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  adicionar: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderStyle: "dashed",
    borderRadius: radius.card,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginBottom: spacing.md,
  },
});
