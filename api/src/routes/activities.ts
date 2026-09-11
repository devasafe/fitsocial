import { Router } from "express";
import { normalizarWod } from "../services/crossfit.js";
import { interpretarModo } from "../services/crossfit/interpretarModo.js";
import { lerQuadro } from "../services/ai/lerQuadro.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { getBenchmark } from "../services/benchmarks.js";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { podeVerAtividade, podarRotaSePrivada } from "../services/activityVisibility.js";
import { getSport } from "../services/sports.js";
import { Activity, activityCreateSchema, strengthPayloadSchema } from "../models/Activity.js";
import { Follow } from "../models/Follow.js";
import { Post } from "../models/Post.js";
import { Like } from "../models/Like.js";
import { User } from "../models/User.js";
import { createActivity } from "../services/activities.js";
import { computeStrengthMetrics } from "../services/activityMetrics.js";
import { parseGpx } from "../services/gpx.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";

export const activitiesRouter = Router();
activitiesRouter.use(requireAuth);

export function serializeActivity(a: InstanceType<typeof Activity>) {
  return {
    id: a._id.toString(),
    author: a.user.toString(),
    sportId: a.sportId,
    kind: a.kind,
    title: a.title,
    startedAt: a.startedAt,
    durationSec: a.durationSec,
    visibility: a.visibility,
    notes: a.notes,
    perceivedEffort: a.perceivedEffort ?? null,
    feeling: a.feeling ?? null,
    planLink: a.planLink ?? null,
    // O payload cru, sem tradução.
    //
    // Aqui viviam também os campos planos do formato antigo, para o APK 1.2.0
    // conseguir ler um treino gravado em blocos. Foram embora junto com a
    // decisão de não carregar compatibilidade com ele (11/09/2026).
    payload: a.payload,
    // Forma normalizada em blocos, AO LADO do payload cru — não no lugar dele.
    ...(a.kind === "wod" ? { crossfit: normalizarWod(a.payload) } : {}),
    metrics: a.metrics,
    createdAt: a.get("createdAt") as Date,
  };
}

/**
 * Histórico de benchmarks da pessoa.
 *
 * Uma linha por WOD conhecido que ela já fez, com a melhor marca, a última e a
 * diferença entre as duas. É o §34 da spec: repetir Fran em dois meses e ver
 * "−34s" é o que transforma registro em evolução.
 *
 * Lê de `metrics.wod`, que a Fase 1 promoveu justamente para isto — sem varrer
 * payload nenhum.
 */
activitiesRouter.get(
  "/benchmarks",
  asyncHandler(async (req, res) => {
    const linhas = await Activity.find({
      user: req.user!._id,
      kind: "wod",
      "metrics.wod.slug": { $ne: null, $exists: true },
    })
      .select("startedAt metrics")
      .sort({ startedAt: 1 });

    interface Marca {
      slug: string;
      nome: string;
      familia: string | null;
      escala: string;
      formato: string;
      scoreTipo: string | null;
      maiorMelhor: boolean;
      vezes: number;
      melhor: { valor: number; quando: Date } | null;
      ultimo: { valor: number; quando: Date } | null;
    }

    // Agrupa por benchmark E por escala: Fran RX e Fran scaled são progressões
    // diferentes, e misturar as duas mostraria uma "piora" quando a pessoa
    // subiu de nível.
    const porChave = new Map<string, Marca>();

    for (const a of linhas) {
      const w = (a.metrics as { wod?: Record<string, unknown> } | null)?.wod;
      if (!w?.slug) continue;
      const valor = w.scoreValor as number | null;
      if (valor == null) continue;

      const slug = w.slug as string;
      const escala = (w.escala as string) ?? "rx";
      const chave = `${slug}:${escala}`;
      const quando = a.startedAt;
      const maiorMelhor = (w.maiorMelhor as boolean | null) ?? true;

      const atual =
        porChave.get(chave) ??
        ({
          slug,
          nome: getBenchmark(slug)?.nome ?? slug,
          familia: (w.familia as string | null) ?? null,
          escala,
          formato: (w.formato as string) ?? "outro",
          scoreTipo: (w.scoreTipo as string | null) ?? null,
          maiorMelhor,
          vezes: 0,
          melhor: null,
          ultimo: null,
        } satisfies Marca);

      atual.vezes += 1;
      atual.ultimo = { valor, quando };
      if (
        !atual.melhor ||
        (maiorMelhor ? valor > atual.melhor.valor : valor < atual.melhor.valor)
      ) {
        atual.melhor = { valor, quando };
      }
      porChave.set(chave, atual);
    }

    const data = [...porChave.values()]
      .map((m) => ({
        ...m,
        // Diferença entre as DUAS ÚLTIMAS vezes, com sinal já orientado: valor
        // positivo é melhora, seja o score de tempo (menor) ou de reps (maior).
        delta: null as number | null,
      }))
      .sort((a, b) => (b.ultimo?.quando.getTime() ?? 0) - (a.ultimo?.quando.getTime() ?? 0));

    // Segunda passada para o delta: precisa das duas últimas de cada chave.
    for (const item of data) {
      const doMesmo = linhas
        .filter((a) => {
          const w = (a.metrics as { wod?: Record<string, unknown> } | null)?.wod;
          return w?.slug === item.slug && ((w?.escala as string) ?? "rx") === item.escala;
        })
        .map((a) => (a.metrics as { wod: { scoreValor: number | null } }).wod.scoreValor)
        .filter((v): v is number => v != null);

      if (doMesmo.length >= 2) {
        const ultimo = doMesmo[doMesmo.length - 1];
        const anterior = doMesmo[doMesmo.length - 2];
        item.delta = item.maiorMelhor ? ultimo - anterior : anterior - ultimo;
      }
    }

    res.json({ data, meta: { total: data.length } });
  })
);

function assertObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "ID inválido");
}

// Cria uma atividade (2a: strength) e, se pedido, compartilha no feed.
activitiesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = activityCreateSchema.parse(req.body);
    const { activity, post, newPRs } = await createActivity(req.user!._id, input);
    res.status(201).json({
      data: serializeActivity(activity),
      meta: { sharedPostId: post?._id.toString() ?? null, newPRs },
    });
  })
);

/**
 * Lê o quadro da aula e devolve os blocos montados. NÃO grava nada.
 *
 * Montar um WOD à mão é oito blocos de formulário para um quadro que a pessoa
 * copia em vinte segundos. Aqui ela cola, e confere o que saiu — inclusive
 * porque a leitura NÃO preenche resultado nenhum: o quadro diz o que era para
 * fazer, quanto ela fez é ela quem informa.
 */
const lerQuadroSchema = z.object({ texto: z.string().min(3).max(4000) });
activitiesRouter.post(
  "/ler-quadro",
  // Uma chamada de IA por leitura, e ninguém cola trinta quadros por minuto.
  rateLimit({ windowMs: 60_000, max: 10, name: "ler-quadro" }),
  asyncHandler(async (req, res) => {
    const { texto } = lerQuadroSchema.parse(req.body);
    const leitura = await lerQuadro(texto, { userId: req.user!._id.toString() });
    res.json({ data: leitura });
  })
);

/**
 * O que o servidor entende de um modo escrito. Não grava nada, não chama IA.
 *
 * Existe para o app poder ECOAR o entendimento embaixo do campo enquanto a
 * pessoa monta o bloco — "AMRAP 6' → 6 minutos, resultado em rounds + reps".
 * Sem isso, o campo de texto livre pediria fé: a pessoa digitaria e só
 * descobriria depois de salvar se foi entendido.
 *
 * É rota, e não cópia do interpretador no app, porque duas implementações da
 * mesma regra divergem — e aí a tela promete uma coisa e o banco guarda outra.
 */
const interpretarSchema = z.object({ modo: z.string().min(1).max(120) });
activitiesRouter.post(
  "/interpretar-modo",
  asyncHandler(async (req, res) => {
    const { modo } = interpretarSchema.parse(req.body);
    res.json({ data: interpretarModo(modo) });
  })
);

// Importa um arquivo GPX como atividade de endurance (o servidor deriva o track).
const importGpxSchema = z.object({ sportId: z.string(), gpx: z.string().min(1) });
activitiesRouter.post(
  "/import-gpx",
  asyncHandler(async (req, res) => {
    const { sportId, gpx } = importGpxSchema.parse(req.body);
    const points = parseGpx(gpx);
    if (points.length < 2) throw new HttpError(400, "GPX sem pontos de trajeto suficientes");
    const input = activityCreateSchema.parse({ sportId, kind: "endurance", payload: { points } });
    const { activity, newPRs } = await createActivity(req.user!._id, input);
    res.status(201).json({ data: serializeActivity(activity), meta: { newPRs } });
  })
);

// Lista as próprias atividades, mais novas primeiro, com cursor.
activitiesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!._id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const cursor = req.query.cursor ? decodeCursor(String(req.query.cursor)) : null;

    const filter: mongoose.FilterQuery<typeof Activity> = { user: me };
    if (cursor) {
      filter.$or = [
        { startedAt: { $lt: cursor.startedAt } },
        { startedAt: cursor.startedAt, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
      ];
    }

    const docs = await Activity.find(filter).sort({ startedAt: -1, _id: -1 }).limit(limit + 1);
    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ startedAt: last.startedAt, id: last._id.toString() }) : null;

    res.json({ data: items.map(serializeActivity), meta: { nextCursor } });
  })
);

// Última atividade do usuário num esporte (para pré-preencher o próximo registro:
// última distância/tempo de bike/natação/corrida, etc.). Antes de "/:id".
activitiesRouter.get(
  "/last",
  asyncHandler(async (req, res) => {
    const filter: mongoose.FilterQuery<typeof Activity> = { user: req.user!._id };
    const sportId = String(req.query.sportId ?? "");
    if (sportId) filter.sportId = sportId;
    const kind = String(req.query.kind ?? "");
    if (kind) filter.kind = kind;
    const a = await Activity.findOne(filter).sort({ startedAt: -1 });
    res.json({ data: a ? serializeActivity(a) : null });
  })
);

// Detalhe — respeita a visibilidade (dono sempre; público; seguidores).
activitiesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const a = await Activity.findById(req.params.id);
    if (!a) throw new HttpError(404, "Atividade não encontrada");

    const me = req.user!._id;
    const isOwner = a.user.toString() === me.toString();
    if (!isOwner) {
      // Compartilhar no feed torna o treino visível: quem publicou escolheu
      // mostrar. Fora isso, vale a preferência da pessoa e a visibilidade do
      // treino — antes esta checagem era pulada sempre que havia post.
      const compartilhado = await Post.exists({ activity: a._id, hidden: { $ne: true }, deletedAt: null });
      if (!compartilhado && !(await podeVerAtividade(a, me))) {
        throw new HttpError(404, "Atividade não encontrada");
      }
    }
    // Dono do treino (para o cabeçalho do detalhe ao ver de outra pessoa).
    const u = await User.findById(a.user).select("name username avatarUrl");
    const owner = u
      ? { id: u._id.toString(), name: u.name, username: u.username ?? null, avatarUrl: u.avatarUrl ?? "" }
      : null;

    // Post do compartilhamento (para curtir/comentar direto do detalhe).
    const sharePost = await Post.findOne({ activity: a._id, deletedAt: null }).sort({ createdAt: 1 });
    const post = sharePost
      ? {
          id: sharePost._id.toString(),
          likeCount: sharePost.likeCount,
          commentCount: sharePost.commentCount,
          likedByMe: !!(await Like.exists({ user: me, post: sharePost._id })),
        }
      : null;

    const serializada = serializeActivity(a);
    res.json({
      data: {
        ...serializada,
        // O traçado só sai se o dono tornou as rotas públicas.
        payload: await podarRotaSePrivada(
          (serializada.payload ?? {}) as Record<string, unknown>,
          a.user,
          me
        ),
        owner,
        post,
      },
    });
  })
);

// Compartilhar um treino já registrado. Antes só dava para decidir no instante
// do registro (shareToFeed): quem lembrasse depois não tinha caminho.
activitiesRouter.post(
  "/:id/share",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const { caption } = z
      .object({ caption: z.string().max(2000).optional() })
      .parse(req.body ?? {});

    const a = await Activity.findById(req.params.id);
    if (!a) throw new HttpError(404, "Atividade não encontrada");
    if (a.user.toString() !== req.user!._id.toString()) {
      throw new HttpError(403, "Só o dono do treino pode compartilhar");
    }

    // Um treino, um post. Compartilhar de novo devolve o que já existe em vez
    // de encher o feed com o mesmo treino repetido.
    const existente = await Post.findOne({ activity: a._id, hidden: { $ne: true }, deletedAt: null });
    if (existente) {
      res.json({ data: { postId: existente._id.toString() }, meta: { jaCompartilhado: true } });
      return;
    }

    const sport = getSport(a.sportId);
    const post = await Post.create({
      author: a.user,
      text: caption?.trim() || `Treino de ${sport?.label ?? a.sportId} concluído 💪`,
      activity: a._id,
    });

    res.status(201).json({ data: { postId: post._id.toString() }, meta: { jaCompartilhado: false } });
  })
);

const updateSchema = z.object({
  title: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  visibility: z.enum(["private", "followers", "public"]).optional(),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  perceivedEffort: z.number().int().min(1).max(10).optional(),
  feeling: z.enum(["otimo", "bom", "normal", "ruim", "pessimo"]).optional(),
  payload: strengthPayloadSchema.optional(),
});

activitiesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const a = await Activity.findById(req.params.id);
    if (!a || a.user.toString() !== req.user!._id.toString()) {
      throw new HttpError(404, "Atividade não encontrada");
    }
    const patch = updateSchema.parse(req.body);
    if (patch.title !== undefined) a.title = patch.title;
    if (patch.notes !== undefined) a.notes = patch.notes;
    if (patch.visibility !== undefined) a.visibility = patch.visibility;
    if (patch.durationSec !== undefined) a.durationSec = patch.durationSec;
    if (patch.perceivedEffort !== undefined) a.perceivedEffort = patch.perceivedEffort;
    if (patch.feeling !== undefined) a.feeling = patch.feeling;
    if (patch.payload !== undefined) {
      a.payload = patch.payload;
      a.metrics = computeStrengthMetrics(patch.payload);
      a.markModified("payload");
      a.markModified("metrics");
    }
    await a.save();
    res.json({ data: serializeActivity(a) });
  })
);

activitiesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const r = await Activity.deleteOne({ _id: req.params.id, user: req.user!._id });
    if (!r.deletedCount) throw new HttpError(404, "Atividade não encontrada");
    res.json({ data: { deleted: true } });
  })
);
