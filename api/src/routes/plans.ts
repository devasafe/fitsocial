import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { Profile, profileDataSchema } from "../models/Profile.js";
import { Plan, workoutSchema, dietSchema } from "../models/Plan.js";
import { Activity } from "../models/Activity.js";
import { generateDiet, generatePlan, adjustPlan, importPlanFromText } from "../services/ai/planGenerator.js";
import { buildAdherenceSummary } from "../services/adherence.js";
import { backfillWorkoutKinds } from "../services/exerciseKind.js";
import { z } from "zod";

export const plansRouter = Router();

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
  return {
    id: plan._id.toString(),
    version: plan.version,
    summary: plan.summary,
    workout,
    diet: plan.diet ?? null,
    disclaimer: plan.disclaimer,
    createdAt: plan.get("createdAt") as Date,
  };
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
    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    if (!plan) {
      throw new HttpError(404, "Nenhum plano gerado ainda");
    }
    res.json({ plan: serializePlan(plan) });
  })
);
