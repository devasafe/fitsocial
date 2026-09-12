import mongoose from "mongoose";
import { Activity } from "../models/Activity.js";
import { agruparPorDia, inicioDaJanela, ultimosDias } from "../utils/dia.js";
import { MUSCLE_GROUPS, type MuscleGroup } from "./muscleGroups.js";
import { PersonalRecordEvent } from "../models/PersonalRecordEvent.js";
import { getSport } from "./sports.js";

// A evolução de quem treina, respondida pelo banco e não em JavaScript.
//
// O que existia antes (`GET /checkins/progress`) carregava TODAS as atividades
// da pessoa, sem limite, e agrupava com um Map em memória. Funcionava com
// trinta treinos e ia piorando sozinho — e não dava para pedir "os últimos 90
// dias" porque não havia janela nenhuma. Aqui a janela é obrigatória e o
// trabalho fica no Mongo, no padrão de `growthMetrics.ts`: $match → $group →
// $sort, sem $lookup.
//
// A chave de tudo é `payload.exercises[].slug` (`services/slug.ts`), gravado no
// salvamento. Treino antigo só entra depois do backfill — é ele que dá
// identidade ao que já estava gravado.

/** Janelas que a aba oferece. Zero significa tudo, sem corte. */
export const JANELAS = [30, 90, 365, 0] as const;

/** O que dá para plotar de um exercício de força. */
export const METRICAS = ["carga_max", "rm_estimado", "volume", "series", "reps"] as const;
export type Metrica = (typeof METRICAS)[number];

const SERIE_VALIDA = {
  "payload.exercises.sets.type": "valida",
  "payload.exercises.sets.weightKg": { $gt: 0 },
};

/** Só os treinos desta pessoa na janela pedida. Zero dias não corta nada. */
function naJanela(userId: mongoose.Types.ObjectId, dias: number, kind?: string) {
  const m: Record<string, unknown> = { user: userId };
  if (kind) m.kind = kind;
  if (dias > 0) m.startedAt = { $gte: inicioDaJanela(dias) };
  return m;
}

/**
 * 1RM estimado pela fórmula de Epley, em estágio de agregação.
 *
 * É a MESMA conta de `estimate1RM` no `prEngine`, inclusive o limite de 12
 * repetições — acima disso a fórmula deixa de descrever força máxima e vira
 * resistência. As duas precisam continuar iguais: é o mesmo número que o app
 * mostra como recorde e como ponto do gráfico.
 */
const RM_ESTIMADO = {
  $let: {
    vars: {
      w: "$payload.exercises.sets.weightKg",
      r: { $ifNull: ["$payload.exercises.sets.reps", 0] },
    },
    in: {
      $cond: [
        { $and: [{ $gte: ["$$r", 1] }, { $lte: ["$$r", 12] }] },
        { $multiply: ["$$w", { $add: [1, { $divide: ["$$r", 30] }] }] },
        null,
      ],
    },
  },
};

const VOLUME_DA_SERIE = {
  $multiply: ["$payload.exercises.sets.weightKg", { $ifNull: ["$payload.exercises.sets.reps", 0] }],
};

export interface ExercicioNaLista {
  slug: string;
  nome: string;
  vezes: number;
  melhor: number;
  ultimo: number;
  /** Positivo é melhora. Nulo quando só houve um treino — não há de quê. */
  delta: number | null;
  ultimaVez: Date;
}

/**
 * Os exercícios de força que a pessoa treinou na janela, do mais recente ao
 * mais antigo, com quanto mudou.
 *
 * O `delta` é o último menos o primeiro DENTRO da janela, e não contra o
 * recorde histórico: a pergunta que a lista responde é "como estou indo
 * ultimamente", e é por isso que ele muda quando a janela muda.
 */
export async function exerciciosDoUsuario(
  userId: mongoose.Types.ObjectId,
  dias: number
): Promise<ExercicioNaLista[]> {
  return Activity.aggregate<ExercicioNaLista>([
    { $match: naJanela(userId, dias, "strength") },
    { $unwind: "$payload.exercises" },
    { $match: { "payload.exercises.slug": { $type: "string", $ne: "" } } },
    { $unwind: "$payload.exercises.sets" },
    { $match: SERIE_VALIDA },
    // Primeiro por treino: a carga do dia é a melhor série daquele dia.
    {
      $group: {
        _id: { slug: "$payload.exercises.slug", treino: "$_id" },
        nome: { $first: "$payload.exercises.name" },
        quando: { $first: "$startedAt" },
        carga: { $max: "$payload.exercises.sets.weightKg" },
      },
    },
    { $sort: { quando: 1 } },
    // Depois por exercício, já em ordem de tempo — daí `$first`/`$last` valem.
    {
      $group: {
        _id: "$_id.slug",
        nome: { $last: "$nome" },
        vezes: { $sum: 1 },
        melhor: { $max: "$carga" },
        primeiro: { $first: "$carga" },
        ultimo: { $last: "$carga" },
        ultimaVez: { $last: "$quando" },
      },
    },
    {
      $project: {
        _id: 0,
        slug: "$_id",
        nome: 1,
        vezes: 1,
        melhor: 1,
        ultimo: 1,
        ultimaVez: 1,
        delta: {
          $cond: [{ $gt: ["$vezes", 1] }, { $subtract: ["$ultimo", "$primeiro"] }, null],
        },
      },
    },
    { $sort: { ultimaVez: -1 } },
  ]);
}

export interface PontoDoExercicio {
  data: Date;
  valor: number;
  /** Neste treino a pessoa bateu o próprio recorde desta métrica. */
  ehPR: boolean;
}

/**
 * A métrica plotada e o tipo de recorde que corresponde a ela.
 *
 * Volume, séries e repetições ficam de fora porque não existe recorde desses:
 * marcar um ponto de volume como PR seria inventar uma conquista que o app
 * nunca celebrou — e a pessoa notaria a diferença entre o gráfico e a aba de
 * recordes.
 */
const PR_DA_METRICA: Partial<Record<Metrica, string>> = {
  carga_max: "carga_max",
  rm_estimado: "rm_estimado",
};

/**
 * O estágio que reduz as séries de um treino a um valor só, conforme a métrica.
 *
 * É um switch e não um mapa indexado porque o tipo do `$group` no mongoose é
 * uma união (`{_id}` ou acumuladores), que não aceita indexação por string:
 * montar o estágio inteiro deixa o compilador conferir cada expressão em vez
 * de um cast engolir erro de verdade dentro do pipeline.
 */
function agrupaPorTreino(metrica: Metrica): mongoose.PipelineStage.Group {
  const quando = { $first: "$startedAt" };
  switch (metrica) {
    case "carga_max":
      return { $group: { _id: "$_id", data: quando, valor: { $max: "$payload.exercises.sets.weightKg" } } };
    case "rm_estimado":
      return { $group: { _id: "$_id", data: quando, valor: { $max: RM_ESTIMADO } } };
    case "volume":
      return { $group: { _id: "$_id", data: quando, valor: { $sum: VOLUME_DA_SERIE } } };
    case "series":
      return { $group: { _id: "$_id", data: quando, valor: { $sum: 1 } } };
    case "reps":
      return {
        $group: {
          _id: "$_id",
          data: quando,
          valor: { $sum: { $ifNull: ["$payload.exercises.sets.reps", 0] } },
        },
      };
  }
}

/**
 * A série de um exercício ao longo do tempo, um ponto por treino.
 *
 * Um ponto por TREINO, não por série: o gráfico conta a história dos dias em
 * que a pessoa fez aquele exercício. Duas sessões no mesmo dia continuam sendo
 * dois pontos, porque foram dois treinos.
 */
export async function serieDoExercicio(
  userId: mongoose.Types.ObjectId,
  slug: string,
  dias: number,
  metrica: Metrica
): Promise<PontoDoExercicio[]> {
  const linhas = await Activity.aggregate<{ _id: mongoose.Types.ObjectId; data: Date; valor: number | null }>([
    // O filtro de slug aparece duas vezes de propósito. Antes do `$unwind` ele
    // significa "algum exercício deste treino é esse" — superconjunto exato do
    // que sobreviveria depois, e portanto seguro — e derruba os treinos que não
    // têm o exercício antes de explodir cada um em oito documentos. O Mongo não
    // faz essa subida sozinho.
    { $match: { ...naJanela(userId, dias, "strength"), "payload.exercises.slug": slug } },
    { $unwind: "$payload.exercises" },
    { $match: { "payload.exercises.slug": slug } },
    { $unwind: "$payload.exercises.sets" },
    { $match: SERIE_VALIDA },
    agrupaPorTreino(metrica),
    { $sort: { data: 1 } },
  ]);

  // `rm_estimado` devolve nulo no treino em que ninguém fez de 1 a 12 reps.
  // Aí o ponto não existe, em vez de virar zero e cavar um buraco no gráfico.
  const pontos = linhas.filter((l) => l.valor != null);

  // Quais desses treinos foram recorde — uma consulta só, e pela MESMA janela
  // da série, não por um `$in` com o id de cada ponto: com `dias=0` aquele `$in`
  // teria um elemento por treino da vida inteira da pessoa, e nenhum índice
  // ajuda a casar uma lista assim. Por janela, o índice
  // {user, exerciseSlug, achievedAt} serve a consulta inteira.
  const tipo = PR_DA_METRICA[metrica];
  const comPR = new Set<string>();
  if (tipo && pontos.length > 0) {
    const filtro: Record<string, unknown> = { user: userId, exerciseSlug: slug, type: tipo };
    if (dias > 0) filtro.achievedAt = { $gte: inicioDaJanela(dias) };

    const eventos = await PersonalRecordEvent.find(filtro).select("activity");
    for (const e of eventos) comPR.add(String(e.activity));
  }

  return pontos.map((l) => ({
    data: l.data,
    valor: Math.round((l.valor as number) * 10) / 10,
    ehPR: comPR.has(String(l._id)),
  }));
}

export interface GrupoTreinado {
  grupo: MuscleGroup;
  series: number;
}

/**
 * Séries válidas por grupo muscular na janela — os eixos do radar.
 *
 * Lê `metrics.seriesPorGrupo`, que o servidor já grava no salvamento, em vez de
 * reabrir o payload: é o mesmo número que o card do feed mostra, e ler de dois
 * lugares diferentes é como os dois passam a discordar.
 *
 * Devolve os 12 grupos sempre, inclusive os zerados: um radar que esconde o
 * eixo vazio esconde justamente a perna que a pessoa não treina.
 */
export async function gruposDoUsuario(
  userId: mongoose.Types.ObjectId,
  dias: number
): Promise<GrupoTreinado[]> {
  const linhas = await Activity.aggregate<{ _id: string; series: number }>([
    { $match: naJanela(userId, dias, "strength") },
    { $project: { g: { $objectToArray: { $ifNull: ["$metrics.seriesPorGrupo", {}] } } } },
    { $unwind: "$g" },
    { $group: { _id: "$g.k", series: { $sum: "$g.v" } } },
  ]);

  const mapa = new Map(linhas.map((l) => [l._id, l.series]));
  return MUSCLE_GROUPS.map((grupo) => ({ grupo, series: mapa.get(grupo) ?? 0 }));
}

export interface DiaDoCalendario {
  dia: string;
  treinos: number;
  minutos: number;
}

/**
 * Quantos treinos por dia, todos os esportes, com os dias vazios preenchidos.
 *
 * Os zeros importam aqui mais que em qualquer outro lugar: o calendário existe
 * para mostrar constância, e constância se lê nos buracos.
 */
export async function calendarioDoUsuario(
  userId: mongoose.Types.ObjectId,
  dias: number
): Promise<DiaDoCalendario[]> {
  const linhas = await Activity.aggregate<{ _id: string; treinos: number; segundos: number }>([
    { $match: naJanela(userId, dias) },
    {
      $group: {
        _id: agruparPorDia("startedAt"),
        treinos: { $sum: 1 },
        segundos: { $sum: "$durationSec" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const mapa = new Map(linhas.map((l) => [l._id, l]));
  return ultimosDias(dias).map((dia) => {
    const l = mapa.get(dia);
    return { dia, treinos: l?.treinos ?? 0, minutos: Math.round((l?.segundos ?? 0) / 60) };
  });
}


// --------------------------------------------------------------------- cardio
//
// A evolução de quem corre, pedala ou nada.
//
// Vive aqui e não em `/checkins/cardio-progress` porque aquela rota lê UM dos
// dois formatos em que este projeto grava cardio — e justamente o que não é
// usado por quem registra corrida de verdade. Os dois existem, os dois estão
// vivos, e é preciso ler os dois:
//
//   1. `kind: "endurance"` — uma corrida registrada pela tela de atividade,
//      com `payload.distanceM` e `durationSec` na raiz.
//   2. `kind: "strength"` com `durationMin`/`distanceKm` dentro de
//      `payload.exercises[].sets[]` — é como `POST /checkins` grava a "Esteira
//      20 min" de um plano da IA, e continua gravando hoje.
//
// Ler só o primeiro esconderia o cardio de quem segue plano, que é o fluxo
// principal do app; ler só o segundo (o que a rota antiga faz) esconde toda
// corrida registrada como atividade. A aba precisa dizer a verdade nos dois
// casos, e por isso normaliza os dois na LEITURA — sem migrar nada.
//
// A chave é o `sportId` no primeiro caso e o slug do exercício no segundo. Elas
// se encontram quando batem (uma esteira anotada dos dois jeitos vira uma linha
// só, que é o certo) e convivem quando não batem.

/** O que dá para plotar de um esporte de cardio. */
export const METRICAS_CARDIO = ["pace", "distancia", "duracao", "velocidade"] as const;
export type MetricaCardio = (typeof METRICAS_CARDIO)[number];

/**
 * Nesta métrica, menor é melhor?
 *
 * Só o pace: correr mais rápido é um número MENOR, e um gráfico que não sabe
 * disso desenha a melhora descendo. O app já tem o `menorEhMelhor` no
 * `LineChart` — o que faltava era o servidor dizer quando usá-lo, em vez de
 * cada tela decidir por conta.
 */
export function menorEhMelhor(metrica: MetricaCardio): boolean {
  return metrica === "pace";
}

/** Uma sessão de cardio, já normalizada, venha ela de onde vier. */
interface SessaoDeCardio {
  /** A atividade — é por ela que o recorde casa com o ponto. */
  id: mongoose.Types.ObjectId;
  chave: string;
  nome: string;
  quando: Date;
  km: number;
  minutos: number;
}

/** Só as séries que têm alguma medida de cardio. */
const SET_DE_CARDIO = {
  $or: [
    { "payload.exercises.sets.durationMin": { $gt: 0 } },
    { "payload.exercises.sets.distanceKm": { $gt: 0 } },
  ],
};

/**
 * As sessões de cardio da pessoa na janela, dos dois formatos, em ordem.
 *
 * A união é feita aqui e não num `$unionWith` de propósito: aquele estágio pede
 * MongoDB 4.4, e este projeto não fixa a versão do servidor em lugar nenhum.
 * O que volta do banco não é o histórico da pessoa — cada pipeline já reduziu
 * ao nível de SESSÃO, e o número de linhas é o número de vezes que ela treinou
 * cardio na janela. É a mesma ordem de grandeza que `serieDoExercicio` já
 * devolve, e não a varredura que esta camada nasceu para acabar.
 */
async function sessoesDeCardio(
  userId: mongoose.Types.ObjectId,
  dias: number
): Promise<SessaoDeCardio[]> {
  const [atividades, dentroDoTreino] = await Promise.all([
    Activity.aggregate<SessaoDeCardio>([
      { $match: naJanela(userId, dias, "endurance") },
      {
        $project: {
          _id: 0,
          id: "$_id",
          chave: "$sportId",
          nome: "$sportId",
          quando: "$startedAt",
          // `metrics.distanceKm` é o mesmo número que o card do feed mostra.
          km: { $ifNull: ["$metrics.distanceKm", 0] },
          minutos: { $divide: [{ $ifNull: ["$durationSec", 0] }, 60] },
        },
      },
    ]),
    Activity.aggregate<SessaoDeCardio>([
      { $match: { ...naJanela(userId, dias, "strength"), ...SET_DE_CARDIO } },
      { $unwind: "$payload.exercises" },
      { $unwind: "$payload.exercises.sets" },
      { $match: SET_DE_CARDIO },
      // Um exercício de cardio dentro de um treino é uma sessão: somar as
      // séries dele é o que transforma "3 × 10 min de esteira" em 30 minutos.
      {
        $group: {
          _id: { chave: "$payload.exercises.slug", treino: "$_id" },
          nome: { $first: "$payload.exercises.name" },
          quando: { $first: "$startedAt" },
          minutos: { $sum: { $ifNull: ["$payload.exercises.sets.durationMin", 0] } },
          km: { $sum: { $ifNull: ["$payload.exercises.sets.distanceKm", 0] } },
        },
      },
      // Sem slug não há identidade: é treino antigo que ainda não passou pelo
      // backfill, e agrupá-lo por texto cru traria de volta o problema que o
      // slug existe para resolver.
      { $match: { "_id.chave": { $type: "string", $ne: "" } } },
      {
        $project: {
          _id: 0,
          id: "$_id.treino",
          chave: "$_id.chave",
          nome: 1,
          quando: 1,
          km: 1,
          minutos: 1,
        },
      },
    ]),
  ]);

  return [...atividades, ...dentroDoTreino]
    .filter((s) => s.km > 0 || s.minutos > 0)
    .sort((a, b) => a.quando.getTime() - b.quando.getTime());
}

/**
 * Segundos por quilômetro. Nulo quando não dá para dividir.
 *
 * UMA fórmula para os dois formatos, de propósito: é a mesma conta de
 * `metrics.avgPaceSecPerKm` (`activityMetrics.ts`), e ter duas seria ter dois
 * números para a mesma corrida.
 */
function pace(s: SessaoDeCardio): number | null {
  if (s.km <= 0 || s.minutos <= 0) return null;
  return (s.minutos * 60) / s.km;
}

export interface EsporteNaLista {
  sportId: string;
  nome: string;
  vezes: number;
  /** Quilômetros somados na janela — o número que resume o período. */
  distanciaKm: number;
  /** Segundos por quilômetro. Zero quando não houve distância para dividir. */
  melhorPace: number;
  ultimoPace: number;
  /** Positivo é melhora: pace que CAIU. Nulo com menos de dois paces. */
  delta: number | null;
  ultimaVez: Date;
}

/**
 * Os esportes de cardio que a pessoa praticou na janela.
 *
 * O `delta` é o primeiro pace menos o último — invertido em relação ao da
 * força de propósito, porque aqui melhorar é diminuir, e um delta negativo
 * significando melhora seria uma armadilha para quem for desenhar a próxima
 * tela.
 */
export async function cardioDoUsuario(
  userId: mongoose.Types.ObjectId,
  dias: number
): Promise<EsporteNaLista[]> {
  const sessoes = await sessoesDeCardio(userId, dias);

  const porChave = new Map<string, SessaoDeCardio[]>();
  for (const s of sessoes) {
    const atual = porChave.get(s.chave) ?? [];
    atual.push(s);
    porChave.set(s.chave, atual);
  }

  const lista: EsporteNaLista[] = [];
  for (const [chave, doEsporte] of porChave) {
    const paces = doEsporte.map(pace).filter((p): p is number => p != null);
    const ultima = doEsporte[doEsporte.length - 1];

    lista.push({
      sportId: chave,
      // O catálogo manda quando a chave é um esporte conhecido; senão vale o
      // nome que a pessoa escreveu no treino.
      nome: getSport(chave)?.label ?? ultima.nome,
      vezes: doEsporte.length,
      distanciaKm: Math.round(doEsporte.reduce((t, s) => t + s.km, 0) * 100) / 100,
      melhorPace: paces.length > 0 ? Math.round(Math.min(...paces)) : 0,
      ultimoPace: paces.length > 0 ? Math.round(paces[paces.length - 1]) : 0,
      delta: paces.length > 1 ? Math.round(paces[0] - paces[paces.length - 1]) : null,
      ultimaVez: ultima.quando,
    });
  }

  return lista.sort((a, b) => b.ultimaVez.getTime() - a.ultimaVez.getTime());
}

/**
 * O recorde que corresponde a cada métrica de cardio.
 *
 * Só a distância tem um: `best_dist` é gravado por sessão e casa ponto a ponto
 * com a curva. `best_time` existe, mas é por trecho-alvo (5 km, 10 km), e não
 * pela sessão — marcar o ponto de pace com ele diria "recorde" num dia em que
 * o app não celebrou recorde nenhum. Mesma regra do `PR_DA_METRICA` da força.
 */
const PR_DA_METRICA_CARDIO: Partial<Record<MetricaCardio, string>> = {
  distancia: "best_dist",
};

function valorDaSessao(s: SessaoDeCardio, metrica: MetricaCardio): number | null {
  switch (metrica) {
    case "pace":
      return pace(s);
    case "distancia":
      return s.km > 0 ? s.km : null;
    case "duracao":
      return s.minutos > 0 ? s.minutos : null;
    case "velocidade":
      return s.km > 0 && s.minutos > 0 ? s.km / (s.minutos / 60) : null;
  }
}

/**
 * A curva de um esporte de cardio, um ponto por sessão.
 *
 * Um ponto por SESSÃO, e não por dia: quem corre de manhã e à noite fez duas
 * corridas, e a média das duas esconderia justamente a diferença entre elas.
 */
export async function serieDeCardio(
  userId: mongoose.Types.ObjectId,
  sportId: string,
  dias: number,
  metrica: MetricaCardio
): Promise<PontoDoExercicio[]> {
  const sessoes = (await sessoesDeCardio(userId, dias)).filter((s) => s.chave === sportId);

  // Nulo aqui não é "o valor foi zero", é "não dá para calcular": sessão sem
  // distância não tem pace nem velocidade. Vira ponto ausente, e não um buraco
  // cavado até o eixo.
  const pontos = sessoes
    .map((s) => ({ s, valor: valorDaSessao(s, metrica) }))
    .filter((p): p is { s: SessaoDeCardio; valor: number } => p.valor != null && p.valor > 0);

  const tipo = PR_DA_METRICA_CARDIO[metrica];
  const comPR = new Set<string>();
  if (tipo && pontos.length > 0) {
    // Pelo nome, e não pelo slug: os recordes de endurance são gravados com
    // `exerciseName: sportId` e sem slug (`prEngine.ts`). O cardio anotado
    // dentro de um treino de força não gera recorde deste tipo, então não há
    // risco de marcar um ponto que o app nunca celebrou.
    const filtro: Record<string, unknown> = { user: userId, exerciseName: sportId, type: tipo };
    if (dias > 0) filtro.achievedAt = { $gte: inicioDaJanela(dias) };

    const eventos = await PersonalRecordEvent.find(filtro).select("activity");
    for (const e of eventos) comPR.add(String(e.activity));
  }

  return pontos.map(({ s, valor }) => ({
    data: s.quando,
    // Pace em segundos por km fica inteiro; o resto guarda uma casa.
    valor: metrica === "pace" ? Math.round(valor) : Math.round(valor * 10) / 10,
    ehPR: comPR.has(String(s.id)),
  }));
}
