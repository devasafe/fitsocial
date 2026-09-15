import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { temProfissional } from "../services/vinculos.js";
import { calcularPlan } from "../services/entitlement.js";
import { Profile, profileDataSchema } from "../models/Profile.js";
import {
  Plan,
  workoutSchema,
  dietSchema,
  DISCLAIMER_PROPRIO,
  type WorkoutData,
  type SessionData,
} from "../models/Plan.js";
import {
  preservarAgenda,
  montarPlanoDoDia,
  aplicarAgenda,
  sessoesSemDia,
  normalizarWeekdays,
  atribuirDias,
} from "../services/agendaDeTreino.js";
import { sessaoDeAtividade, nomeUnicoDeSessao } from "../services/sessaoDoPlano.js";
import { diaDaSemana, chaveDoDia, FUSO } from "../utils/dia.js";
import { Activity } from "../models/Activity.js";
import { strengthPayloadSchema } from "../models/strength.js";
import { generateDiet, generatePlan, adjustPlan, importPlanFromText } from "../services/ai/planGenerator.js";
import { buildAdherenceSummary } from "../services/adherence.js";
import { backfillWorkoutKinds } from "../services/exerciseKind.js";
import { z } from "zod";

export const plansRouter = Router();

type AutorCru = {
  _id?: mongoose.Types.ObjectId;
  name?: string;
  username?: string;
  avatarUrl?: string;
};

/**
 * O id de quem escreveu o plano — populado ou não.
 *
 * `createdBy` é ObjectId na maioria das rotas e documento em `/current`, que
 * popula. `String(objectId)` e `String(doc)` dariam coisas diferentes, e este
 * campo já é contrato: quem lê espera um id, sempre.
 */
function idDoAutor(plan: InstanceType<typeof Plan>): string | null {
  const cru = plan.createdBy as unknown;
  if (!cru) return null;
  const doc = cru as AutorCru;
  return String(doc._id ?? cru);
}

/** O autor com nome, só onde a rota populou. Nulo quando não populou. */
function autorDoPlano(
  plan: InstanceType<typeof Plan>
): { id: string; nome: string; username: string | null; avatarUrl: string } | null {
  const cru = plan.createdBy as unknown;
  if (!cru) return null;

  const doc = cru as AutorCru;
  if (doc.name === undefined) return null;

  return {
    id: String(doc._id ?? cru),
    nome: doc.name,
    username: doc.username ?? null,
    avatarUrl: doc.avatarUrl ?? "",
  };
}

function serializePlan(plan: InstanceType<typeof Plan>) {
  const raw = plan.workout as {
    sessions: { exercises: { name: string; reps: string; kind?: "strength" | "cardio" }[] }[];
  } | null;
  // Clona antes de repassar para backfillWorkoutKinds (que muta in place), para nunca
  // escrever "kind" de volta no documento Mongoose (Mixed) hidratado.
  //
  // `raw` pode ser nulo: quem só gerou dieta não tem treino, e antes isto
  // estourava aqui em vez de devolver um plano com metade preenchida.
  const workout = raw
    ? backfillWorkoutKinds({
        ...raw,
        sessions: raw.sessions.map((s) => ({ ...s, exercises: s.exercises.map((e) => ({ ...e })) })),
      })
    : null;
  // Metade que falta sai como FORMA VAZIA, não como null.
  //
  // O app instalado faz `plan.workout.sessions.map(...)` sem guarda: um null
  // ali fecha o app na abertura, e o sintoma ("crashou ao abrir") não aponta
  // para "alguém zerou o treino em outro lugar". O app novo distingue por
  // `sessions.length`, que funciona nos dois casos.
  const treinoVazio = { split: "", daysPerWeek: 0, sessions: [] };
  const dietaVazia = {
    dailyCalories: 0,
    macros: { proteinG: 0, carbsG: 0, fatG: 0 },
    meals: [],
    notes: "",
  };

  return {
    id: plan._id.toString(),
    version: plan.version,
    summary: plan.summary,
    workout: workout ?? treinoVazio,
    diet: plan.diet ?? dietaVazia,
    disclaimer: plan.disclaimer,
    // Quem escreveu, quando não foi o dono. O app mostra "prescrito pelo seu
    // coach" em vez de deixar a pessoa achar que a IA mudou o treino sozinha.
    //
    // Vem nas duas formas porque nem toda rota popula: `createdBy` é sempre o
    // id, e `autor` só existe onde o nome foi buscado.
    createdBy: idDoAutor(plan),
    autor: autorDoPlano(plan),
    createdAt: plan.get("createdAt") as Date,
  };
}

/**
 * Quem tem treinador não recebe treino da IA.
 *
 * Não é gate de plano pago nem de permissão: é de AUTORIA. A IA escreveria uma
 * versão nova por cima da prescrição, sem avisar ninguém, e a pessoa passaria a
 * seguir um treino que o coach dela nunca viu — enquanto o coach continuaria
 * olhando no painel o que ele mesmo escreveu. Os dois achariam que estão
 * falando do mesmo treino.
 *
 * A dieta não entra aqui: quem responde por ela é o nutricionista, e o vínculo
 * dele é outro. `POST /plans/diet` continua aberto para quem tem só treinador.
 *
 * Vale para TODA porta que mexe no treino, e não só para a IA: gerar, reajustar,
 * importar de um texto, editar à mão e apagar chegam todas ao mesmo lugar — o
 * treino que o profissional assinou deixa de ser o que ele escreveu, sem que
 * ele saiba. Fechar só a IA seria trancar uma porta e deixar quatro abertas.
 */
async function recusarSeTemTreinador(userId: mongoose.Types.ObjectId): Promise<void> {
  if (await temProfissional(userId, "coach")) {
    throw new HttpError(
      409,
      "Quem escreve o seu treino é o seu treinador. Fale com ele pelo acompanhamento para mudar o plano."
    );
  }
}

/**
 * Apagar é diferente de reescrever: o que não pode sumir é a PRESCRIÇÃO.
 *
 * Quem já tinha um plano da IA e depois contratou um treinador ficaria preso a
 * ele até a primeira prescrição chegar — sem poder zerar, sem poder gerar
 * outro. Um plano que ninguém assinou pode ser jogado fora por quem o pediu; o
 * que o profissional escreveu, não.
 */
async function recusarSeForDoTreinador(userId: mongoose.Types.ObjectId): Promise<void> {
  const atual = await Plan.findOne({ user: userId }).sort({ version: -1 }).select("createdBy");
  if (atual?.createdBy) await recusarSeTemTreinador(userId);
}

// Gera um novo plano a partir da ficha do usuário e o salva como nova versão.
// Geração é cara (IA); limite baixo por minuto.
const generateLimiter = rateLimit({ windowMs: 60_000, max: 5, name: "plan-generate" });

plansRouter.post(
  "/generate",
  requireAuth,
  generateLimiter,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    await recusarSeTemTreinador(user._id);

    const profileDoc = await Profile.findOne({ user: user._id });
    if (!profileDoc) {
      throw new HttpError(409, "Conclua o onboarding antes de gerar um plano");
    }

    const last = await Plan.findOne({ user: user._id }).sort({ version: -1 });

    // Gating do freemium: grátis pode gerar o 1º plano; regenerar é premium.
    if (last && user.tier !== "premium") {
      throw new HttpError(
        402,
        "Gerar um novo plano é um recurso Premium. Assine para ter planos ilimitados."
      );
    }

    // Revalida a ficha antes de mandar para a IA.
    const profile = profileDataSchema.parse(profileDoc.toObject());
    const data = await generatePlan(profile, user._id.toString());

    const plan = await Plan.create({
      user: user._id,
      version: (last?.version ?? 0) + 1,
      ...data,
      // "Plano novo, nada a preservar" só vale para a PRIMEIRA geração. O gate
      // acima deixa passar exatamente o contrário: premium regenerando por
      // cima de um plano que já existe — e aí os dias que a pessoa escolheu
      // sumiriam sem ninguém ligar o sumiço ao botão de gerar. Quando não há
      // agenda anterior isto é no-op.
      workout: preservarAgenda(last?.workout as WorkoutData | null, data.workout),
    });

    res.status(201).json({ plan: serializePlan(plan) });
  })
);

// Reajusta o plano com base na adesão (treinos feitos + cargas). Premium.
plansRouter.post(
  "/adjust",
  requireAuth,
  generateLimiter,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    await recusarSeTemTreinador(user._id);

    if (user.tier !== "premium") {
      throw new HttpError(
        402,
        "O reajuste do plano pelo coach é um recurso Premium. Assine para o coach acompanhar sua evolução."
      );
    }

    const profileDoc = await Profile.findOne({ user: user._id });
    const current = await Plan.findOne({ user: user._id }).sort({ version: -1 });
    if (!profileDoc || !current) {
      throw new HttpError(409, "Gere um plano inicial antes de pedir um reajuste");
    }

    const profile = profileDataSchema.parse(profileDoc.toObject());
    const currentData = {
      summary: current.summary,
      workout: current.workout,
      diet: current.diet,
      disclaimer: current.disclaimer,
    } as Parameters<typeof adjustPlan>[1];

    const activities = await Activity.find({ user: user._id }).sort({ startedAt: -1 }).limit(40);
    const adherence = buildAdherenceSummary(activities, currentData);

    const data = await adjustPlan(profile, currentData, adherence, user._id.toString());
    const plan = await Plan.create({
      user: user._id,
      version: current.version + 1,
      ...data,
      // A IA reescreve o treino inteiro e não sabe de agenda. Este é o
      // escritor mais traiçoeiro dos três: não parece um escritor de workout.
      workout: preservarAgenda(current.workout as WorkoutData | null, data.workout),
    });

    res.status(201).json({ plan: serializePlan(plan) });
  })
);

// Importa o plano pessoal do usuário (feito por um profissional) a partir de texto.
const importSchema = z.object({ text: z.string().min(10, "Cole o texto do seu plano").max(8000) });

plansRouter.post(
  "/import",
  requireAuth,
  generateLimiter,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    await recusarSeTemTreinador(user._id);

    // O mesmo gate do `/generate`: importar é a IA ESCREVENDO um plano novo, a
    // partir de um texto, e custa uma chamada de modelo igual à geração. Esta
    // rota estava aberta — era o caminho por onde uma conta grátis criava
    // plano sem limite nenhum, furando a regra de que a IA só monta o primeiro.
    const jaTem = await Plan.findOne({ user: user._id }).sort({ version: -1 });
    if (jaTem && calcularPlan(user) === "free") {
      throw new HttpError(
        402,
        "Importar outro plano é um recurso Pro. Assine para trocar de plano quando quiser."
      );
    }

    const { text } = importSchema.parse(req.body);

    const profileDoc = await Profile.findOne({ user: user._id });
    const profile = profileDoc ? profileDataSchema.parse(profileDoc.toObject()) : null;

    const data = await importPlanFromText(text, profile, user._id.toString());

    const last = await Plan.findOne({ user: user._id }).sort({ version: -1 });
    const plan = await Plan.create({
      user: user._id,
      version: (last?.version ?? 0) + 1,
      ...data,
      // Pelo mesmo motivo do `/generate`: quem é Pro reimporta por cima de um
      // plano existente. Como o casamento é por nome exato de sessão, um texto
      // de verdade diferente não herda nada — só o reimport do mesmo plano.
      workout: preservarAgenda(last?.workout as WorkoutData | null, data.workout),
    });

    res.status(201).json({ plan: serializePlan(plan) });
  })
);

// Edição MANUAL do plano (treino e/ou dieta) — in place, mantém a versão.
// Cada metade é opcional: editar a dieta não pode exigir mandar o treino junto
// — e quem não tem treino não teria o que mandar.
const updatePlanSchema = z.object({
  summary: z.string().max(2000).optional(),
  workout: workoutSchema.optional(),
  diet: dietSchema.optional(),
});

plansRouter.put(
  "/current",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = updatePlanSchema.parse(req.body);
    // Só quando a edição TOCA no treino: mexer na dieta continua livre para
    // quem tem treinador e não tem nutricionista.
    if (body.workout !== undefined) await recusarSeTemTreinador(req.user!._id);

    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    if (!plan) throw new HttpError(404, "Nenhum plano para editar");

    if (body.workout !== undefined) {
      // O cliente pode não conhecer `weekdays` — o APK instalado não conhece.
      // Sem isto, editar a ficha por ele apagaria a agenda em silêncio.
      plan.workout = preservarAgenda(plan.workout as WorkoutData | null, body.workout);
      plan.markModified("workout");
    }
    if (body.diet !== undefined) {
      plan.diet = body.diet;
      plan.markModified("diet");
    }
    if (body.summary !== undefined) plan.summary = body.summary;
    await plan.save();

    res.json({ plan: serializePlan(plan) });
  })
);

// ------------------------------------------------------------ plano por dia

/**
 * A sessão como a tela de executar precisa dela: com os exercícios inteiros e
 * com `kind` preenchido, igual ao que `serializePlan` entrega.
 *
 * O clone existe pelo mesmo motivo de lá: `backfillWorkoutKinds` muta in place,
 * e escrever `kind` de volta num `Mixed` hidratado gravaria no documento.
 */
function sessaoCompleta(s: SessionData) {
  const clone = { ...s, exercises: s.exercises.map((e) => ({ ...e })) };
  backfillWorkoutKinds({ sessions: [clone] });
  return { ...clone, weekdays: normalizarWeekdays(s.weekdays) };
}

/**
 * O treino de hoje.
 *
 * Rota nova em vez de um bloco a mais no `GET /plans/current`: aquela é a rota
 * mais chamada pelo APK instalado e está no envelope legado `{ plan }`. Mexer
 * nela seria trocar o envelope (quebra) ou misturar dois padrões no mesmo
 * corpo. Aqui vale o `{ data, meta }` de endpoint novo.
 *
 * `data.estado` é o campo que o app lê: um `switch` num discriminante só, em
 * vez de inferir o estado do cruzamento de três nulos.
 */
plansRouter.get(
  "/hoje",
  requireAuth,
  asyncHandler(async (req, res) => {
    const hoje = diaDaSemana();

    // `?dia=` serve para ESPIAR a semana ("o que é quinta?"), nunca para dizer
    // que dia é hoje — quem diz isso é o relógio do servidor.
    //
    // Validado como TEXTO antes de virar número: `z.coerce.number()` é
    // `Number(x)`, e `Number("") === 0`. Com a coerção crua, `?dia=` devolvia o
    // treino de domingo em silêncio, numa terça, sem erro nenhum.
    let alvo = hoje;
    if (req.query.dia !== undefined) {
      const lido = z
        .string()
        .regex(/^[0-6]$/)
        .safeParse(req.query.dia);
      if (!lido.success) {
        throw new HttpError(400, "Dia da semana inválido. Use 0 (domingo) a 6 (sábado).");
      }
      alvo = Number(lido.data);
    }

    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    const workout = (plan?.workout ?? null) as WorkoutData | null;
    const dia = montarPlanoDoDia(workout, alvo, sessaoCompleta);

    res.json({
      data: { ...dia, diaDaSemana: alvo, planVersion: plan?.version ?? null },
      meta: {
        fuso: FUSO,
        hoje: chaveDoDia(),
        diaDaSemana: hoje,
        naoAgendadas: sessoesSemDia(workout),
        // Quem tem treinador não acrescenta sessão à prescrição. O app esconde o
        // botão com isto, em vez de deixar a pessoa digitar e tomar 409 no fim.
        podeEditarPlano: !(await temProfissional(req.user!._id, "coach")),
        programacao: req.user!.get("settings.programacao") ?? null,
      },
    });
  })
);

/** Substituição TOTAL da agenda: a tela edita a grade inteira de uma vez. */
const agendaSchema = z.object({
  /** A versão que a tela leu. Lock otimista barato contra editar plano velho. */
  versao: z.number().int().min(1).optional(),
  agenda: z
    .array(
      z.object({
        indice: z.number().int().min(0),
        /**
         * O nome da sessão como a tela o leu.
         *
         * `versao` sozinha não basta: `PUT /plans/current` edita o treino IN
         * PLACE e não incrementa a versão. Quem abrisse "mudar meus dias",
         * apagasse uma sessão no editor e voltasse para salvar a grade não
         * tomaria 409 nenhum — os índices já teriam deslizado, e os dias
         * cairiam nas sessões erradas em silêncio.
         */
        day: z.string().max(200).optional(),
        weekdays: z.array(z.number().int().min(0).max(6)).max(7),
      })
    )
    // Teto acima do que `workoutSchema` permite na prática, para a grade
    // inteira caber sempre: recusar a tela por tamanho seria trancar a pessoa
    // fora da própria agenda.
    .max(40)
    // Índice repetido não é a grade inteira — é a mesma sessão duas vezes, e
    // uma das duas seria descartada em silêncio pelo Map logo abaixo.
    .refine((itens) => new Set(itens.map((i) => i.indice)).size === itens.length, {
      message: "Cada treino aparece uma vez só na grade.",
    }),
});

/**
 * Em que dias você treina — a tela de encaixe.
 *
 * A regra vive em `aplicarAgenda`; aqui ficam só a validação, a busca e a
 * escrita. Esta rota NÃO chama `recusarSeTemTreinador`, e é de propósito: a
 * guarda existe por AUTORIA — a IA reescrevendo a prescrição sem o coach saber.
 * Em que dias eu faço as sessões que o coach escreveu não é autoria, é a minha
 * agenda; bloquear deixaria todo aluno com treinador preso em `sem_agenda` para
 * sempre, justamente quem paga. A contrapartida é que a prescrição não pode
 * atropelar a agenda — e é o que `preservarAgenda` faz em `pro.ts`.
 */
plansRouter.put(
  "/current/agenda",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = agendaSchema.parse(req.body);

    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    const workout = (plan?.workout ?? null) as WorkoutData | null;
    if (!plan || !workout?.sessions?.length) {
      throw new HttpError(404, "Você ainda não tem um treino para agendar");
    }
    if (body.versao !== undefined && body.versao !== plan.version) {
      throw new HttpError(409, "Seu plano mudou. Abra de novo para escolher os dias.");
    }

    const { sessions, diasOcupados } = aplicarAgenda(workout, body.agenda);
    plan.workout = {
      ...workout,
      sessions,
      // `daysPerWeek` NÃO é recalculado aqui. Ele é a intenção da ficha e o
      // denominador da adesão (`services/adherence.ts`); reescrevê-lo como
      // efeito colateral de arrastar um treino mudaria a métrica em silêncio.
    };
    plan.markModified("workout");
    await plan.save();

    res.json({
      data: { plan: serializePlan(plan) },
      meta: { diasOcupados, naoAgendadas: sessoesSemDia(plan.workout as WorkoutData) },
    });
  })
);

const novaSessaoSchema = z.object({
  /** O treino já salvo que vira sessão. Mandar o id, e não os exercícios de
   *  novo: duas fontes para a mesma coisa acabam discordando. */
  activityId: z.string(),
  /** Mesmo lock otimista da rota irmã — sem ele, dois toques no botão viram
   *  duas sessões (ou dois planos versão 1, quando ainda não havia plano). */
  versao: z.number().int().min(1).optional(),
  day: z.string().max(120).optional(),
  focus: z.string().max(120).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
});

/**
 * "Quer adicionar este treino ao plano?" — o sim.
 *
 * Aqui `recusarSeTemTreinador` VALE: acrescentar sessão é escrever na
 * prescrição, e isso é autoria. (Diferente de escolher os dias, logo acima.)
 */
plansRouter.post(
  "/current/sessoes",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    await recusarSeTemTreinador(user._id);

    const body = novaSessaoSchema.parse(req.body);
    if (!mongoose.isValidObjectId(body.activityId)) throw new HttpError(400, "ID inválido");

    const atividade = await Activity.findById(body.activityId);
    // 404 e não 403 para atividade de outra pessoa: quem não pode ver não
    // precisa descobrir que ela existe.
    if (!atividade || atividade.user.toString() !== user._id.toString()) {
      throw new HttpError(404, "Treino não encontrado");
    }
    if (atividade.kind !== "strength") {
      throw new HttpError(400, "Por enquanto só treino de musculação vira sessão do plano.");
    }

    // `safeParse`, e não `parse`: isto valida dado JÁ GRAVADO. Um ZodError
    // aqui sairia como 400 "Dados inválidos", que lê como "sua requisição está
    // errada" quando o errado é o registro no banco.
    const lido = strengthPayloadSchema.safeParse(atividade.payload);
    if (!lido.success) {
      throw new HttpError(422, "Não consegui ler esse treino para virar uma sessão do plano.");
    }
    const payload = lido.data;
    const weekdays = normalizarWeekdays(body.weekdays);

    const plan = await Plan.findOne({ user: user._id }).sort({ version: -1 });
    if (body.versao !== undefined && plan && body.versao !== plan.version) {
      throw new HttpError(409, "Seu plano mudou. Abra de novo.");
    }
    const atual = (plan?.workout ?? null) as WorkoutData | null;
    const existentes = atual?.sessions ?? [];

    const day = nomeUnicoDeSessao(
      existentes.map((s) => s.day),
      body.day ?? atividade.title ?? ""
    );
    const nova = sessaoDeAtividade({ payload, day, focus: body.focus, weekdays });
    if (nova.exercises.length === 0) {
      throw new HttpError(400, "Esse treino não tem exercício para virar uma sessão.");
    }

    // A sessão nova entra por último e leva os dias que pediu; quem tinha
    // aqueles dias fica sem eles. É o pedido explícito da pessoa.
    const { sessions, tomadosDe } = atribuirDias([...existentes, nova], existentes.length, weekdays);
    const workout: WorkoutData = {
      split: atual?.split || "Meu treino",
      daysPerWeek: Math.min(Math.max(atual?.daysPerWeek ?? 0, 1), 7),
      sessions,
    };

    let doc = plan;
    let criouPlano = false;
    if (!doc) {
      // Primeiro plano da pessoa, montado por ela. `summary` e `disclaimer` são
      // obrigatórios no modelo: sem eles isto estouraria como 500.
      doc = await Plan.create({
        user: user._id,
        version: 1,
        summary: "Seu treino, montado por você.",
        workout,
        diet: null,
        disclaimer: DISCLAIMER_PROPRIO,
        createdBy: null,
      });
      criouPlano = true;
    } else {
      // Acrescentar sessão EDITA a versão corrente. Criar versão nova faria
      // todo `planLink.planVersion` já gravado passar a apontar para "um plano
      // antigo" sem que nada tenha sido prescrito.
      doc.workout = workout;
      doc.markModified("workout");
      await doc.save();
    }

    // Sem isto a Home continuaria perguntando "como você treina?" com plano
    // existindo. As rotas de apagar já fazem o inverso.
    //
    // Só quando ela ainda NÃO respondeu. `"propria"` não é ausência de
    // resposta: é a resposta de quem segue a programação do box, dada na mão e
    // visível como um botão em Configurações. Sobrescrever isso seria mudar
    // uma preferência que ninguém pediu para mudar.
    if (user.get("settings.programacao") == null) {
      user.set("settings.programacao", "plano");
      await user.save();
    }

    // O treino que semeou a sessão passa a contar na adesão da ficha. Sem isto
    // ele ficaria de fora justamente do plano que ele criou.
    if (!atividade.planLink) {
      atividade.set("planLink", { planVersion: doc.version, sessionDay: day });
      await atividade.save();
    }

    res.status(201).json({
      data: { plan: serializePlan(doc) },
      // `tomadosDe` diz quais sessões perderam um dia para esta. O app usa isso
      // para avisar ("Dia A ficou sem a terça") em vez de a pessoa descobrir na
      // terça seguinte.
      meta: { criouPlano, sessionDay: day, diasTomadosDe: tomadosDe },
    });
  })
);

// Retorna o plano mais recente do usuário (ou 404 se ainda não gerou).
/**
 * Gera SÓ a dieta.
 *
 * É o que permite a quem segue a programação do box ter uma dieta sem carregar
 * junto um treino que não vai usar. Se já existe plano, preenche a metade que
 * falta; se não existe, cria um só com a dieta.
 */
plansRouter.post(
  "/diet",
  requireAuth,
  generateLimiter,
  asyncHandler(async (req, res) => {
    const user = req.user!;

    const profileDoc = await Profile.findOne({ user: user._id });
    if (!profileDoc) {
      throw new HttpError(409, "Conclua o onboarding antes de gerar uma dieta");
    }

    const atual = await Plan.findOne({ user: user._id }).sort({ version: -1 });

    // Gate por METADE, não por plano: quem só gerou treino nunca gerou dieta, e
    // cobrar por isso seria cobrar duas vezes pela primeira geração.
    if (atual?.diet && user.tier !== "premium") {
      throw new HttpError(
        402,
        "Gerar uma nova dieta é um recurso Premium. Assine para ter dietas ilimitadas."
      );
    }

    const profile = profileDataSchema.parse(profileDoc.toObject());
    const data = await generateDiet(profile, user._id.toString());

    let plan;
    if (atual) {
      atual.diet = data.diet;
      // O resumo passa a falar da dieta só quando não há treino para resumir.
      if (!atual.workout) atual.summary = data.summary;
      await atual.save();
      plan = atual;
    } else {
      plan = await Plan.create({
        user: user._id,
        version: 1,
        summary: data.summary,
        workout: null,
        diet: data.diet,
        disclaimer: data.disclaimer,
      });
    }

    res.status(201).json({ plan: serializePlan(plan) });
  })
);

/**
 * Zera o plano inteiro e devolve a pessoa à escolha de como treina.
 *
 * Apagar de verdade, e não esconder: um plano "inativo" guardado voltaria a
 * aparecer em alguma consulta esquecida. As atividades já registradas não são
 * tocadas — `planLink` guarda número da versão e dia, não uma referência que
 * quebre.
 */
plansRouter.delete(
  "/current",
  requireAuth,
  asyncHandler(async (req, res) => {
    await recusarSeForDoTreinador(req.user!._id);

    const r = await Plan.deleteMany({ user: req.user!._id });
    // Sem isto a Home ficaria sem plano E sem pergunta: uma tela vazia.
    req.user!.set("settings.programacao", null);
    await req.user!.save();
    res.json({ data: { removidos: r.deletedCount ?? 0 }, meta: {} });
  })
);

/** Zera uma metade só. A outra continua de pé. */
plansRouter.delete(
  "/current/:parte",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parte = req.params.parte;
    if (parte !== "workout" && parte !== "diet") {
      throw new HttpError(400, "Parte desconhecida. Use workout ou diet.");
    }
    if (parte === "workout") await recusarSeForDoTreinador(req.user!._id);

    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    if (!plan) throw new HttpError(404, "Nenhum plano para editar");

    plan.set(parte, null);

    // Sobrou nada: o documento não tem mais por que existir, e a pessoa volta a
    // escolher como treina.
    if (!plan.workout && !plan.diet) {
      await Plan.deleteMany({ user: req.user!._id });
      req.user!.set("settings.programacao", null);
      await req.user!.save();
      return res.json({ data: { plan: null }, meta: { vazio: true } });
    }

    // Zerar o treino também devolve a escolha: é ela que decide o que a Home
    // mostra no lugar dele.
    if (parte === "workout") {
      req.user!.set("settings.programacao", null);
      await req.user!.save();
    }

    await plan.save();
    res.json({ data: { plan: serializePlan(plan) }, meta: {} });
  })
);

plansRouter.get(
  "/current",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Com o autor junto: o `createdBy` sozinho é um id, e a tela precisa dizer
    // um NOME. Sem isso o treino que o treinador escreveu chegava na Home com
    // a mesma cara do que a IA gerou, e a pessoa não tinha como saber a
    // diferença — que é exatamente a coisa que ela mais precisa saber.
    const plan = await Plan.findOne({ user: req.user!._id })
      .sort({ version: -1 })
      .populate("createdBy", "name username avatarUrl");

    // Sem plano é 200 com `plan: null`, e não 404.
    //
    // "Esta pessoa ainda não gerou um plano" é o estado NORMAL de quem acabou
    // de se cadastrar, não uma falha — e todo 404 aparece em vermelho no
    // console do navegador. A Home de quem não tem plano enchia o console de
    // erro a cada foco da tela, que é como se ensina alguém a ignorar o
    // console.
    //
    // Seguro para o APK instalado: `getCurrentPlan` desestrutura `{ plan }` e
    // devolve o que vier. Com 404 ele caía no `catch` e devolvia `null`; com
    // 200 e `plan: null` devolve o mesmo `null`, pelo caminho de cima.
    res.json({ plan: plan ? serializePlan(plan) : null });
  })
);
