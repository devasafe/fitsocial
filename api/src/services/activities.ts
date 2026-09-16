import type mongoose from "mongoose";
import { Activity, type ActivityCreateInput } from "../models/Activity.js";
import { Post } from "../models/Post.js";
import { Comment } from "../models/Comment.js";
import { Like } from "../models/Like.js";
import { User } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { visibilidadeParaNovaAtividade } from "./activityVisibility.js";
import { getSport } from "./sports.js";
import { interpretarBlocos, normalizarWod } from "./crossfit.js";
import { computeMetrics } from "./activityMetrics.js";
import { preencherSlugs } from "./slug.js";
import { detectPRs, recomputeUserPRs, type NewPR } from "./prEngine.js";
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
 */
async function acharRepeticao(userId: mongoose.Types.ObjectId, input: ActivityCreateInput) {
  if (input.mesmoAssim) return null;

  if (input.clientKey) {
    return Activity.findOne({ user: userId, clientKey: input.clientKey });
  }

  return Activity.findOne({
    user: userId,
    impressao: impressaoDoTreino(entradaDoTreino(input)),
    createdAt: { $gte: new Date(Date.now() - JANELA_DA_REDE_MS) },
  });
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
  const repetida = await acharRepeticao(userId, input);
  if (repetida) return { activity: repetida, post: null, newPRs: [], repetido: true };

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
      clientKey: input.clientKey,
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
    // `&& input.clientKey`: o único índice único hoje é `{user, clientKey}`
    // (models/Activity.ts) — não existe índice único sobre a impressão, só o
    // índice comum que sustenta a busca por janela. Um E11000 SEM
    // `clientKey` no input não pode ter vindo desta corrida; tratá-lo aqui
    // do mesmo jeito esconderia um defeito DIFERENTE atrás de "ah, é
    // duplicata" — por isso relançamos (`throw err` abaixo) nesse caso, em
    // vez de assumir que é sempre esta corrida.
    if ((err as { code?: number }).code === 11000 && input.clientKey) {
      const existente = await Activity.findOne({ user: userId, clientKey: input.clientKey });
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
