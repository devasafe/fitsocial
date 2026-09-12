import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requirePro } from "../middleware/pro.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { ProfessionalLink, PAPEIS_PRO, type PapelPro } from "../models/ProfessionalLink.js";
import { limiteDeAlunos } from "../services/entitlement.js";
import {
  aceitarConvite,
  ajustarEscopo,
  encerrarVinculo,
  gerarConvite,
  quantosAlunos,
  verConvite,
  vinculosAtivos,
} from "../services/vinculos.js";
import {
  METRICAS,
  calendarioDoUsuario,
  exerciciosDoUsuario,
  gruposDoUsuario,
  serieDoExercicio,
} from "../services/evolucao.js";
import { PersonalRecordEvent } from "../models/PersonalRecordEvent.js";
import { computeStats } from "../services/adherence.js";
import { Plan, workoutSchema } from "../models/Plan.js";
import { ProMessage } from "../models/ProMessage.js";
import { enviarPush } from "../services/push/index.js";
import { decodeCursor, decodeCursorCriacao, encodeCursor, encodeCursorCriacao } from "../utils/cursor.js";

/**
 * O aviso que acompanha um treino escrito por gente, e não pela IA.
 *
 * O `disclaimer` é obrigatório no modelo e nasceu para a IA; um plano de coach
 * precisa do seu, que diz outra coisa — quem responde pelo treino é um
 * profissional com nome, e a pessoa deve parar se sentir dor.
 */
const DISCLAIMER_DO_COACH =
  "Treino prescrito pelo seu profissional. Em caso de dor ou desconforto, pare e fale com ele.";

export const proRouter = Router();
proRouter.use(requireAuth);

// O painel profissional, e o lado do aluno que responde a ele.
//
// As duas metades vivem no mesmo arquivo porque são a mesma conversa vista de
// cada lado — mas têm guardas diferentes: o profissional passa por
// `requirePro`, e o aluno só precisa estar logado. Aceitar um convite é coisa
// de aluno; ninguém precisa ser coach para ser acompanhado por um.

const papelSchema = z.enum(PAPEIS_PRO);
const escopoSchema = z.object({
  treinos: z.boolean().optional(),
  dieta: z.boolean().optional(),
  medidas: z.boolean().optional(),
  fotos: z.boolean().optional(),
});

// ---------------------------------------------------------------- profissional

/** Quem sou eu como profissional: capacidades, teto e quanto já usei. */
proRouter.get(
  "/me",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const capacidades = await Promise.all(
      PAPEIS_PRO.map(async (papel) => ({
        papel,
        ativo: user.pro?.[papel]?.ativo === true,
        limite: limiteDeAlunos(user, papel),
        alunos: await quantosAlunos(user._id, papel),
      }))
    );
    res.json({ data: { capacidades: capacidades.filter((c) => c.ativo) }, meta: {} });
  })
);

const novoConviteSchema = z.object({
  papel: papelSchema,
  // Um link para um aluno é o caso normal; mais de um serve para a turma toda.
  usos: z.number().int().min(1).max(50).default(1),
  /**
   * Quando vem, o convite é endereçado: chega como notificação para a pessoa e
   * só ela aceita. Sem isto, o coach teria de pedir o link por fora — e o link
   * que vaza no grupo da academia traz quem ele não convidou.
   */
  username: z.string().min(3).max(20).optional(),
});

proRouter.post(
  "/convites",
  requirePro("coach", "nutri"),
  rateLimit({ windowMs: 60_000, max: 10, name: "pro-convite" }),
  asyncHandler(async (req, res) => {
    const { papel, usos, username } = novoConviteSchema.parse(req.body);

    let para = null;
    if (username) {
      para = await User.findOne({ username: username.replace(/^@/, "").toLowerCase().trim() });
      if (!para) throw new HttpError(404, "Não achei ninguém com esse nome de usuário.");
    }

    const convite = await gerarConvite(req.user!, papel, usos, para);
    res.status(201).json({
      data: {
        ...convite,
        // Devolve para quem foi, para o painel dizer "enviado para @fulano" em
        // vez de mostrar um código que o coach não precisa copiar.
        enviadoPara: para ? { id: para._id.toString(), nome: para.name, username: para.username } : null,
      },
      meta: {},
    });
  })
);

/** Os convites que ainda valem, para o profissional reenviar ou cancelar. */
proRouter.get(
  "/convites",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const convites = await ProfessionalInvite.find({
      professional: req.user!._id,
      revogadoEm: null,
      expiraEm: { $gt: new Date() },
      usosRestantes: { $gt: 0 },
    })
      .sort({ createdAt: -1 })
      .populate("para", "name username avatarUrl");

    res.json({
      data: convites.map((c) => {
        const destino = c.para as unknown as
          | { _id: mongoose.Types.ObjectId; name: string; username?: string }
          | null;
        return {
          code: c.code,
          papel: c.papel,
          usosRestantes: c.usosRestantes,
          expiraEm: c.expiraEm,
          para: destino
            ? { id: destino._id.toString(), nome: destino.name, username: destino.username ?? null }
            : null,
        };
      }),
      meta: {},
    });
  })
);

proRouter.delete(
  "/convites/:code",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const convite = await ProfessionalInvite.findOne({
      code: String(req.params.code).toUpperCase().trim(),
      professional: req.user!._id,
    });
    if (!convite) throw new HttpError(404, "Convite não encontrado.");

    convite.revogadoEm = new Date();
    await convite.save();
    res.json({ data: { code: convite.code, revogado: true }, meta: {} });
  })
);

/**
 * A lista de alunos — a tela inicial do painel.
 *
 * Traz junto o que o profissional precisa para decidir em quem tocar hoje:
 * quando a pessoa treinou pela última vez e quantas vezes na semana. Sem isso
 * a lista seria só nomes, e ele teria de abrir um por um para descobrir quem
 * sumiu.
 */
proRouter.get(
  "/alunos",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const papel = req.query.papel ? papelSchema.parse(req.query.papel) : undefined;

    const links = await ProfessionalLink.find({
      professional: req.user!._id,
      status: { $ne: "encerrado" },
      ...(papel ? { papel } : {}),
    })
      .sort({ aceitoEm: -1 })
      .populate("client", "name username avatarUrl");

    const semanaAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const data = await Promise.all(
      links.map(async (link) => {
        const cliente = link.client as unknown as {
          _id: mongoose.Types.ObjectId;
          name: string;
          username?: string;
          avatarUrl?: string;
        };

        // Só quem abriu os treinos entra com número; para os outros, a lista
        // mostra o vínculo e diz que não há acesso, em vez de mentir zero.
        const podeTreinos = link.escopo?.treinos === true;
        const [ultimo, naSemana] = podeTreinos
          ? await Promise.all([
              Activity.findOne({ user: cliente._id }).sort({ startedAt: -1 }).select("startedAt"),
              Activity.countDocuments({ user: cliente._id, startedAt: { $gte: semanaAtras } }),
            ])
          : [null, 0];

        return {
          id: link._id.toString(),
          papel: link.papel,
          status: link.status,
          escopo: link.escopo,
          desde: link.aceitoEm,
          aluno: {
            id: cliente._id.toString(),
            nome: cliente.name,
            username: cliente.username ?? null,
            avatarUrl: cliente.avatarUrl ?? "",
          },
          treinos: podeTreinos ? { ultimoEm: ultimo?.startedAt ?? null, naSemana } : null,
        };
      })
    );

    res.json({ data, meta: { total: data.length, limite: limiteDeAlunos(req.user!, papel ?? "coach") } });
  })
);

/**
 * O freio das telas do aluno.
 *
 * São as MESMAS quatro agregações com `$unwind` duplo que o `evolucaoRouter`
 * protege (`routes/evolucao.ts`), e com a janela em "tudo" elas varrem o
 * histórico inteiro sem corte de data. A diferença é que ali a pessoa varre o
 * próprio passado, e aqui um profissional varre o de N alunos — o painel
 * nivelou a superfície de consulta, então precisa nivelar o freio também.
 *
 * O teto é o dobro do lado do aluno porque o uso real é outro: abrir um aluno
 * dispara quatro requisições, e pular entre cinco alunos numa conversa de
 * WhatsApp é uso normal. Sessenta derrubaria o coach fazendo o trabalho dele.
 * Uma tela em laço de recarga, que é o que isto existe para cortar, estoura
 * cento e vinte em segundos do mesmo jeito.
 */
const leituraDoAluno = rateLimit({ windowMs: 60_000, max: 120, name: "pro-aluno" });

/** Janela em dias para as telas do aluno. Zero é "tudo". */
const janelaDoAluno = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().int().min(0).max(3650).default(90)
);

/**
 * O aluno é meu, e ele abriu os treinos?
 *
 * Estava repetido em cada rota do perfil; com quatro cópias, é questão de tempo
 * até uma delas esquecer a checagem de escopo — e aí um profissional veria o
 * que o aluno fechou.
 */
async function alunoComTreinosAbertos(
  req: { user?: { _id: mongoose.Types.ObjectId }; params: Record<string, string> },
  id: string,
  /** Papel PREFERIDO, não filtro: se não houver vínculo dele, devolve o que
   *  houver, para o erro continuar dizendo a verdade a quem é nutri do aluno. */
  preferido?: PapelPro
) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Aluno não encontrado.");

  const clientId = new mongoose.Types.ObjectId(id);
  // Uma consulta só, e a escolha feita aqui: quem acompanha a mesma pessoa como
  // treinador E como nutricionista tem dois vínculos ativos, com escopos
  // diferentes. Pegar "um deles" negava acesso a quem tinha, de forma
  // intermitente — o pior jeito de um bug de permissão aparecer.
  const links = await vinculosAtivos(clientId, req.user!._id);
  const abre = (l: (typeof links)[number]) => l.escopo?.treinos === true;
  const link =
    links.find((l) => l.papel === preferido && abre(l)) ??
    links.find(abre) ??
    links.find((l) => l.papel === preferido) ??
    links[0];

  if (!link) throw new HttpError(404, "Este não é seu aluno.");
  if (!abre(link)) throw new HttpError(403, "Este aluno não abriu os treinos para você.");
  return { link, clientId };
}

/**
 * O aluno por dentro: o que ele autorizou, e nada além.
 *
 * A rota devolve 403 quando o escopo de treinos está fechado, em vez de
 * devolver a página vazia — a diferença entre "não treinou" e "não me deixou
 * ver" é exatamente o que o profissional precisa saber.
 */
proRouter.get(
  "/alunos/:id",
  requirePro("coach", "nutri"),
  leituraDoAluno,
  asyncHandler(async (req, res) => {
    const { link, clientId } = await alunoComTreinosAbertos(req, String(req.params.id));

    const aluno = await User.findById(clientId).select("name username avatarUrl bio");
    if (!aluno) throw new HttpError(404, "Aluno não encontrado.");

    const dias = janelaDoAluno.parse(req.query.dias);

    // O calendário é sempre de um ano, e não da janela escolhida: é o mesmo
    // 365 fixo que o aluno pede em `MinhasAtividadesScreen`, e nivelar é isso.
    // Seguir a janela dava ao coach uma tira de 13 semanas contra o ano inteiro
    // que o aluno vê — e, com a janela em "tudo", um `Math.min(0, 365)` que
    // pedia ZERO dias: calendário vazio justo em quem tem mais histórico.
    const [exercicios, calendario, datas] = await Promise.all([
      exerciciosDoUsuario(clientId, dias),
      calendarioDoUsuario(clientId, 365),
      Activity.find({ user: clientId }).select("startedAt").sort({ startedAt: -1 }).limit(400),
    ]);

    res.json({
      data: {
        aluno: {
          id: aluno._id.toString(),
          nome: aluno.name,
          username: aluno.username ?? null,
          avatarUrl: aluno.avatarUrl ?? "",
          bio: aluno.bio ?? "",
        },
        vinculo: { id: link._id.toString(), papel: link.papel, escopo: link.escopo, desde: link.aceitoEm },
        // A mesma conta de sequência que o aluno vê na Home dele: os dois lados
        // precisam ver o mesmo número, senão a conversa começa com discordância.
        constancia: computeStats(datas.map((a) => ({ date: a.startedAt }))),
        exercicios,
        calendario,
      },
      meta: { dias },
    });
  })
);

/**
 * A curva de um exercício do aluno.
 *
 * Mesma função que responde ao próprio dono em `/evolucao` — o profissional vê
 * o mesmo número que o aluno vê, e não uma segunda versão do cálculo que
 * poderia discordar dele na frente dos dois.
 */
proRouter.get(
  "/alunos/:id/exercicios/:slug",
  requirePro("coach", "nutri"),
  leituraDoAluno,
  asyncHandler(async (req, res) => {
    const { clientId } = await alunoComTreinosAbertos(req, String(req.params.id));

    const dias = janelaDoAluno.parse(req.query.dias);
    const metrica = z.enum(METRICAS).default("carga_max").parse(req.query.metrica);

    const slug = z.string().min(1).max(80).parse(req.params.slug);
    const pontos = await serieDoExercicio(clientId, slug, dias, metrica);
    res.json({ data: pontos, meta: { dias, metrica, slug } });
  })
);

/**
 * Séries por grupo muscular do aluno — os eixos do radar.
 *
 * Mesma função que responde ao próprio dono em `/evolucao/grupos`: o coach vê
 * o mesmo número que o aluno vê, e não uma segunda versão do cálculo que
 * poderia discordar dele na frente dos dois.
 */
proRouter.get(
  "/alunos/:id/grupos",
  requirePro("coach", "nutri"),
  leituraDoAluno,
  asyncHandler(async (req, res) => {
    const { link, clientId } = await alunoComTreinosAbertos(req, String(req.params.id));
    void link;

    const dias = janelaDoAluno.parse(req.query.dias);
    res.json({ data: await gruposDoUsuario(clientId, dias), meta: { dias } });
  })
);

const conquistasDoAlunoSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});

/**
 * O histórico de recordes do aluno.
 *
 * É o que transforma "ele está evoluindo" em uma data e um número: o coach vê
 * quando cada marca caiu, e o que ela superou.
 *
 * Pagina por cursor, igual a `GET /prs/historico`, que é a mesma lista do lado
 * do aluno: é lista que só cresce, e parar nas 100 mais recentes sem ter como
 * pedir a próxima página deixaria o coach sem o começo da história — justo no
 * aluno antigo, que é onde há mais o que ler.
 */
proRouter.get(
  "/alunos/:id/conquistas",
  requirePro("coach", "nutri"),
  leituraDoAluno,
  asyncHandler(async (req, res) => {
    const { clientId } = await alunoComTreinosAbertos(req, String(req.params.id));

    const { limit, cursor: bruto } = conquistasDoAlunoSchema.parse(req.query);
    const cursor = bruto ? decodeCursor(bruto) : null;

    const filtro: mongoose.FilterQuery<unknown> = { user: clientId };
    if (cursor) {
      // Keyset por (achievedAt desc, _id desc), o mesmo de `/prs/historico`: o
      // `_id` desempata as conquistas do mesmo instante, que acontecem sempre
      // — um treino bate carga máxima e 1RM estimado na mesma hora.
      filtro.$or = [
        { achievedAt: { $lt: cursor.startedAt } },
        { achievedAt: cursor.startedAt, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
      ];
    }

    const docs = await PersonalRecordEvent.find(filtro)
      .sort({ achievedAt: -1, _id: -1 })
      .limit(limit + 1);

    const temMais = docs.length > limit;
    const eventos = temMais ? docs.slice(0, limit) : docs;
    const ultimo = eventos[eventos.length - 1];
    const nextCursor =
      temMais && ultimo
        ? encodeCursor({ startedAt: ultimo.achievedAt as Date, id: ultimo._id.toString() })
        : null;

    res.json({
      data: eventos.map((e) => ({
        id: e._id.toString(),
        sportId: e.sportId,
        exerciseName: e.exerciseName,
        exerciseSlug: e.exerciseSlug,
        type: e.type,
        repRange: e.repRange ?? null,
        value: e.value,
        previousValue: e.previousValue,
        unit: e.unit,
        achievedAt: e.achievedAt,
      })),
      meta: { nextCursor },
    });
  })
);

/** O profissional dispensa um aluno. */
proRouter.delete(
  "/alunos/:linkId",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const link = await encerrarVinculo(req.user!, String(req.params.linkId));
    res.json({ data: { id: link._id.toString(), status: link.status }, meta: {} });
  })
);

// ----------------------------------------------------------------------- aluno

/**
 * Os convites endereçados a mim que ainda valem.
 *
 * É o que faz o convite por @ chegar de verdade: a notificação avisa, e esta
 * lista é onde a pessoa encontra o convite depois — inclusive dias depois, se
 * ela tiver deslizado a notificação sem ler.
 */
proRouter.get(
  "/convites-recebidos",
  asyncHandler(async (req, res) => {
    const convites = await ProfessionalInvite.find({
      para: req.user!._id,
      revogadoEm: null,
      expiraEm: { $gt: new Date() },
      usosRestantes: { $gt: 0 },
    })
      .sort({ createdAt: -1 })
      .populate("professional", "name username avatarUrl");

    // Quem já é acompanhado não precisa ver o convite de novo.
    const jaVinculados = new Set(
      (
        await ProfessionalLink.find({ client: req.user!._id, status: { $ne: "encerrado" } }).select(
          "professional papel"
        )
      ).map((l) => `${l.professional}|${l.papel}`)
    );

    const data = convites
      .filter((c) => !jaVinculados.has(`${(c.professional as unknown as { _id: mongoose.Types.ObjectId })._id}|${c.papel}`))
      .map((c) => {
        const p = c.professional as unknown as {
          _id: mongoose.Types.ObjectId;
          name: string;
          username?: string;
          avatarUrl?: string;
        };
        return {
          code: c.code,
          papel: c.papel,
          expiraEm: c.expiraEm,
          profissional: {
            id: p._id.toString(),
            nome: p.name,
            username: p.username ?? null,
            avatarUrl: p.avatarUrl ?? "",
          },
        };
      });

    res.json({ data, meta: { total: data.length } });
  })
);

/**
 * Tudo que o acompanhamento está esperando de mim, numa requisição só.
 *
 * A Home consultava três rotas para desenhar um card que quase sempre não
 * aparece — e, para o card surgir sozinho sem recarregar a página, essas três
 * teriam de se repetir a cada ciclo. Juntas numa só, o custo de perguntar
 * "tem algo novo?" cabe num intervalo curto.
 *
 * Devolve o mínimo para desenhar: quem convidou, quantas mensagens, e o id
 * para abrir. Nada de conteúdo de mensagem — isso é da tela da conversa.
 */
proRouter.get(
  "/avisos",
  asyncHandler(async (req, res) => {
    const eu = req.user!._id;
    const agora = new Date();

    const [convites, links] = await Promise.all([
      ProfessionalInvite.find({
        para: eu,
        revogadoEm: null,
        expiraEm: { $gt: agora },
        usosRestantes: { $gt: 0 },
      })
        .sort({ createdAt: -1 })
        .populate("professional", "name username avatarUrl"),
      ProfessionalLink.find({ client: eu, status: { $ne: "encerrado" } }).populate(
        "professional",
        "name username avatarUrl"
      ),
    ]);

    type Pessoa = {
      _id: mongoose.Types.ObjectId;
      name: string;
      username?: string;
      avatarUrl?: string;
    };
    const comoPessoa = (p: unknown) => {
      const x = p as Pessoa;
      return {
        id: x._id.toString(),
        nome: x.name,
        username: x.username ?? null,
        avatarUrl: x.avatarUrl ?? "",
      };
    };

    // Quem já é acompanhado não precisa ver o convite de novo.
    const jaVinculados = new Set(links.map((l) => `${l.professional._id ?? l.professional}|${l.papel}`));

    const naoLidas = await ProMessage.aggregate<{ _id: mongoose.Types.ObjectId; total: number }>([
      { $match: { link: { $in: links.map((l) => l._id) }, autor: { $ne: eu }, lidaEm: null } },
      { $group: { _id: "$link", total: { $sum: 1 } } },
    ]);
    const porLink = new Map(naoLidas.map((n) => [n._id.toString(), n.total]));

    res.json({
      data: {
        convites: convites
          .filter((c) => !jaVinculados.has(`${(c.professional as unknown as Pessoa)._id}|${c.papel}`))
          .map((c) => ({
            code: c.code,
            papel: c.papel,
            expiraEm: c.expiraEm,
            profissional: comoPessoa(c.professional),
          })),
        conversas: links
          .filter((l) => (porLink.get(l._id.toString()) ?? 0) > 0)
          .map((l) => ({
            id: l._id.toString(),
            naoLidas: porLink.get(l._id.toString()) ?? 0,
            profissional: comoPessoa(l.professional),
          })),
      },
      meta: {},
    });
  })
);

/** O que o convite é, antes de aceitar. Só exige estar logado. */
proRouter.get(
  "/convites/:code",
  asyncHandler(async (req, res) => {
    const preview = await verConvite(String(req.params.code), req.user!._id);
    res.json({ data: preview, meta: {} });
  })
);

proRouter.post(
  "/convites/:code/aceitar",
  rateLimit({ windowMs: 60_000, max: 20, name: "pro-aceitar" }),
  asyncHandler(async (req, res) => {
    const escopo = escopoSchema.parse(req.body ?? {});
    const link = await aceitarConvite(req.user!, String(req.params.code), escopo);
    res.status(201).json({
      data: { id: link._id.toString(), papel: link.papel, escopo: link.escopo, status: link.status },
      meta: {},
    });
  })
);

/** Quem me acompanha — a tela onde o aluno vê e controla os acessos. */
proRouter.get(
  "/acompanhamentos",
  asyncHandler(async (req, res) => {
    const links = await ProfessionalLink.find({ client: req.user!._id, status: { $ne: "encerrado" } })
      .sort({ aceitoEm: -1 })
      .populate("professional", "name username avatarUrl");

    res.json({
      data: links.map((l) => {
        const p = l.professional as unknown as {
          _id: mongoose.Types.ObjectId;
          name: string;
          username?: string;
          avatarUrl?: string;
        };
        return {
          id: l._id.toString(),
          papel: l.papel as PapelPro,
          escopo: l.escopo,
          desde: l.aceitoEm,
          profissional: {
            id: p._id.toString(),
            nome: p.name,
            username: p.username ?? null,
            avatarUrl: p.avatarUrl ?? "",
          },
        };
      }),
      meta: {},
    });
  })
);

/** O aluno muda o que está aberto. */
proRouter.patch(
  "/acompanhamentos/:id",
  asyncHandler(async (req, res) => {
    const escopo = escopoSchema.parse(req.body ?? {});
    const link = await ajustarEscopo(req.user!, String(req.params.id), escopo);
    res.json({ data: { id: link._id.toString(), escopo: link.escopo }, meta: {} });
  })
);

/** O aluno sai. */
proRouter.delete(
  "/acompanhamentos/:id",
  asyncHandler(async (req, res) => {
    const link = await encerrarVinculo(req.user!, String(req.params.id));
    res.json({ data: { id: link._id.toString(), status: link.status }, meta: {} });
  })
);

// ------------------------------------------------------------- prescrição

const prescricaoSchema = z.object({
  summary: z.string().min(1).max(500),
  workout: workoutSchema,
});

/**
 * O coach prescreve o treino do aluno.
 *
 * Reusa o `Plan`, que já é versionado e já aparece na Home do aluno — o que
 * faltava era o autor poder ser outra pessoa. Até aqui todo plano era
 * auto-atribuído, e o jeito de receber treino de um profissional era colar o
 * texto dele em `POST /plans/import`: o remendo que esta rota substitui.
 *
 * Grava uma VERSÃO NOVA em vez de editar a atual. O histórico de treino
 * prescrito é o registro do trabalho do coach, e `Activity.planLink` aponta
 * para o número da versão — reescrever a versão corrente faria o treino que a
 * pessoa já executou passar a dizer que era outro.
 *
 * Não toca na dieta: ela é metade independente do plano e, quando existe, é do
 * nutricionista ou da IA. Prescrever treino não é motivo para apagar comida.
 */
proRouter.put(
  "/alunos/:id/treino",
  requirePro("coach"),
  asyncHandler(async (req, res) => {
    const { link, clientId } = await alunoComTreinosAbertos(req, String(req.params.id), "coach");
    // Quem prescreve treino é o coach: o papel diz o que a pessoa faz, e não
    // só em quem ela toca. O `"coach"` acima é o que garante que quem acompanha
    // o mesmo aluno nos dois papéis caia no vínculo certo — e não leve um 403
    // dizendo que ele não é o treinador de quem ele treina.
    if (link.papel !== "coach") throw new HttpError(403, "Só o treinador prescreve treino.");

    const { summary, workout } = prescricaoSchema.parse(req.body);

    const atual = await Plan.findOne({ user: clientId }).sort({ version: -1 });
    const plan = await Plan.create({
      user: clientId,
      version: (atual?.version ?? 0) + 1,
      summary,
      workout,
      // A dieta corrente é preservada: o plano tem duas metades independentes.
      diet: atual?.diet ?? null,
      disclaimer: atual?.disclaimer ?? DISCLAIMER_DO_COACH,
      createdBy: req.user!._id,
    });

    res.status(201).json({
      data: { id: plan._id.toString(), version: plan.version, createdBy: req.user!._id.toString() },
      meta: {},
    });
  })
);

// ------------------------------------------------------------------ conversa

const novaMensagemSchema = z
  .object({
    texto: z.string().max(2000).optional(),
    imageUrl: z.string().max(500).optional(),
    imageWidth: z.number().int().positive().max(10000).optional(),
    imageHeight: z.number().int().positive().max(10000).optional(),
  })
  // Mensagem vazia não é mensagem. Uma das duas coisas precisa vir.
  .refine((m) => Boolean(m.texto?.trim()) || Boolean(m.imageUrl), {
    message: "Escreva algo ou anexe uma foto.",
  });

/**
 * O acompanhamento visto por quem participa dele, seja qual for o lado.
 *
 * As duas pontas usam a mesma rota de propósito: a conversa é uma só, e ter
 * uma rota para o coach e outra para o aluno seria duplicar a regra de quem
 * pode ler — que é o tipo de duplicação que acaba discordando de si mesma.
 */
async function conversaDoParticipante(req: { user?: { _id: mongoose.Types.ObjectId } }, linkId: string) {
  if (!mongoose.isValidObjectId(linkId)) throw new HttpError(404, "Acompanhamento não encontrado.");

  const link = await ProfessionalLink.findById(linkId);
  if (!link) throw new HttpError(404, "Acompanhamento não encontrado.");

  const eu = req.user!._id;
  if (!link.client.equals(eu) && !link.professional.equals(eu)) {
    throw new HttpError(404, "Acompanhamento não encontrado.");
  }
  // Encerrado, a conversa fica legível mas fechada para escrita — o histórico
  // é dos dois, e apagá-lo seria apagar o acompanhamento que existiu.
  return link;
}

/** Histórico da conversa, do mais recente para trás, paginado por cursor. */
proRouter.get(
  "/acompanhamentos/:id/mensagens",
  asyncHandler(async (req, res) => {
    const link = await conversaDoParticipante(req, String(req.params.id));
    const { limit, cursor: raw } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().optional() })
      .parse(req.query);

    const cursor = raw ? decodeCursorCriacao(raw) : null;
    const filtro: mongoose.FilterQuery<unknown> = { link: link._id };
    if (cursor) {
      filtro.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
      ];
    }

    const docs = await ProMessage.find(filtro).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
    const temMais = docs.length > limit;
    const itens = temMais ? docs.slice(0, limit) : docs;
    const ultimo = itens[itens.length - 1];

    // Abrir a conversa marca como lida o que o OUTRO mandou. Só isso: marcar as
    // próprias seria dizer que a pessoa leu o que ela mesma escreveu.
    await ProMessage.updateMany(
      { link: link._id, autor: { $ne: req.user!._id }, lidaEm: null },
      { $set: { lidaEm: new Date() } }
    );

    res.json({
      data: itens.map((m) => ({
        id: m._id.toString(),
        autor: m.autor.toString(),
        texto: m.texto,
        imageUrl: m.imageUrl || null,
        imageWidth: m.imageWidth ?? null,
        imageHeight: m.imageHeight ?? null,
        lidaEm: m.lidaEm,
        createdAt: m.get("createdAt") as Date,
      })),
      meta: {
        nextCursor:
          temMais && ultimo
            ? encodeCursorCriacao({ createdAt: ultimo.get("createdAt") as Date, id: ultimo._id.toString() })
            : null,
        encerrado: link.status === "encerrado",
      },
    });
  })
);

proRouter.post(
  "/acompanhamentos/:id/mensagens",
  rateLimit({ windowMs: 60_000, max: 40, name: "pro-mensagem" }),
  asyncHandler(async (req, res) => {
    const link = await conversaDoParticipante(req, String(req.params.id));
    if (link.status === "encerrado") {
      throw new HttpError(409, "Este acompanhamento foi encerrado.");
    }

    const body = novaMensagemSchema.parse(req.body ?? {});
    const msg = await ProMessage.create({
      link: link._id,
      autor: req.user!._id,
      texto: body.texto?.trim() ?? "",
      imageUrl: body.imageUrl ?? "",
      imageWidth: body.imageWidth ?? null,
      imageHeight: body.imageHeight ?? null,
    });

    // Avisa o outro lado. Depois da resposta e sem `await` no caminho quente:
    // push é best-effort, e uma falha da Expo não pode fazer uma mensagem já
    // gravada parecer que não foi enviada.
    const destinatario = link.client.equals(req.user!._id) ? link.professional : link.client;
    void enviarPush(destinatario, "mensagem_pro", {
      title: req.user!.name,
      body: body.texto?.trim() || "Mandou uma foto",
      data: { tipo: "mensagem_pro", link: link._id.toString() },
    });

    res.status(201).json({
      data: {
        id: msg._id.toString(),
        autor: msg.autor.toString(),
        texto: msg.texto,
        imageUrl: msg.imageUrl || null,
        createdAt: msg.get("createdAt") as Date,
      },
      meta: {},
    });
  })
);

/** Quantas mensagens não lidas em cada acompanhamento — a bolinha da lista. */
proRouter.get(
  "/nao-lidas",
  asyncHandler(async (req, res) => {
    const eu = req.user!._id;
    const links = await ProfessionalLink.find({
      $or: [{ client: eu }, { professional: eu }],
      status: { $ne: "encerrado" },
    }).select("_id");

    const porLink = await ProMessage.aggregate<{ _id: mongoose.Types.ObjectId; total: number }>([
      { $match: { link: { $in: links.map((l) => l._id) }, autor: { $ne: eu }, lidaEm: null } },
      { $group: { _id: "$link", total: { $sum: 1 } } },
    ]);

    res.json({
      data: porLink.map((l) => ({ link: l._id.toString(), naoLidas: l.total })),
      meta: { total: porLink.reduce((s, l) => s + l.total, 0) },
    });
  })
);
