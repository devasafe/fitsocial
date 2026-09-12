import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { temProfissional } from "../services/vinculos.js";
import { Profile, profileDataSchema } from "../models/Profile.js";
import { Plan, workoutSchema, dietSchema } from "../models/Plan.js";
import { Activity } from "../models/Activity.js";
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

    const { text } = importSchema.parse(req.body);

    const profileDoc = await Profile.findOne({ user: user._id });
    const profile = profileDoc ? profileDataSchema.parse(profileDoc.toObject()) : null;

    const data = await importPlanFromText(text, profile, user._id.toString());

    const last = await Plan.findOne({ user: user._id }).sort({ version: -1 });
    const plan = await Plan.create({
      user: user._id,
      version: (last?.version ?? 0) + 1,
      ...data,
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
      plan.workout = body.workout;
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
