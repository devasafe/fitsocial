import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { escritaEhDoProfissional, papeisAtivosDoAluno } from "../services/vinculos.js";
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
 * A dieta não entra aqui: quem responde por ela é o nutricionista, e a trava
 * dela é `recusarSeTemNutricionista`, logo abaixo. `POST /plans/diet` continua
 * aberto para quem tem só treinador.
 *
 * Vale para TODA porta que mexe no treino, e não só para a IA: gerar, reajustar,
 * importar de um texto, editar à mão e apagar chegam todas ao mesmo lugar — o
 * treino que o profissional assinou deixa de ser o que ele escreveu, sem que
 * ele saiba. Fechar só a IA seria trancar uma porta e deixar quatro abertas.
 *
 * Por ESCOPO, e não por existência de vínculo (`escritaEhDoProfissional`, não
 * `temProfissional`): um vínculo de coach com `treinos: false` não torna o
 * treinador dono do treino — o dono continua sendo o aluno, e ele não pode
 * ficar impedido de escrever algo que mais ninguém escreve. Antes desta
 * correção, o convite pré-marcava `treinos: true` e escondia o defeito; um
 * aluno que desligasse os treinos no cartão do treinador caía nele.
 */
async function recusarSeTemTreinador(userId: mongoose.Types.ObjectId): Promise<void> {
  if (await escritaEhDoProfissional(userId, "treinos")) {
    throw new HttpError(
      409,
      "Quem escreve o seu treino é o seu treinador. Peça a mudança pelo acompanhamento."
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

/**
 * Quem tem nutricionista não recebe dieta da IA.
 *
 * Mesma regra e mesmo motivo do treino, e agora ela cabe: até esta frente o
 * vínculo de nutricionista não tinha função nenhuma, e por isso a dieta ficava
 * de fora. Uma dieta que troca sozinha é a pessoa descobrir de manhã que está
 * comendo outra coisa — e o nutricionista respondendo por números que ele nunca
 * escreveu.
 *
 * Por ESCOPO, e não por existência de vínculo — mesmo motivo de
 * `recusarSeTemTreinador`, espelhado: um vínculo de nutri com `dieta: false`
 * (o que o app instalado pré-marca em TODO aceite, inclusive de convite de
 * nutricionista) não torna a nutricionista dona da dieta. Antes desta
 * correção, era exatamente esse o caminho padrão que travava a dieta dos dois
 * lados ao mesmo tempo: o aluno recusado por existência de vínculo, e a
 * nutricionista recusada por escopo fechado — ninguém conseguia escrever.
 */
async function recusarSeTemNutricionista(userId: mongoose.Types.ObjectId): Promise<void> {
  if (await escritaEhDoProfissional(userId, "dieta")) {
    throw new HttpError(
      409,
      "Quem escreve a sua dieta é o seu nutricionista. Peça a mudança pelo acompanhamento."
    );
  }
}

/** A dieta corrente é de um profissional? Então ela não se apaga sozinha. */
async function recusarSeForDoNutricionista(userId: mongoose.Types.ObjectId): Promise<void> {
  const atual = await Plan.findOne({ user: userId }).sort({ version: -1 }).select("createdBy");
  if (atual?.createdBy) await recusarSeTemNutricionista(userId);
}

/**
 * Que metades deste plano o ALUNO pode escrever agora — a resposta que
 * `/generate`, `/adjust` e `/import` precisam para decidir o que fazer com o
 * que a IA devolve, em vez de recusar a requisição inteira. `PlanData`
 * inclui as duas metades sempre juntas; travar por INTEIRO quando só uma
 * delas tem dono profissional prendia quem só tem nutricionista (ou só
 * treinador) numa ficha sem plano nenhum — a Tarefa 11b, Defeito 2.
 */
async function metadesEscreviveisPeloAluno(
  userId: mongoose.Types.ObjectId
): Promise<{ treino: boolean; dieta: boolean }> {
  const [treinoTravado, dietaTravada] = await Promise.all([
    escritaEhDoProfissional(userId, "treinos"),
    escritaEhDoProfissional(userId, "dieta"),
  ]);
  return { treino: !treinoTravado, dieta: !dietaTravada };
}

/**
 * Só recusa a requisição INTEIRA quando não sobra NADA para o aluno escrever
 * — as duas metades são de profissional. Fora isso, `/generate`/`/adjust`/
 * `/import` escrevem a metade livre e descartam a outra, preservando a que já
 * existia (mesmo precedente de `PUT /pro/alunos/:id/treino` preservando a
 * dieta com `diet: atual?.diet ?? null`, e vice-versa em `/dieta`).
 */
function recusarSeNadaParaEscrever(metades: { treino: boolean; dieta: boolean }): void {
  if (!metades.treino && !metades.dieta) {
    throw new HttpError(
      409,
      "Quem escreve o seu treino é o seu treinador, e quem escreve a sua dieta é o seu nutricionista. Peça as mudanças pelo acompanhamento."
    );
  }
}

/**
 * `createdBy`/`disclaimer` são UM CAMPO POR DOCUMENTO para DUAS METADES
 * independentes — mesma raiz que a Tarefa 11c já registrou em
 * `PUT /alunos/:id/treino` e `/dieta` (ver os comentários lá; o que vem
 * abaixo fica coerente com aquela decisão, não é um segundo raciocínio).
 * A variação aqui é que, ao contrário daquelas duas rotas (que sempre
 * preservam UMA metade e escrevem a outra), estas três podem escrever as
 * DUAS metades de uma vez — e só nesse caso ninguém "assinou" nada, e o
 * disclaimer genérico da IA está certo.
 *
 * Rodada 2 (correção de bug pós-11b): quando QUALQUER metade era preservada
 * por ser de profissional, o `Plan.create` gravava sempre `createdBy: null`
 * e `disclaimer: data.disclaimer` (o genérico da IA) — nenhuma das três
 * rotas os condicionava. `recusarSeForDoTreinador`/
 * `recusarSeForDoNutricionista` (as guardas de apagar) leem justamente
 * `createdBy`: com ele sempre `null`, apagar o plano parava de ser barrado
 * mesmo levando junto um treino ou dieta que um profissional escreveu —
 * reabria a porta que a Tarefa 11b existe para fechar. E o disclaimer
 * específico do profissional (ex.: aviso de dor de um treinador) era
 * apagado por cima de uma metade que não mudou nesta chamada.
 */

/**
 * O metadado de UMA metade (`workout*` ou `diet*`) na versão nova que
 * `/generate`, `/adjust` e `/import` criam.
 *
 * Metade ESCRITA agora: autor `null` — a IA não é "alguém" — e o aviso é o
 * genérico dela. Metade PRESERVADA: tudo vem, byte a byte, do que já
 * existia — inclusive a AUSÊNCIA (`undefined`), quando a versão anterior é
 * de antes desta tarefa e nunca teve estes campos. É o que faz o metadado
 * novo nunca inventar uma resposta para o passado; ver o desenho em
 * `docs/superpowers/specs/2026-09-17-metadado-por-metade-do-plano-design.md`.
 */
function metadadoDaMetade(
  escrita: boolean,
  anteriorCreatedBy: mongoose.Types.ObjectId | null | undefined,
  anteriorEm: Date | null | undefined,
  anteriorDisclaimer: string | null | undefined,
  agora: Date,
  disclaimerDaIA: string
): {
  createdBy: mongoose.Types.ObjectId | null | undefined;
  em: Date | null | undefined;
  disclaimer: string | null | undefined;
} {
  return escrita
    ? { createdBy: null, em: agora, disclaimer: disclaimerDaIA }
    : { createdBy: anteriorCreatedBy, em: anteriorEm, disclaimer: anteriorDisclaimer };
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
    // `generatePlan` devolve as duas metades (`PlanData` inclui `diet`), e só
    // o treino passa por `preservarAgenda` depois do spread — a dieta entraria
    // crua por cima da prescrição. A metade travada é DESCARTADA e a corrente
    // preservada abaixo; só recusa a requisição inteira quando as duas são de
    // profissional (Defeito 2 — travar tudo prendia quem só tem nutricionista
    // numa ficha sem plano nenhum, e o treino nem é o que estava travado).
    const metades = await metadesEscreviveisPeloAluno(user._id);
    recusarSeNadaParaEscrever(metades);

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

    const agora = new Date();
    const metaTreino = metadadoDaMetade(
      metades.treino,
      last?.workoutCreatedBy,
      last?.workoutEm,
      last?.workoutDisclaimer,
      agora,
      data.disclaimer
    );
    const metaDieta = metadadoDaMetade(
      metades.dieta,
      last?.dietCreatedBy,
      last?.dietEm,
      last?.dietDisclaimer,
      agora,
      data.disclaimer
    );

    const plan = await Plan.create({
      user: user._id,
      version: (last?.version ?? 0) + 1,
      summary: data.summary,
      // "Plano novo, nada a preservar" só vale para a PRIMEIRA geração. O gate
      // acima deixa passar exatamente o contrário: premium regenerando por
      // cima de um plano que já existe — e aí os dias que a pessoa escolheu
      // sumiriam sem ninguém ligar o sumiço ao botão de gerar. Quando não há
      // agenda anterior isto é no-op. Se o treino é do treinador, o gerado é
      // descartado e nem passa por `preservarAgenda` — não há agenda de um
      // treino que não vai existir.
      workout: metades.treino
        ? preservarAgenda(last?.workout as WorkoutData | null, data.workout)
        : (last?.workout ?? null),
      // Mesma ideia para a dieta: se ela é da nutricionista, a gerada é
      // descartada e a corrente preservada — byte a byte, sem passar por
      // nenhuma transformação.
      diet: metades.dieta ? data.diet : (last?.diet ?? null),
      // Se as duas metades vieram da IA agora, ninguém assinou. Se alguma
      // veio preservada, o plano novo continua contendo trabalho de
      // profissional — a procedência da versão anterior vem junto, senão
      // apagar o plano deixaria de ser barrado (ver comentário acima).
      createdBy: metades.treino && metades.dieta ? null : (last?.createdBy ?? null),
      disclaimer: metades.treino && metades.dieta ? data.disclaimer : (last?.disclaimer ?? data.disclaimer),
      // Metadado por metade — aditivo, ver `metadadoDaMetade` acima.
      workoutCreatedBy: metaTreino.createdBy,
      workoutEm: metaTreino.em,
      workoutDisclaimer: metaTreino.disclaimer,
      dietCreatedBy: metaDieta.createdBy,
      dietEm: metaDieta.em,
      dietDisclaimer: metaDieta.disclaimer,
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
    // `adjustPlan` reescreve o plano inteiro — incluindo a dieta, sem que
    // ninguém tenha pedido a ela nada. Mesma trava do `/generate`, e mesma
    // correção: escreve só a metade livre, descarta a travada.
    const metades = await metadesEscreviveisPeloAluno(user._id);
    recusarSeNadaParaEscrever(metades);

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
    const agora = new Date();
    const metaTreino = metadadoDaMetade(
      metades.treino,
      current.workoutCreatedBy,
      current.workoutEm,
      current.workoutDisclaimer,
      agora,
      data.disclaimer
    );
    const metaDieta = metadadoDaMetade(
      metades.dieta,
      current.dietCreatedBy,
      current.dietEm,
      current.dietDisclaimer,
      agora,
      data.disclaimer
    );
    const plan = await Plan.create({
      user: user._id,
      version: current.version + 1,
      summary: data.summary,
      // A IA reescreve o treino inteiro e não sabe de agenda. Este é o
      // escritor mais traiçoeiro dos três: não parece um escritor de workout.
      // Se o treino é do treinador, o reajuste é descartado e o corrente
      // preservado como está — sem passar por `preservarAgenda`.
      workout: metades.treino
        ? preservarAgenda(current.workout as WorkoutData | null, data.workout)
        : (current.workout as WorkoutData | null),
      diet: metades.dieta ? data.diet : (current.diet as unknown),
      // Mesma procedência do `/generate` — ver o comentário lá.
      createdBy: metades.treino && metades.dieta ? null : (current.createdBy ?? null),
      disclaimer: metades.treino && metades.dieta ? data.disclaimer : (current.disclaimer ?? data.disclaimer),
      // Metadado por metade — aditivo, ver `metadadoDaMetade` acima do `/generate`.
      workoutCreatedBy: metaTreino.createdBy,
      workoutEm: metaTreino.em,
      workoutDisclaimer: metaTreino.disclaimer,
      dietCreatedBy: metaDieta.createdBy,
      dietEm: metaDieta.em,
      dietDisclaimer: metaDieta.disclaimer,
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
    // `importPlanFromText` também devolve as duas metades — mesma trava, e
    // mesma correção do `/generate`: escreve só a metade livre.
    const metades = await metadesEscreviveisPeloAluno(user._id);
    recusarSeNadaParaEscrever(metades);

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
    const agora = new Date();
    const metaTreino = metadadoDaMetade(
      metades.treino,
      last?.workoutCreatedBy,
      last?.workoutEm,
      last?.workoutDisclaimer,
      agora,
      data.disclaimer
    );
    const metaDieta = metadadoDaMetade(
      metades.dieta,
      last?.dietCreatedBy,
      last?.dietEm,
      last?.dietDisclaimer,
      agora,
      data.disclaimer
    );
    const plan = await Plan.create({
      user: user._id,
      version: (last?.version ?? 0) + 1,
      summary: data.summary,
      // Pelo mesmo motivo do `/generate`: quem é Pro reimporta por cima de um
      // plano existente. Como o casamento é por nome exato de sessão, um texto
      // de verdade diferente não herda nada — só o reimport do mesmo plano.
      // Se o treino é do treinador, o importado é descartado e o corrente
      // preservado, sem passar por `preservarAgenda`.
      workout: metades.treino
        ? preservarAgenda(last?.workout as WorkoutData | null, data.workout)
        : (last?.workout ?? null),
      diet: metades.dieta ? data.diet : (last?.diet ?? null),
      // Mesma procedência do `/generate` — ver o comentário lá.
      createdBy: metades.treino && metades.dieta ? null : (last?.createdBy ?? null),
      disclaimer: metades.treino && metades.dieta ? data.disclaimer : (last?.disclaimer ?? data.disclaimer),
      // Metadado por metade — aditivo, ver `metadadoDaMetade` acima do `/generate`.
      workoutCreatedBy: metaTreino.createdBy,
      workoutEm: metaTreino.em,
      workoutDisclaimer: metaTreino.disclaimer,
      dietCreatedBy: metaDieta.createdBy,
      dietEm: metaDieta.em,
      dietDisclaimer: metaDieta.disclaimer,
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
    // E vice-versa: a trava é sobre comida, não sobre o plano inteiro.
    if (body.diet !== undefined) await recusarSeTemNutricionista(req.user!._id);

    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    if (!plan) throw new HttpError(404, "Nenhum plano para editar");

    if (body.workout !== undefined) {
      // O cliente pode não conhecer `weekdays` — o APK instalado não conhece.
      // Sem isto, editar a ficha por ele apagaria a agenda em silêncio.
      plan.workout = preservarAgenda(plan.workout as WorkoutData | null, body.workout);
      plan.markModified("workout");
      // Edição IN PLACE, sem versão nova — é o sintoma 2 do desenho: sem
      // isto, um treino que era do treinador continuaria dizendo `workoutCreatedBy`
      // dele depois de o próprio aluno tê-lo reescrito à mão.
      plan.workoutCreatedBy = req.user!._id;
      plan.workoutEm = new Date();
    }
    if (body.diet !== undefined) {
      plan.diet = body.diet;
      plan.markModified("diet");
      // Espelho do treino, acima: quem editou por último é quem passa a
      // responder por esta metade.
      plan.dietCreatedBy = req.user!._id;
      plan.dietEm = new Date();
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

    // Um round-trip só para os dois papéis: esta é a Home, aberta em toda
    // sessão, e duas chamadas de `temProfissional` em sequência seriam duas
    // consultas onde uma resolve.
    const papeis = await papeisAtivosDoAluno(req.user!._id);

    res.json({
      data: { ...dia, diaDaSemana: alvo, planVersion: plan?.version ?? null },
      meta: {
        fuso: FUSO,
        hoje: chaveDoDia(),
        diaDaSemana: hoje,
        naoAgendadas: sessoesSemDia(workout),
        // Quem tem treinador não acrescenta sessão à prescrição. O app esconde o
        // botão com isto, em vez de deixar a pessoa digitar e tomar 409 no fim.
        podeEditarPlano: !papeis.coach,
        // Mesma ideia, para a dieta: aditivo — o APK instalado ignora o campo,
        // e o app novo desabilita o botão em vez de deixar a pessoa levar 409.
        podeEditarDieta: !papeis.nutri,
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
        // Metadado por metade: este treino é tão "próprio" quanto o que
        // `PUT /plans/current` edita à mão — é a mesma pessoa montando o
        // treino dela, só que a partir de um treino já registrado.
        workoutCreatedBy: user._id,
        workoutEm: new Date(),
        workoutDisclaimer: DISCLAIMER_PROPRIO,
      });
      criouPlano = true;
    } else {
      // Acrescentar sessão EDITA a versão corrente. Criar versão nova faria
      // todo `planLink.planVersion` já gravado passar a apontar para "um plano
      // antigo" sem que nada tenha sido prescrito.
      doc.workout = workout;
      doc.markModified("workout");
      // Mesmo raciocínio do `PUT /plans/current`: quem mexeu por último no
      // treino passa a responder por ele — mesmo que só tenha acrescentado
      // uma sessão, e não reescrito o resto.
      doc.workoutCreatedBy = user._id;
      doc.workoutEm = new Date();
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
    await recusarSeTemNutricionista(user._id);

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

    // Metadado por metade: o desenho trata esta rota como `PUT /plans/current`
    // (aluno escrevendo a própria dieta), não como `/generate` (a IA
    // escrevendo por conta própria) — mesmo a dieta vindo da IA aqui, quem
    // pediu e é dono do resultado é o próprio aluno, sem profissional
    // envolvido. É o que resolve o sintoma 2: se havia um `dietCreatedBy` de
    // um nutricionista dispensado, esta chamada precisa parar de dizer isso.
    let plan;
    if (atual) {
      atual.diet = data.diet;
      // O resumo passa a falar da dieta só quando não há treino para resumir.
      if (!atual.workout) atual.summary = data.summary;
      atual.dietCreatedBy = user._id;
      atual.dietEm = new Date();
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
        dietCreatedBy: user._id,
        dietEm: new Date(),
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
    await recusarSeForDoNutricionista(req.user!._id);

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
    if (parte === "diet") await recusarSeForDoNutricionista(req.user!._id);

    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    if (!plan) throw new HttpError(404, "Nenhum plano para editar");

    plan.set(parte, null);
    // O metadado da metade zerada some junto — senão o próximo prescritor
    // veria "prescrito por Fulano" sobre um conteúdo que nem existe mais, a
    // mesma mentira que os campos novos existem para acabar.
    if (parte === "workout") {
      plan.workoutCreatedBy = null;
      plan.workoutEm = null;
      plan.workoutDisclaimer = null;
    } else {
      plan.dietCreatedBy = null;
      plan.dietEm = null;
      plan.dietDisclaimer = null;
    }

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
