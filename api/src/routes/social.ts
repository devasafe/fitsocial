import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { User } from "../models/User.js";
import { Post } from "../models/Post.js";
import { Activity } from "../models/Activity.js";
import {
  filtroDeAtividadesVisiveis,
  podarRotaSePrivada,
} from "../services/activityVisibility.js";
import { Follow } from "../models/Follow.js";
import { Like } from "../models/Like.js";
import { Comment } from "../models/Comment.js";
import { createNotification } from "../services/notifications.js";
import { enviarPush, avisarSeguidoresDePost } from "../services/push/index.js";
import { editarPost, excluirPost } from "../services/postModeration.js";
import { Report, MOTIVOS_DE_DENUNCIA } from "../models/Report.js";
import { recordAudit } from "../services/adminAudit.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";
import { getSport } from "../services/sports.js";
import {
  montarCartao,
  layoutEfetivo,
  LAYOUTS,
  type Formato,
  type Layout,
} from "../services/media/cartaoDeCompartilhar.js";
import { movimentosDoCartao } from "../services/media/movimentosDoCartao.js";
import { musculosDoTreinoSalvo } from "../services/activityMetrics.js";
import { normalizarWod, blocoPrincipal } from "../services/crossfit.js";
import { getStorageProvider } from "../services/storage/index.js";
import { rateLimit } from "../middleware/rateLimit.js";

export const socialRouter = Router();
socialRouter.use(requireAuth);

// ---- busca de pessoas ----

socialRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json({ users: [] });
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escapa regex
    const rx = new RegExp(safe, "i");
    const me = req.user!._id;
    const users = await User.find({
      _id: { $ne: me },
      $or: [{ username: rx }, { name: rx }],
    })
      .select("name username avatarUrl")
      .limit(20);

    const followingIds = new Set(
      (await Follow.find({ follower: me, following: { $in: users.map((u) => u._id) } }).select("following"))
        .map((f) => f.following.toString())
    );

    res.json({
      users: users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        username: u.username ?? null,
        avatarUrl: u.avatarUrl ?? "",
        isFollowing: followingIds.has(u._id.toString()),
      })),
    });
  })
);

// ---- helpers ----

interface PopulatedAuthor {
  _id: mongoose.Types.ObjectId;
  name: string;
  username?: string;
  avatarUrl?: string;
}

function serializePost(
  post: InstanceType<typeof Post>,
  likedIds: Set<string>,
  opts?: { followingIds?: Set<string>; meId?: string }
) {
  const author = post.author as unknown as PopulatedAuthor;
  const authorId = author._id.toString();
  return {
    id: post._id.toString(),
    text: post.text,
    imageUrl: post.imageUrl,
    // Null nos posts antigos — o app se vira com o tamanho real da imagem.
    imageWidth: post.imageWidth ?? null,
    imageHeight: post.imageHeight ?? null,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    likedByMe: likedIds.has(post._id.toString()),
    createdAt: post.get("createdAt") as Date,
    /** Presente quando o texto foi alterado — o app mostra "(editado)". */
    editedAt: post.editedAt ?? null,
    author: {
      id: authorId,
      name: author.name,
      username: author.username ?? null,
      avatarUrl: author.avatarUrl ?? "",
      // Preenchidos onde há contexto de descoberta (ex.: explore) — senão false.
      isMe: opts?.meId ? authorId === opts.meId : false,
      isFollowing: opts?.followingIds ? opts.followingIds.has(authorId) : false,
    },
    // Resumo da atividade vinculada (quando o post é um compartilhamento e a
    // query populou `activity`) — hoje carrega os movimentos do WOD para o card.
    activity: activitySummary(post),
  };
}

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Decimal com vírgula. Estes números aparecem no card do feed e vão para o
 *  Instagram dentro do cartão: "5.2 km" é um número escrito em outra língua. */
function numero(v: number, casas = 2): string {
  const arredondado = Math.round(v * 10 ** casas) / 10 ** casas;
  return String(arredondado).replace(".", ",");
}

interface ActivityPayload {
  name?: string;
  level?: string;
  activityName?: string;
  sessionType?: string;
  /** Força: o que basta para redescobrir o músculo de um treino antigo. */
  exercises?: { name?: string; muscle?: string | null; exerciseId?: string | null }[];
  resultTimeSec?: number | null;
  resultRounds?: number | null;
  resultReps?: number | null;
  resultLoadKg?: number | null;
  /** Track de GPS de corrida e pedal — o cartao de compartilhar desenha o traco. */
  points?: { lat: number; lng: number }[];
}
/** O que o card lê de `metrics` — o campo é `Mixed`, então o tipo mora aqui. */
interface ActivityMetrics {
  volumeTotalKg?: number;
  seriesValidas?: number;
  distanceKm?: number;
  avgPaceSecPerKm?: number;
  minutes?: number;
  /** Grupos musculares do treino, do mais trabalhado para o menos. */
  musculos?: string[];
}

interface PopulatedActivity {
  _id: mongoose.Types.ObjectId;
  kind: string;
  sportId: string;
  title?: string;
  durationSec?: number;
  metrics?: ActivityMetrics;
  payload?: ActivityPayload;
}

/**
 * "Quadríceps · Panturrilha". Três é o teto: o card é lido de passagem, e uma
 * lista de seis grupos não é mais informativa que "+3" — é só mais longa.
 */
const MAX_MUSCULOS_NO_TITULO = 3;

/**
 * Versão do CONTEÚDO do cartão de compartilhar.
 *
 * O cartão é um PNG montado uma vez e guardado em `post.cartoes`, com chave por
 * formato e layout. Quando o que o cartão ESCREVE muda — como agora, que o
 * título de um treino de força virou os músculos e a carga total saiu dos
 * stats — os cartões já montados continuariam sendo servidos com o texto
 * antigo, para sempre, enquanto o feed mostra o novo.
 *
 * Suba este número sempre que mudar `activitySummary` ou `movimentosDoCartao`.
 * Os PNGs da versão anterior ficam órfãos no storage: é o preço de não servir
 * imagem desatualizada, e é uma limpeza de ops, não de código.
 */
// 3: o selo de recorde. Subir este numero e o que aposenta os PNGs ja
// montados — sem isso, quem ja compartilhou continuaria recebendo o desenho
// velho para sempre, do cache em `post.cartoes`.
const VERSAO_DO_CARTAO = 3;

/**
 * "NOVO RECORDE · SUPINO RETO", quando o treino bateu um.
 *
 * Um so, mesmo quando o treino bateu varios: o cartao e lido de passagem, e
 * uma lista de conquistas nao e mais comemoracao que a primeira delas — e a
 * primeira e a que o motor considera principal (`prEngine`).
 *
 * So tipos de FORCA entram, e a lista e fechada por um motivo concreto: em wod
 * e endurance o `exerciseName` do candidato nao e um nome, e sim a chave —
 * `chaveDoMovimento(nome)` no wod e o `sportId` no endurance. O cartao
 * anunciaria "NOVO RECORDE · TREINO_A", com underscore, ou "· CORRIDA" jogando
 * fora a distancia, que mora no `repRange`. Marco de aula tambem fica fora:
 * e conquista, mas nao e recorde.
 */
const TIPOS_COM_NOME = new Set(["carga_max", "rm_estimado", "carga_faixa"]);

function seloDoRecorde(metrics: unknown): string | null {
  const prs = (metrics as { prs?: { type?: string; exerciseName?: string }[] } | undefined)?.prs;
  if (!Array.isArray(prs) || prs.length === 0) return null;

  const pr = prs.find((p) => p.type && TIPOS_COM_NOME.has(p.type));
  if (!pr?.exerciseName?.trim()) return null;

  return `NOVO RECORDE · ${pr.exerciseName.toUpperCase()}`;
}

function tituloPorMusculos(musculos: string[]): string {
  if (!musculos.length) return "";
  const mostrados = musculos.slice(0, MAX_MUSCULOS_NO_TITULO);
  const resto = musculos.length - mostrados.length;
  return mostrados.join(" · ") + (resto > 0 ? ` +${resto}` : "");
}

/** `metrics` com os músculos garantidos — para as telas que leem métrica crua. */
function comMusculos(a: {
  kind: string;
  metrics?: Record<string, unknown> | null;
  payload?: unknown;
}): Record<string, unknown> {
  const metrics = { ...(a.metrics ?? {}) };
  if (a.kind !== "strength") return metrics;

  const musculos = musculosDoTreinoSalvo({
    metrics: metrics as { musculos?: unknown },
    payload: a.payload,
  });
  if (musculos.length) metrics.musculos = musculos;
  return metrics;
}

// Resumo do treino para o card do feed — genérico por kind (title + stats + movimentos do WOD).
function activitySummary(post: InstanceType<typeof Post>) {
  const act = post.activity as unknown;
  if (!act || typeof act !== "object" || !("kind" in act)) return null;
  const a = act as PopulatedActivity;
  const pl = a.payload ?? {};
  const m = a.metrics ?? {};
  const dur = a.durationSec ?? 0;
  const label = getSport(a.sportId)?.label ?? a.sportId;

  let title = label;
  const stats: string[] = [];
  let movements: string[] | null = null;

  if (a.kind === "strength") {
    // O assunto de um treino de força é o que foi treinado, não quanto pesou.
    // Carga total é métrica de acompanhamento — vive no detalhe e no progresso,
    // não no feed: ninguém conta treino em toneladas. Sem nenhum músculo
    // reconhecido, o título volta a ser o esporte, como sempre foi.
    // O nome que a pessoa deu ganha; depois o que ela treinou; por último o
    // esporte, como sempre foi. A query já trazia `title` e o card o ignorava —
    // e o cartão do perfil, que lê o mesmo treino, sempre preferiu o nome.
    title = a.title?.trim() || tituloPorMusculos(musculosDoTreinoSalvo(a)) || label;
    if (dur) stats.push(mmss(dur));
  } else if (a.kind === "endurance") {
    if (m.distanceKm) stats.push(`${numero(m.distanceKm)} km`);
    if (dur) stats.push(mmss(dur));
    if (m.avgPaceSecPerKm) stats.push(`${mmss(m.avgPaceSecPerKm)} /km`);
  } else if (a.kind === "class") {
    if (m.minutes) stats.push(`${Math.round(m.minutes)} min`);
    else if (dur) stats.push(mmss(dur));
    if (pl.sessionType) stats.push(String(pl.sessionType));
  } else if (a.kind === "wod") {
    const wod = normalizarWod(a.payload);
    const principal = blocoPrincipal(wod);

    title = wod.nome || principal?.nome || label;
    if (principal?.escala?.nivel) stats.push(principal.escala.nivel.toUpperCase());

    const r = principal?.resultado;
    const resultado =
      r?.tipo === "tempo" && r.tempoSec != null
        ? mmss(r.tempoSec)
        : r?.tipo === "rounds_reps" && r.rounds != null
          ? `${r.rounds}${r.repsExtras ? ` + ${r.repsExtras}` : ""}`
          : r?.tipo === "reps" && r.reps != null
            ? `${r.reps} reps`
            : r?.tipo === "carga" && r.cargaKg != null
              ? `${numero(r.cargaKg)} kg`
              : r?.tipo === "distancia" && r.distanciaM != null
                ? `${r.distanciaM} m`
                : null;
    if (resultado) stats.push(resultado);
    if (wod.tamanhoDoTime > 1) stats.push(`em ${wod.tamanhoDoTime}`);
  } else {
    // generic
    if (pl.activityName) title = String(pl.activityName);
    if (m.minutes) stats.push(`${Math.round(m.minutes)} min`);
    else if (dur) stats.push(mmss(dur));
  }

  // O MESMO formatador do cartão de compartilhar, agora para todo formato que
  // tenha o que listar. Eram dois caminhos, e os dois tinham que concordar
  // sobre como se escreve "21-15-9  Thruster  43 kg" — e agora também
  // "4×10  Agachamento livre  100 kg". `null` quando não há nada: é o que o
  // app instalado espera, e ele já sabe desenhar a lista.
  const linhas = movimentosDoCartao(a.kind, a.payload as Record<string, unknown>);
  movements = linhas.length ? linhas : null;

  return { id: a._id.toString(), kind: a.kind, sportId: a.sportId, title, stats, movements };
}

/** Dado um conjunto de posts, retorna o set de ids que o usuário curtiu. */
async function likedSetFor(userId: mongoose.Types.ObjectId, postIds: mongoose.Types.ObjectId[]) {
  const likes = await Like.find({ user: userId, post: { $in: postIds } }).select("post");
  return new Set(likes.map((l) => l.post.toString()));
}

function assertObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "ID inválido");
}

// ---- posts ----

const createPostSchema = z
  .object({
    text: z.string().max(2000).optional(),
    imageUrl: z.string().url("URL de imagem inválida").optional(),
    // Vêm da resposta do upload. Opcionais: o APK antigo não os envia.
    imageWidth: z.number().int().positive().max(20_000).optional(),
    imageHeight: z.number().int().positive().max(20_000).optional(),
    activityId: z.string().optional(),
  })
  .refine((b) => !!(b.text?.trim() || b.imageUrl || b.activityId), {
    message: "Escreva algo, adicione uma foto ou anexe um treino",
  });

socialRouter.post(
  "/posts",
  asyncHandler(async (req, res) => {
    const { text, imageUrl, imageWidth, imageHeight, activityId } = createPostSchema.parse(
      req.body
    );

    // Anexo de treino: precisa existir e ser do próprio usuário.
    let activity: mongoose.Types.ObjectId | undefined;
    if (activityId) {
      assertObjectId(activityId);
      const act = await Activity.findOne({ _id: activityId, user: req.user!._id }).select("_id");
      if (!act) throw new HttpError(404, "Treino não encontrado");
      activity = act._id;
    }

    const post = await Post.create({
      author: req.user!._id,
      text: text?.trim() ?? "",
      imageUrl: imageUrl ?? "",
      imageWidth: imageWidth ?? null,
      imageHeight: imageHeight ?? null,
      ...(activity ? { activity } : {}),
    });
    await post.populate("author", "name username avatarUrl");
    if (activity) await post.populate("activity", "kind sportId payload metrics durationSec title");
    res.status(201).json({ post: serializePost(post, new Set()) });

    // Depois da resposta: quem publicou não espera o push dos seguidores sair.
    // A janela de silêncio de cada um decide se ele recebe algo ou não.
    void avisarSeguidoresDePost(req.user!._id, req.user!.name);
  })
);

// Feed: posts de quem o usuário segue + os próprios, do mais novo ao mais antigo.
socialRouter.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const me = req.user!._id;
    const limit = Math.min(Number(req.query.limit) || 30, 50);

    const following = await Follow.find({ follower: me }).select("following");
    const authorIds = [...following.map((f) => f.following), me];

    const posts = await Post.find({ author: { $in: authorIds }, hidden: { $ne: true }, deletedAt: null })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("author", "name username avatarUrl")
      .populate("activity", "kind sportId payload metrics durationSec title");

    const likedIds = await likedSetFor(me, posts.map((p) => p._id));
    res.json({ posts: posts.map((p) => serializePost(p, likedIds)) });
  })
);

// Explorar: posts de TODOS (descoberta), mais novos primeiro. Post só existe
// quando o usuário publica/compartilha, então o timeline global é seguro.
socialRouter.get(
  "/explore",
  asyncHandler(async (req, res) => {
    const me = req.user!._id;
    const limit = Math.min(Number(req.query.limit) || 50, 50);
    // Paginação por cursor: ?before=<ISO do createdAt do último post da página anterior>.
    const before = String(req.query.before ?? "");
    const filter: mongoose.FilterQuery<typeof Post> =
      before && !Number.isNaN(Date.parse(before)) ? { createdAt: { $lt: new Date(before) } } : {};
    // Conteúdo escondido pela moderação não aparece na descoberta.
    filter.hidden = { $ne: true };
    filter.deletedAt = null;

    const posts = await Post.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("author", "name username avatarUrl")
      .populate("activity", "kind sportId payload metrics durationSec title");

    const authorIds = posts.map((p) => (p.author as unknown as { _id: mongoose.Types.ObjectId })._id);
    const [likedIds, follows] = await Promise.all([
      likedSetFor(me, posts.map((p) => p._id)),
      Follow.find({ follower: me, following: { $in: authorIds } }).select("following"),
    ]);
    const followingIds = new Set(follows.map((f) => f.following.toString()));
    const meId = me.toString();
    // Só há próxima página se veio a página cheia.
    const nextBefore = posts.length === limit ? (posts[posts.length - 1].get("createdAt") as Date).toISOString() : null;
    res.json({ posts: posts.map((p) => serializePost(p, likedIds, { followingIds, meId })), nextBefore });
  })
);

// Post único (usado pelo deep-link das notificações, que só carrega o id).
socialRouter.get(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const post = await Post.findById(req.params.id).populate("author", "name username avatarUrl")
      .populate("activity", "kind sportId payload metrics durationSec title");
    // Quem chega por link ou notificação de um post excluído merece saber o
    // que aconteceu, em vez de um "não encontrado" que parece erro do app.
    if (post?.deletedAt) {
      throw new HttpError(410, "Esta publicação não está mais disponível.");
    }
    // Post escondido responde 404 para terceiros: existir e negar já entrega
    // que existe. O autor continua vendo o próprio conteúdo.
    if (!post || (post.hidden && !post.author._id.equals(req.user!._id))) {
      throw new HttpError(404, "Post não encontrado");
    }
    const likedIds = await likedSetFor(req.user!._id, [post._id]);
    res.json({ post: serializePost(post, likedIds) });
  })
);

/**
 * O cartão para compartilhar fora do app (Instagram, WhatsApp, o que for).
 *
 * Montado aqui, e não no aplicativo, por dois motivos: o mesmo desenho vale
 * para Android e navegador, e mudar o layout depois não obriga ninguém a
 * atualizar o app.
 */
socialRouter.post(
  "/posts/:id/cartao",
  // Cada cartão é um redimensionamento de imagem e uma escrita no storage.
  rateLimit({ windowMs: 60_000, max: 12, name: "cartao-compartilhar" }),
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const formato: Formato = req.query.formato === "feed" ? "feed" : "story";
    // Desenho vem do app; qualquer valor estranho cai no padrão em vez de
    // derrubar o compartilhamento.
    const pedido = LAYOUTS.includes(req.query.layout as Layout)
      ? (req.query.layout as Layout)
      : "foto";

    const post = await Post.findById(req.params.id)
      .populate("author", "name username avatarUrl")
      .populate("activity", "kind sportId payload metrics durationSec title");

    if (!post || post.deletedAt) throw new HttpError(404, "Post não encontrado");
    // Só o dono compartilha o próprio post: o cartão leva o nome de quem
    // treinou, e gerar o de outra pessoa seria assinar por ela.
    if (!post.author._id.equals(req.user!._id)) {
      throw new HttpError(403, "Só dá para compartilhar o seu próprio post");
    }

    const resumo = activitySummary(post);

    // A foto vem do próprio storage do app; sem ela o cartão é só os números.
    let foto: Buffer | null = null;
    if (post.imageUrl) {
      try {
        const r = await fetch(post.imageUrl, { signal: AbortSignal.timeout(10_000) });
        if (r.ok) foto = Buffer.from(await r.arrayBuffer());
      } catch {
        // Foto fora do ar não impede o compartilhamento.
      }
    }

    const layout = layoutEfetivo(pedido, !!foto);
    const chave = `${formato}:${layout}:${VERSAO_DO_CARTAO}`;

    // Já montado antes: devolve o mesmo arquivo. Olhar os três layouts para
    // escolher é o uso normal, e sem isto cada olhada deixa um PNG órfão.
    const emCache = post.cartoes?.get(chave);
    if (emCache) {
      res.json({ url: toAbsoluto(req, emCache), formato, layout });
      return;
    }

    const autor = post.author as unknown as PopulatedAuthor;
    const atividade = post.activity as unknown as PopulatedActivity | undefined;
    const percurso = Array.isArray(atividade?.payload?.points)
      ? (atividade.payload.points as { lat: number; lng: number }[])
      : null;

    const png = await montarCartao(
      {
        foto,
        titulo: resumo?.title ?? post.text.slice(0, 60) ?? "",
        stats: resumo?.stats ?? [],
        movimentos: movimentosDoCartao(
          atividade?.kind,
          atividade?.payload as Record<string, unknown> | undefined
        ),
        cor: (resumo && getSport(resumo.sportId)?.color) || "#3BCC06",
        percurso,
        autor: autor.name,
        selo: seloDoRecorde(atividade?.metrics),
      },
      formato,
      layout
    );

    const salvo = await getStorageProvider().save({
      buffer: png,
      contentType: "image/png",
      ext: ".png",
    });

    // Guarda a URL COMO VEIO do storage: `toAbsoluto` depende do host da
    // requisição, e gravar isso fixaria o domínio de hoje dentro do banco.
    await Post.updateOne({ _id: post._id }, { $set: { [`cartoes.${chave}`]: salvo.url } });

    res.json({ url: toAbsoluto(req, salvo.url), formato, layout });
  })
);

/** URL relativa (disco, em desenvolvimento) vira absoluta; S3 já vem pronta. */
function toAbsoluto(req: { protocol: string; get(n: string): string | undefined }, url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${req.protocol}://${req.get("host")}${url}`;
}

// Editar o próprio post. Só o texto — ver services/postModeration.ts.
socialRouter.patch(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const { text } = z.object({ text: z.string().max(2000) }).parse(req.body);
    const post = await editarPost(req.user!, req.params.id, text);
    await post.populate("author", "name username avatarUrl");
    await post.populate("activity", "kind sportId payload metrics durationSec title");
    const likedIds = await likedSetFor(req.user!._id, [post._id]);
    res.json({ data: serializePost(post, likedIds), meta: {} });
  })
);

// Excluir o próprio post. Administrador também pode, em qualquer post.
socialRouter.delete(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const admin = req.user!.role === "admin";
    const r = await excluirPost(req.user!, req.params.id, { comoAdmin: admin });

    if (admin) {
      const post = await Post.findById(req.params.id).select("author");
      if (post && !post.author.equals(req.user!._id)) {
        // Remoção de conteúdo alheio é ato administrativo: fica registrado.
        await recordAudit({
          actor: req.user!,
          action: "post.remove",
          targetKind: "post",
          targetId: post._id,
          reason: "remoção pelo painel",
        });
      }
    }

    res.json({ data: { excluido: true }, meta: r });
  })
);

// Denunciar um post.
const denunciaSchema = z.object({
  reason: z.enum(MOTIVOS_DE_DENUNCIA),
  details: z.string().max(500).optional(),
});

socialRouter.post(
  "/posts/:id/report",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const { reason, details } = denunciaSchema.parse(req.body);

    const post = await Post.findById(req.params.id).populate("author", "name email");
    if (!post || post.deletedAt) throw new HttpError(404, "Post não encontrado");

    if (post.author._id.equals(req.user!._id)) {
      // Para o próprio conteúdo existe excluir, não denunciar.
      throw new HttpError(400, "Você não pode denunciar a sua própria publicação.");
    }

    const autor = post.author as unknown as { _id: mongoose.Types.ObjectId; name: string };

    try {
      await Report.create({
        reporter: req.user!._id,
        targetKind: "post",
        targetId: post._id,
        targetAuthor: autor._id,
        reason,
        details: details ?? "",
        // Guardado agora porque o conteúdo pode sumir antes da análise.
        snapshot: {
          texto: post.text ?? "",
          imageUrl: post.imageUrl ?? "",
          autorLabel: autor.name,
        },
      });
    } catch (err) {
      // Índice único: já denunciou este conteúdo. Responder como sucesso evita
      // dizer "você já denunciou", que não ajuda em nada quem está denunciando.
      if ((err as { code?: number }).code !== 11000) throw err;
    }

    res.status(201).json({
      data: { enviada: true },
      meta: {},
    });
  })
);

// ---- curtidas (toggle) ----

socialRouter.post(
  "/posts/:id/like",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const post = await Post.findById(req.params.id);
    if (!post || post.deletedAt) throw new HttpError(404, "Post não encontrado");

    const result = await Like.updateOne(
      { user: req.user!._id, post: post._id },
      { $setOnInsert: { user: req.user!._id, post: post._id } },
      { upsert: true }
    );
    if (result.upsertedCount) {
      post.likeCount += 1;
      await post.save();
      await createNotification({
        userId: post.author,
        actorId: req.user!._id,
        actorName: req.user!.name,
        type: "like",
        targetKind: "post",
        targetId: post._id,
      });
    }
    res.json({ liked: true, likeCount: post.likeCount });
  })
);

socialRouter.delete(
  "/posts/:id/like",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const post = await Post.findById(req.params.id);
    if (!post || post.deletedAt) throw new HttpError(404, "Post não encontrado");

    const result = await Like.deleteOne({ user: req.user!._id, post: post._id });
    if (result.deletedCount && post.likeCount > 0) {
      post.likeCount -= 1;
      await post.save();
    }
    res.json({ liked: false, likeCount: post.likeCount });
  })
);

// ---- seguir (toggle) ----

socialRouter.post(
  "/users/:id/follow",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const targetId = req.params.id;
    if (targetId === req.user!._id.toString()) {
      throw new HttpError(400, "Você não pode seguir a si mesmo");
    }
    const target = await User.findById(targetId);
    if (!target) throw new HttpError(404, "Usuário não encontrado");

    const followResult = await Follow.updateOne(
      { follower: req.user!._id, following: target._id },
      { $setOnInsert: { follower: req.user!._id, following: target._id } },
      { upsert: true }
    );
    if (followResult.upsertedCount) {
      await createNotification({
        userId: target._id,
        actorId: req.user!._id,
        actorName: req.user!.name,
        type: "follow",
        targetKind: "profile",
        targetId: req.user!._id,
      });
    }
    res.json({ following: true });
  })
);

socialRouter.delete(
  "/users/:id/follow",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    await Follow.deleteOne({ follower: req.user!._id, following: req.params.id });
    res.json({ following: false });
  })
);

// ---- perfil público ----

socialRouter.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const me = req.user!._id;
    const user = await User.findById(req.params.id).select("name username avatarUrl bio");
    if (!user) throw new HttpError(404, "Usuário não encontrado");

    const filtroPosts = {
      author: user._id,
      deletedAt: null,
      ...(user._id.equals(me) ? {} : { hidden: { $ne: true } }),
    };
    const filtroAtividades = await filtroDeAtividadesVisiveis(user._id, me);

    const [posts, totalPosts, totalAtividades, followers, following, isFollowing] =
      await Promise.all([
        Post.find(filtroPosts)
          .sort({ createdAt: -1 }).limit(30).populate("author", "name username avatarUrl")
          .populate("activity", "kind sportId payload metrics durationSec title"),
        // Contagem de verdade. Antes era posts.length, que vinha de uma query
        // com limit(30) — o número parava de crescer na trigésima publicação.
        Post.countDocuments(filtroPosts),
        Activity.countDocuments(filtroAtividades),
        Follow.countDocuments({ following: user._id }),
        Follow.countDocuments({ follower: user._id }),
        Follow.exists({ follower: me, following: user._id }),
      ]);

    const likedIds = await likedSetFor(me, posts.map((p) => p._id));
    res.json({
      user: {
        id: user._id.toString(),
        name: user.name,
        username: user.username ?? null,
        avatarUrl: user.avatarUrl ?? "",
        bio: user.bio ?? "",
      },
      // "treinos" passa a contar treinos. Antes o app exibia a contagem de
      // posts com esse rótulo, então quem treinava sem publicar via zero.
      counts: { treinos: totalAtividades, posts: totalPosts, followers, following },
      isFollowing: Boolean(isFollowing),
      isMe: user._id.toString() === me.toString(),
      posts: posts.map((p) => serializePost(p, likedIds)),
    });
  })
);

// ---- comentários ----

const createCommentSchema = z.object({ text: z.string().min(1, "Escreva algo").max(1000) });

function serializeComment(comment: InstanceType<typeof Comment>) {
  const author = comment.author as unknown as PopulatedAuthor;
  return {
    id: comment._id.toString(),
    text: comment.text,
    createdAt: comment.get("createdAt") as Date,
    author: {
      id: author._id.toString(),
      name: author.name,
      avatarUrl: author.avatarUrl ?? "",
    },
  };
}

// Treinos públicos de alguém — o que dá corpo à aba "Treinos" do perfil.
// Sem isto, o perfil de outra pessoa só mostrava o que ela publicou no feed.
socialRouter.get(
  "/users/:id/activities",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const me = req.user!._id;
    const dono = new mongoose.Types.ObjectId(req.params.id);

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const cursor = req.query.cursor ? decodeCursor(String(req.query.cursor)) : null;

    const filtro: mongoose.FilterQuery<typeof Activity> = {
      ...(await filtroDeAtividadesVisiveis(dono, me)),
    };
    if (cursor) {
      filtro.$and = [
        {
          $or: [
            { startedAt: { $lt: cursor.startedAt } },
            { startedAt: cursor.startedAt, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
          ],
        },
      ];
    }

    const docs = await Activity.find(filtro).sort({ startedAt: -1, _id: -1 }).limit(limit + 1);
    const temMais = docs.length > limit;
    const itens = temMais ? docs.slice(0, limit) : docs;
    const ultimo = itens[itens.length - 1];
    const nextCursor =
      temMais && ultimo
        ? encodeCursor({ startedAt: ultimo.startedAt, id: ultimo._id.toString() })
        : null;

    // Quais desses treinos a pessoa também publicou no feed — o card mostra isso.
    const idsComPost = new Set(
      (await Post.find({ activity: { $in: itens.map((a) => a._id) }, hidden: { $ne: true }, deletedAt: null })
        .select("activity"))
        .map((p) => p.activity?.toString())
        .filter(Boolean) as string[]
    );

    const data = await Promise.all(
      itens.map(async (a) => ({
        id: a._id.toString(),
        sportId: a.sportId,
        kind: a.kind,
        title: a.title ?? "",
        startedAt: a.startedAt,
        durationSec: a.durationSec,
        // Os músculos entram aqui mesmo quando não foram calculados no save —
        // o card do perfil mostra o mesmo assunto que o card do feed, e nenhum
        // dos dois espera o backfill.
        metrics: comMusculos(a),
        // Os exercícios já escritos, como no feed. Vem do servidor pelo MESMO
        // formatador, e não do payload cru: duas implementações da mesma
        // formatação divergem, e aí o mesmo treino se escreve de dois jeitos
        // dependendo de por qual tela a pessoa chegou nele.
        movimentos: movimentosDoCartao(a.kind, (a.payload ?? {}) as Record<string, unknown>),
        // Blocos normalizados ao lado do payload cru — o card de CrossFit lê
        // daqui, e o app instalado continua lendo o payload.
        ...(a.kind === "wod" ? { crossfit: normalizarWod(a.payload) } : {}),
        // O traçado de GPS só sai se o dono tornou as rotas públicas.
        payload: await podarRotaSePrivada(
          (a.payload ?? {}) as Record<string, unknown>,
          a.user,
          me
        ),
        compartilhado: idsComPost.has(a._id.toString()),
      }))
    );

    res.json({ data, meta: { nextCursor } });
  })
);

// Cria um comentário e incrementa a contagem do post.
socialRouter.post(
  "/posts/:id/comments",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const { text } = createCommentSchema.parse(req.body);
    const post = await Post.findById(req.params.id);
    if (!post || post.deletedAt) throw new HttpError(404, "Post não encontrado");

    const comment = await Comment.create({ post: post._id, author: req.user!._id, text });
    post.commentCount += 1;
    await post.save();
    await createNotification({
      userId: post.author,
      actorId: req.user!._id,
      actorName: req.user!.name,
      type: "comment",
      targetKind: "post",
      targetId: post._id,
    });

    // O único push que sai na hora: tem alguém do outro lado esperando resposta.
    if (!post.author.equals(req.user!._id)) {
      void enviarPush(post.author, "comment", {
        title: `${req.user!.name} comentou no seu post`,
        body: text.slice(0, 120),
        data: { tela: "post", postId: post._id.toString() },
      });
    }

    await comment.populate("author", "name avatarUrl");
    res.status(201).json({ comment: serializeComment(comment) });
  })
);

// Lista os comentários de um post (mais antigos primeiro).
socialRouter.get(
  "/posts/:id/comments",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const comments = await Comment.find({ post: req.params.id, hidden: { $ne: true } })
      .sort({ createdAt: 1 })
      .limit(200)
      .populate("author", "name avatarUrl");
    res.json({ comments: comments.map(serializeComment) });
  })
);
