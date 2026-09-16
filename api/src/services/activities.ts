import type mongoose from "mongoose";
import type { z } from "zod";
import {
  Activity,
  type ActivityCreateInput,
  strengthPayloadSchema,
  endurancePayloadSchema,
  classPayloadSchema,
  genericPayloadSchema,
  wodPayloadSchema,
} from "../models/Activity.js";
import { Post } from "../models/Post.js";
import { Comment } from "../models/Comment.js";
import { Like } from "../models/Like.js";
import { User } from "../models/User.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { HttpError } from "../utils/httpError.js";
import { visibilidadeParaNovaAtividade } from "./activityVisibility.js";
import { getSport } from "./sports.js";
import { interpretarBlocos, normalizarWod } from "./crossfit.js";
import { computeMetrics } from "./activityMetrics.js";
import { preencherSlugs } from "./slug.js";
import { detectPRs, recomputeUserPRs, mereceCelebracao, type NewPR } from "./prEngine.js";
import { processTrack } from "./trackProcessing.js";
import { impressaoDoTreino } from "./impressaoDoTreino.js";
import { limparRastrosDePosts } from "./postModeration.js";

export interface CreatedActivity {
  activity: InstanceType<typeof Activity>;
  post: InstanceType<typeof Post> | null;
  newPRs: NewPR[];
  repetido: boolean;
}

const JANELA_DA_REDE_MS = 10 * 60_000;

interface ResultadoRepeticao {
  /** A atividade já gravada, quando isto for repetição de verdade. */
  repetida: InstanceType<typeof Activity> | null;
  /**
   * `false` só quando a `clientKey` do envio já pertence a OUTRO treino, de
   * conteúdo diferente — "chave velha" (ver o comentário grande abaixo).
   * `createActivity` usa isto para decidir se grava a `clientKey` recebida ou
   * grava sem ela; um `true` cobre tanto "sem chave" quanto "chave nova".
   */
  clientKeyReaproveitavel: boolean;
}

/**
 * Este treino já foi gravado?
 *
 * Duas perguntas, nesta ordem. A CHAVE é a resposta certa: ela vem do app e
 * identifica o ENVIO, então não depende de adivinhar intenção. A IMPRESSÃO é
 * rede para quem não a manda — o APK instalado, que não atualiza sozinho.
 *
 * A rede só pega conteúdo idêntico numa janela de dez minutos. Para engolir um
 * treino legítimo, a pessoa teria de registrar dois treinos com exatamente os
 * mesmos exercícios, pesos e repetições em menos de dez minutos — o que não é
 * "treinei duas vezes", é o mesmo treino enviado duas vezes. `mesmoAssim`
 * existe para o caso em que ela diz que foi outro.
 *
 * **Chave velha (achado da revisão do app, 16/09/2026):** a `clientKey` só é
 * apagada do aparelho DEPOIS do 201 — se o processo morre entre a resposta e
 * a limpeza, ela sobrevive ao uso e fica no aparelho já com dono no servidor.
 * O app pôs um prazo de 6h nela como paliativo, mas isso não fecha: duas
 * aulas do MESMO esporte (`class:jiu_jitsu`, por exemplo) cabem dentro de 6h,
 * e a chave velha reusada faria o servidor devolver o treino da MANHÃ como se
 * fosse o da TARDE — engolindo o da tarde em silêncio, o mesmo bug que esta
 * frente existe para consertar, por outra porta. Encurtar o prazo quebra
 * treino longo; alongar piora isso — o número não tem conserto bom.
 *
 * A regra: chave igual com conteúdo diferente não é repetição, é chave
 * velha. Quando a impressão não bate, este treino NÃO é repetição — e a
 * proteção contra duplicata passa a ser a impressão (a rede de dez minutos
 * acima), não mais aquela chave, que já tem dono.
 */
async function acharRepeticao(
  userId: mongoose.Types.ObjectId,
  input: ActivityCreateInput
): Promise<ResultadoRepeticao> {
  if (input.mesmoAssim) return { repetida: null, clientKeyReaproveitavel: true };

  if (input.clientKey) {
    const existente = await Activity.findOne({ user: userId, clientKey: input.clientKey });
    if (!existente) return { repetida: null, clientKeyReaproveitavel: true };

    const mesmoConteudo = existente.impressao === impressaoDoTreino(entradaDoTreino(input));
    if (mesmoConteudo) return { repetida: existente, clientKeyReaproveitavel: true };

    // Chave velha: aquele treino já existe, mas é OUTRO treino. Devolvê-lo
    // aqui seria o próprio bug (o da tarde relatado como o da manhã); e
    // gravar o novo com esta MESMA `clientKey` bateria no índice único
    // `{user, clientKey}` (models/Activity.ts) — o treino antigo já a
    // ocupa. `clientKeyReaproveitavel: false` diz a `createActivity` para
    // gravar sem ela.
    return { repetida: null, clientKeyReaproveitavel: false };
  }

  const repetida = await Activity.findOne({
    user: userId,
    impressao: impressaoDoTreino(entradaDoTreino(input)),
    createdAt: { $gte: new Date(Date.now() - JANELA_DA_REDE_MS) },
  });
  return { repetida, clientKeyReaproveitavel: true };
}

// Só os campos que definem o CONTEÚDO do treino, na forma exata da
// interface `EntradaDoTreino` — nunca o `input` inteiro. `impressaoDoTreino`
// serializa TODAS as chaves do objeto que recebe, então título, notas,
// visibilidade, `clientKey`, `mesmoAssim` etc. entrariam na impressão se
// fossem passados direto, e o mesmo treino com um campo de metadado a mais
// (ex.: `mesmoAssim: false` explícito vs. ausente) deixaria de bater com sua
// cópia — em silêncio.
function entradaDoTreino(input: ActivityCreateInput) {
  return {
    kind: input.kind,
    sportId: input.sportId,
    durationSec: input.durationSec,
    payload: input.payload,
    // sessionDay É conteúdo — ver o comentário em impressaoDoTreino.ts.
    planLink: input.planLink,
    // Registro retroativo é conteúdo, não metadado — ver o comentário em
    // impressaoDoTreino.ts. `.toISOString()` AQUI, e não dentro de
    // `impressaoDoTreino`: `normalizar()` não trata `Date` especialmente, e
    // um `Date` cru viraria `{}` na impressão (colidindo datas diferentes
    // na mesma impressão vazia). `input.startedAt` já chega como `Date`
    // aqui — `activityCreateSchema` usa `z.coerce.date()`.
    startedAt: input.startedAt?.toISOString(),
  };
}

/**
 * Cria uma atividade (Fase 2a: kind "strength"), calcula as métricas e,
 * opcionalmente, compartilha no feed criando um Post que a referencia.
 * Reutilizado pelo cutover do check-in.
 */
export async function createActivity(
  userId: mongoose.Types.ObjectId,
  input: ActivityCreateInput
): Promise<CreatedActivity> {
  // Reconhecer repetição vem ANTES de interpretar o WOD e processar o GPS: o
  // trabalho caro não deve ser feito para ser jogado fora, e `processTrack`
  // sobre um percurso longo não é barato.
  const { repetida, clientKeyReaproveitavel } = await acharRepeticao(userId, input);
  if (repetida) return { activity: repetida, post: null, newPRs: [], repetido: true };

  // Chave velha (ver o comentário grande em `acharRepeticao`): o treino é
  // novo, mas a `clientKey` recebida já tem dono. Gravar SEM ela é o que
  // evita o E11000 no índice único `{user, clientKey}` — a proteção deste
  // envio passa a ser a impressão, não mais aquela chave.
  const clientKeyParaGravar = clientKeyReaproveitavel ? input.clientKey : undefined;

  // Precisa do documento para saber a preferência de visibilidade da pessoa.
  const dono = await User.findById(userId);
  if (!dono) throw new HttpError(404, "Usuário não encontrado");

  let storedPayload: unknown = input.payload;
  let durationSec = input.durationSec ?? 0;

  // O interpretador roda AQUI, no salvamento — nunca na digitação.
  //
  // É o que preenche `lido` em cada bloco a partir do modo escrito, e é o que
  // dá timer, tipo de score sugerido e a distinção entre WOD e descanso ao
  // resto do sistema. Sem esta linha os blocos são gravados crus: o cartão
  // mostra o aquecimento, o card do feed não sabe o que é descanso, e nada
  // disso dá erro — só fica errado em silêncio.
  //
  // Rodar de novo em cima de um treino já salvo é seguro e desejado: `lido` é
  // derivado, e reinterpretar é como todo treino antigo melhora quando o
  // interpretador melhorar.
  if (input.kind === "wod") {
    storedPayload = interpretarBlocos(normalizarWod(input.payload));
  }

  // A identidade de cada exercicio tambem e resolvida no salvamento, pelo mesmo
  // motivo: e o servidor que tem o catalogo, e o nome digitado sozinho fazia
  // "Supino reto" e "supino reto" virarem dois historicos do mesmo exercicio.
  if (input.kind === "strength") {
    storedPayload = preencherSlugs(input.payload);
  }

  let metrics = computeMetrics({ ...input, payload: storedPayload } as ActivityCreateInput);

  // Fase 3a: endurance com track de GPS — distância/tempo/melhores trechos
  // derivados do percurso no servidor.
  if (input.kind === "endurance" && input.payload.points && input.payload.points.length >= 2) {
    const track = processTrack(input.payload.points);
    durationSec = track.elapsedTimeSec || durationSec;
    storedPayload = {
      ...input.payload,
      distanceM: track.distanceM,
      elevationGainM: track.elevationGainM,
      polyline: track.polyline,
      splits: track.splits,
      bestEfforts: track.bestEfforts,
    };
    const distanceKm = track.distanceM / 1000;
    metrics = {
      distanceKm,
      avgPaceSecPerKm: distanceKm > 0 && durationSec > 0 ? durationSec / distanceKm : 0,
      speedKmh: durationSec > 0 ? distanceKm / (durationSec / 3600) : 0,
      elevationGainM: track.elevationGainM,
    };
  }

  let activity: InstanceType<typeof Activity>;
  try {
    activity = await Activity.create({
      user: userId,
      sportId: input.sportId,
      kind: input.kind,
      title: input.title ?? "",
      startedAt: input.startedAt ?? new Date(),
      durationSec,
      // A escolha explícita manda; sem ela, vale a preferência da pessoa.
      visibility: input.visibility ?? visibilidadeParaNovaAtividade(dono),
      perceivedEffort: input.perceivedEffort,
      feeling: input.feeling,
      notes: input.notes ?? "",
      planLink: input.planLink,
      payload: storedPayload,
      metrics,
      clientKey: clientKeyParaGravar,
      impressao: impressaoDoTreino(entradaDoTreino(input)),
    });
  } catch (err) {
    // Corrida: dois envios simultâneos com a mesma chave passam os dois pelo
    // `acharRepeticao` (nenhum viu o outro ainda) e chegam os dois aqui; o
    // índice único derruba o segundo com E11000. É o MESMO resultado do
    // caminho normal (o segundo clique devolve o primeiro treino), só que
    // descoberto na gravação em vez de na consulta — não deve virar 500 na
    // cara de quem só clicou duas vezes.
    //
    // `&& clientKeyParaGravar`, não `input.clientKey`: o único índice único
    // hoje é `{user, clientKey}` (models/Activity.ts) — não existe índice
    // único sobre a impressão, só o índice comum que sustenta a busca por
    // janela. Um E11000 sem `clientKey` NA GRAVAÇÃO não pode ter vindo desta
    // corrida — nem quando `input.clientKey` existia (caso de chave velha,
    // gravada sem ela de propósito): tratá-lo aqui do mesmo jeito esconderia
    // um defeito DIFERENTE atrás de "ah, é duplicata" — por isso relançamos
    // (`throw err` abaixo) nesse caso, em vez de assumir que é sempre esta
    // corrida.
    if ((err as { code?: number }).code === 11000 && clientKeyParaGravar) {
      const existente = await Activity.findOne({ user: userId, clientKey: clientKeyParaGravar });
      if (existente) return { activity: existente, post: null, newPRs: [], repetido: true };
    }
    throw err;
  }

  // Detecção de PR (Fase 2c) — força, endurance e aulas, síncrona.
  //
  // Em try/catch porque o treino JÁ foi gravado acima: se o motor de recorde
  // falhar, a pessoa não pode receber "não foi possível salvar" por um treino
  // que está salvo — ela tentaria de novo e duplicaria o histórico. Recorde é
  // consequência do treino, não condição dele; e `recomputeUserPRs` reconstrói
  // o que se perder aqui.
  let newPRs: NewPR[] = [];
  try {
    newPRs = await detectPRs(userId, {
      _id: activity._id,
      sportId: activity.sportId,
      kind: activity.kind,
      startedAt: activity.startedAt,
      durationSec: activity.durationSec,
      payload: activity.payload,
    });
  } catch (err) {
    console.error(`[prs] atividade ${String(activity._id)} salva, recorde falhou:`, (err as Error).message);
  }

  // Guarda na propria atividade o que ela conquistou.
  //
  // E denormalizado de proposito: o cartao de compartilhar precisa saber "este
  // treino bateu recorde?" e, sem isto, teria de consultar PersonalRecord a
  // cada montagem. Fica junto das metricas, que ja sao derivadas e gravadas
  // aqui pelo mesmo motivo.
  if (newPRs.length > 0) {
    const resumo = newPRs.map((p) => ({
      type: p.type,
      exerciseName: p.exerciseName,
      value: p.value,
      previousValue: p.previousValue,
      unit: p.unit,
    }));
    activity.set("metrics", { ...activity.metrics, prs: resumo });
    await activity.save();
  }

  let post: InstanceType<typeof Post> | null = null;
  if (input.shareToFeed) {
    const sport = getSport(input.sportId);
    const text = input.caption?.trim() || `Treino de ${sport?.label ?? input.sportId} concluído`;
    post = await Post.create({ author: userId, text, activity: activity._id });
  }

  return { activity, post, newPRs, repetido: false };
}

/**
 * Apaga de verdade um treino da pessoa — e o que só existe por causa dele.
 *
 * Antes disto, `DELETE /activities/:id` fazia só `Activity.deleteOne`: o post
 * do compartilhamento sobrevivia apontando para um treino que não existe mais
 * (mentira no feed dos outros), o recorde que aquele treino tinha batido
 * ficava para sempre no quadro de PRs, e a notificação/denúncia que apontava
 * para o post também ficava órfã — sem nenhum jeito de tirar nenhum dos três.
 *
 * A ordem importa: primeiro os comentários e curtidas dos posts ligados ao
 * treino, depois os próprios posts (`limparRastrosDePosts`, a mesma limpeza
 * de notificação/denúncia que `excluirPost` faz na moderação — ver
 * `services/postModeration.ts`), depois o treino, e só então
 * `recomputeUserPRs` — que reconstrói os recordes do ZERO a partir do que
 * restou. Reconstruir é mais simples que "desfazer" o recorde daquele treino
 * especificamente, e não tem caso de borda (ex.: dois treinos empatados no
 * mesmo recorde).
 *
 * Constância, streak, total, calendário e os gráficos de evolução não
 * precisam de nada além disto: são calculados NA LEITURA a partir dos
 * `Activity` que restaram, e se corrigem sozinhos assim que o treino some.
 * Não acrescente um recontador para eles aqui.
 *
 * Devolve `false` sem apagar nada quando o treino não existe ou não é da
 * pessoa — a rota transforma isso em 404 (nunca 403: confirmar que o treino
 * existe para quem não é o dono vaza a existência dele).
 */
export async function apagarAtividade(
  userId: mongoose.Types.ObjectId,
  activityId: string
): Promise<boolean> {
  const atividade = await Activity.findOne({ _id: activityId, user: userId });
  if (!atividade) return false;

  const posts = await Post.find({ activity: atividade._id }).select("_id");
  const postIds = posts.map((p) => p._id);
  if (postIds.length > 0) {
    await Comment.deleteMany({ post: { $in: postIds } });
    await Like.deleteMany({ post: { $in: postIds } });
    await Post.deleteMany({ _id: { $in: postIds } });
    await limparRastrosDePosts(postIds, userId);
  }

  await atividade.deleteOne();
  await recomputeUserPRs(userId);

  return true;
}

/**
 * O schema de payload certo para cada `kind` — o mesmo usado em `createActivity`.
 *
 * Tipado como `ZodTypeAny` (não `as const`): a chave só se sabe em tempo de
 * execução (vem do treino já gravado), então o retorno de `.parse()` aqui é
 * sempre `any` — como em `createActivity`, que também faz esse cast na
 * fronteira entre a união discriminada e o resto do código.
 */
const payloadSchemaPorKind: Record<string, z.ZodTypeAny> = {
  strength: strengthPayloadSchema,
  endurance: endurancePayloadSchema,
  class: classPayloadSchema,
  generic: genericPayloadSchema,
  wod: wodPayloadSchema,
};

/**
 * Um treino de endurance com pontos de GPS gravados tem a distância e o pace
 * DERIVADOS do trajeto — o mesmo `processTrack` que `createActivity` roda
 * sobre `payload.points` para gravar `polyline`, `splits` e `bestEfforts`.
 * Editar os números à mão desse treino os deixaria contradizendo o próprio
 * trajeto que continua gravado ao lado; por isso o payload dele não é
 * editável (o envelope — título, data, duração, esforço... — continua).
 */
function temTrajetoGravado(atividade: InstanceType<typeof Activity>): boolean {
  if (atividade.kind !== "endurance") return false;
  const pontos = (atividade.payload as { points?: unknown[] } | null | undefined)?.points;
  return Array.isArray(pontos) && pontos.length >= 2;
}

/**
 * O `payload` que está CHEGANDO pede um trajeto de GPS? `processTrack` só
 * roda em `createActivity` — rodá-lo de novo aqui seria código caro num
 * caminho que não precisa dele, e quem quer corrigir um trajeto errado quer
 * outra coisa (registrar de novo). Sem esta checagem, um treino sem trajeto
 * aceitaria `points` pela edição e os gravaria CRUS: sem `polyline`, sem
 * `splits`, sem `bestEfforts`, com `computeMetrics` lendo `distanceM` no
 * default 0 — distância e pace errados, em silêncio, ao lado de um trajeto
 * que parece gravado mas não foi processado.
 */
function trazTrajeto(payload: unknown): boolean {
  const pontos = (payload as { points?: unknown[] } | null | undefined)?.points;
  return Array.isArray(pontos) && pontos.length >= 2;
}

export interface EditarAtividadePatch {
  title?: string;
  notes?: string;
  visibility?: "private" | "followers" | "public";
  durationSec?: number;
  perceivedEffort?: number;
  feeling?: "otimo" | "bom" | "normal" | "ruim" | "pessimo";
  startedAt?: Date;
  payload?: unknown;
  // Só existem aqui para o service poder recusá-los com uma mensagem que
  // explique o motivo — ver o `HttpError` abaixo. Se o schema da rota já os
  // descartasse, a edição devolveria 200 fingindo que trocou o tipo do treino.
  kind?: unknown;
  sportId?: unknown;
}

/**
 * Corrige um treino já registrado — "registrei o peso errado", "foi ontem, não
 * hoje". `PATCH /activities/:id` fazia isso só para força, e nunca refazia o
 * recorde: baixar o peso deixava o PR antigo de pé, apontando para um treino
 * que não existe mais daquele jeito.
 *
 * `kind` e `sportId` não são editáveis: trocar um treino de força por uma
 * corrida não é corrigir, é outro treino — e deixaria o payload incoerente
 * com o tipo, dado impossível de interpretar depois (ver o desenho, "4.
 * Editar"). Apague e registre de novo.
 *
 * Quando o `payload` muda, passa pelo MESMO caminho do `createActivity` —
 * `preencherSlugs` para força, `interpretarBlocos(normalizarWod(...))` para
 * WOD, `computeMetrics` para todos — reaproveitando as funções, não
 * reescrevendo.
 *
 * Devolve `null` sem alterar nada quando o treino não existe ou não é da
 * pessoa — a rota transforma isso em 404 (nunca 403, pelo mesmo motivo de
 * `apagarAtividade`).
 */
export async function editarAtividade(
  userId: mongoose.Types.ObjectId,
  activityId: string,
  patch: EditarAtividadePatch
): Promise<InstanceType<typeof Activity> | null> {
  const atividade = await Activity.findOne({ _id: activityId, user: userId });
  if (!atividade) return null;

  if (patch.kind !== undefined || patch.sportId !== undefined) {
    throw new HttpError(
      400,
      "Não dá para trocar o tipo nem o esporte de um treino editando — isso é outro treino: apague este e registre de novo."
    );
  }

  const payloadMudou = patch.payload !== undefined;
  if (payloadMudou && temTrajetoGravado(atividade)) {
    throw new HttpError(
      400,
      "Este treino tem um percurso de GPS gravado — a distância e o pace vêm dele, não dá para corrigi-los à mão. Apague o treino e registre de novo se o trajeto estiver errado."
    );
  }
  if (payloadMudou && atividade.kind === "endurance" && trazTrajeto(patch.payload)) {
    throw new HttpError(
      400,
      "Trajeto de GPS vem do registro, não da edição. Apague o treino e registre de novo com o percurso certo."
    );
  }

  if (patch.title !== undefined) atividade.title = patch.title;
  if (patch.notes !== undefined) atividade.notes = patch.notes;
  if (patch.visibility !== undefined) atividade.visibility = patch.visibility;
  if (patch.durationSec !== undefined) atividade.durationSec = patch.durationSec;
  if (patch.perceivedEffort !== undefined) atividade.perceivedEffort = patch.perceivedEffort;
  if (patch.feeling !== undefined) atividade.feeling = patch.feeling;
  if (patch.startedAt !== undefined) atividade.startedAt = patch.startedAt;

  let storedPayload: unknown = atividade.payload;
  if (payloadMudou) {
    const schema = payloadSchemaPorKind[atividade.kind];
    // Todo `kind` gravado hoje tem schema (ver ACTIVITY_KINDS): um treino sem
    // um aqui é dado impossível, e 400 é melhor que 500 escondido.
    if (!schema) throw new HttpError(400, "Tipo de treino desconhecido");
    const payloadValidado = schema.parse(patch.payload);

    // O interpretador e a identidade do exercício rodam no salvamento — nunca
    // na digitação —, pelo mesmo motivo de `createActivity`: sem isto o card
    // mostra o bloco cru, e o histórico do exercício fura em dois.
    storedPayload = payloadValidado;
    if (atividade.kind === "wod") storedPayload = interpretarBlocos(normalizarWod(payloadValidado));
    if (atividade.kind === "strength") storedPayload = preencherSlugs(payloadValidado);

    atividade.payload = storedPayload;
    atividade.markModified("payload");
  }

  // O pace, a velocidade, o score do WOD... dependem da duração tanto quanto
  // dos números do payload. Corrigir só a duração e deixar a métrica velha
  // faria ela contradizer a duração nova na mesma tela.
  const durationMudou = patch.durationSec !== undefined;
  if (payloadMudou || durationMudou) {
    // `computeMetrics` SUBSTITUI `metrics` inteiro — é por isso que o resumo
    // de recorde (`metrics.prs`) só é regravado depois de recomputar os PRs,
    // lá embaixo, nunca aqui.
    atividade.set(
      "metrics",
      computeMetrics({
        sportId: atividade.sportId,
        kind: atividade.kind,
        durationSec: atividade.durationSec,
        payload: storedPayload,
      } as ActivityCreateInput)
    );
    atividade.markModified("metrics");
  }

  await atividade.save();

  // Recorde depende de payload E de duração (best_time/wod_time nascem de
  // `durationSec` — ver `enduranceCandidates`/`computeWodMetrics`), a mesma
  // condição de cima: corrigir só a duração de uma corrida sem GPS também
  // pode ter derrubado ou destravado um recorde de tempo.
  if (payloadMudou || durationMudou) {
    // Reconstrói os recordes da pessoa inteiros, porque baixar ou subir um
    // número aqui pode ter derrubado ou criado um recorde — igual a apagar.
    await recomputeUserPRs(userId);

    // O resumo denormalizado é só o que este treino CONQUISTOU: os mesmos
    // dois filtros que `applyCandidate` usa ao celebrar na criação.
    //
    // 1. `previousValue != null` exclui linha de base (primeira vez que a
    //    pessoa faz aquele exercício) — não é uma conquista, é só o único
    //    dado que existe.
    // 2. `mereceCelebracao` (services/prEngine.ts) exclui melhora real mas
    //    abaixo do limiar (100kg → 100,3kg sobe o recorde, mas não é selo).
    //    Sem este segundo filtro, qualquer melhora — por menor que fosse —
    //    entraria no resumo de uma edição mesmo que a MESMA melhora, na
    //    criação, não virasse celebração nenhuma.
    const conquistados = await PersonalRecord.find({
      user: userId,
      activity: atividade._id,
      previousValue: { $ne: null },
    });
    const resumo = conquistados
      .filter((p) => mereceCelebracao(p.type, p.previousValue as number, p.value))
      .map((p) => ({
        type: p.type,
        exerciseName: p.exerciseName,
        value: p.value,
        previousValue: p.previousValue,
        unit: p.unit,
      }));
    atividade.set("metrics", { ...atividade.metrics, prs: resumo });
    atividade.markModified("metrics");
    await atividade.save();
  }

  return atividade;
}
