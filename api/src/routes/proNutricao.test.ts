import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { Plan, type WorkoutData } from "../models/Plan.js";
import { FoodLog } from "../models/FoodLog.js";
import { ProMessage } from "../models/ProMessage.js";
import { chaveDoDia } from "../utils/dia.js";

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Um agente HTTP já autenticado, para ler os testes como no brief: `comoNutri.get(...)`. */
function como(token: string) {
  return {
    get: (path: string) => request(app).get(path).set(auth(token)),
    put: (path: string) => request(app).put(path).set(auth(token)),
  };
}

let n = 0;
async function registrar(): Promise<{ token: string; id: string }> {
  n++;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `P${n}`, email: `pro${n}@teste.com`, password: "senha-bem-longa" });
  return { token: r.body.token, id: r.body.user.id };
}

/** Registra e libera a capacidade, como o script `pro:grant` faria. */
async function registrarProfissional(papel: "coach" | "nutri" = "coach", limite = 10) {
  const p = await registrar();
  const u = (await User.findById(p.id))!;
  u.set(`pro.${papel}`, { ativo: true, origem: "manual", limiteDeAlunos: limite });
  await u.save();
  return p;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Activity.deleteMany({}),
    ProfessionalLink.deleteMany({}),
    ProfessionalInvite.deleteMany({}),
    Plan.deleteMany({}),
    FoodLog.deleteMany({}),
    ProMessage.deleteMany({}),
  ]);
});

async function convite(token: string, papel: "coach" | "nutri" = "coach", usos = 1) {
  const r = await request(app).post("/pro/convites").set(auth(token)).send({ papel, usos });
  expect(r.status).toBe(201);
  return r.body.data.code as string;
}

async function vincular(
  proToken: string,
  alunoToken: string,
  escopo = {},
  papel: "coach" | "nutri" = "coach"
) {
  const code = await convite(proToken, papel);
  const r = await request(app)
    .post(`/pro/convites/${code}/aceitar`)
    .set(auth(alunoToken))
    .send(escopo);
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

describe("GET /pro/alunos — triagem do nutricionista", () => {
  it("a lista do nutri traz dias sem registro de comida, e a do coach não muda", async () => {
    const nutri = await registrarProfissional("nutri");
    const coach = await registrarProfissional("coach");
    const aluno = await registrar();

    await vincular(nutri.token, aluno.token, { dieta: true, treinos: false }, "nutri");
    await vincular(coach.token, aluno.token, { treinos: true, dieta: false }, "coach");

    // Sem isto, `ultimoRegistroEm` sai `null` e `expect.anything()` rejeita —
    // a pessoa precisa ter registrado algo para o sinal existir.
    await FoodLog.create({
      user: new mongoose.Types.ObjectId(aluno.id),
      date: chaveDoDia(),
      meal: "almoco",
      name: "Arroz e feijão",
      kcal: 500,
    });

    const comoNutri = como(nutri.token);
    const comoCoach = como(coach.token);

    const doNutri = await comoNutri.get("/pro/alunos?papel=nutri").expect(200);
    // Para o nutri, "precisa de mim" é ter parado de registrar comida.
    expect(doNutri.body.data[0].nutricao).toEqual(
      expect.objectContaining({ ultimoRegistroEm: expect.anything() })
    );

    const doCoach = await comoCoach.get("/pro/alunos?papel=coach").expect(200);
    // O lado do coach segue idêntico: o painel dele está no ar.
    expect(doCoach.body.data[0].treinos).toBeDefined();
    expect(doCoach.body.data[0].nutricao).toBeUndefined();
  });
});

describe("GET /pro/alunos/:id/nutricao", () => {
  let nutri: { token: string; id: string };
  let nutriSemEscopo: { token: string; id: string };
  let estranho: { token: string; id: string };
  let aluno: { token: string; id: string };
  let alunoId: string;
  let comoNutri: ReturnType<typeof como>;
  let comoNutriSemEscopo: ReturnType<typeof como>;
  let comoEstranho: ReturnType<typeof como>;
  let comoAluno: ReturnType<typeof como>;

  beforeEach(async () => {
    nutri = await registrarProfissional("nutri");
    nutriSemEscopo = await registrarProfissional("nutri");
    estranho = await registrarProfissional("nutri");
    aluno = await registrar();
    alunoId = aluno.id;

    await vincular(nutri.token, aluno.token, { dieta: true, treinos: false }, "nutri");
    await vincular(nutriSemEscopo.token, aluno.token, { dieta: false, treinos: false }, "nutri");

    comoNutri = como(nutri.token);
    comoNutriSemEscopo = como(nutriSemEscopo.token);
    comoEstranho = como(estranho.token);
    comoAluno = como(aluno.token);
  });

  it("nutri com dieta aberta recebe a série", async () => {
    const r = await comoNutri.get(`/pro/alunos/${alunoId}/nutricao?dias=7`).expect(200);
    expect(r.body.data.dias).toHaveLength(7);
    expect(r.body.data.resumo.diasNaJanela).toBe(7);
  });

  it("dia sem registro chega null, e não zero — igual ao lado do aluno", async () => {
    const r = await comoNutri.get(`/pro/alunos/${alunoId}/nutricao?dias=7`).expect(200);
    expect(r.body.data.dias[0].kcal).toBeNull();
  });

  it("nutri SEM dieta aberta recebe 403 dizendo que é a dieta", async () => {
    const r = await comoNutriSemEscopo.get(`/pro/alunos/${alunoId}/nutricao`).expect(403);
    expect(r.body.error).toMatch(/dieta/i);
  });

  it("estranho recebe 404", async () => {
    await comoEstranho.get(`/pro/alunos/${alunoId}/nutricao`).expect(404);
  });

  it("A RESPOSTA É IDÊNTICA à que o próprio aluno recebe", async () => {
    // Regra do projeto: os dois lados chamam a MESMA função. Este teste é o que
    // quebra se alguém reimplementar o cálculo de um dos lados.
    //
    // Nenhuma promoção de plano é precisa aqui: `vincular()` já bancou o aluno.
    // Aceitar o convite de um profissional com capacidade ativa dispara
    // `recontarPatrocinios` (`services/patrocinio.ts`), que soma
    // `vinculosPatrocinados` — e o ramo 6 de `calcularPlan`
    // (`services/entitlement.ts`) trata quem tem patrocínio como "pro". É por
    // isso que os dois lados já pedem a MESMA janela sem cortes: "quem paga é
    // o profissional, e o aluno tem o acompanhamento completo" (comentário de
    // `recontarPatrocinios`). `User.updateOne({ plan: "pro" })` NÃO funcionaria
    // aqui — `calcularPlan` nunca lê `user.plan` sozinho como prova, e o
    // `recomputeTier` do `requireAuth` reescreveria o campo antes da próxima
    // requisição.
    const doAluno = await comoAluno.get("/nutrition/evolucao?dias=30").expect(200);
    const doPro = await comoNutri.get(`/pro/alunos/${alunoId}/nutricao?dias=30`).expect(200);
    expect(doPro.body.data).toEqual(doAluno.body.data);
  });
});

describe("GET /pro/alunos/:id/dieta", () => {
  let nutri: { token: string; id: string };
  let nutriSemEscopo: { token: string; id: string };
  let aluno: { token: string; id: string };
  let alunoSemDieta: { token: string; id: string };
  let alunoId: string;
  let alunoSemDietaId: string;
  let nutriId: mongoose.Types.ObjectId;
  let comoNutri: ReturnType<typeof como>;
  let comoNutriSemEscopo: ReturnType<typeof como>;

  beforeEach(async () => {
    nutri = await registrarProfissional("nutri");
    nutriSemEscopo = await registrarProfissional("nutri");
    aluno = await registrar();
    alunoSemDieta = await registrar();
    alunoId = aluno.id;
    alunoSemDietaId = alunoSemDieta.id;
    nutriId = new mongoose.Types.ObjectId(nutri.id);

    await vincular(nutri.token, aluno.token, { dieta: true, treinos: false }, "nutri");
    await vincular(nutri.token, alunoSemDieta.token, { dieta: true, treinos: false }, "nutri");
    await vincular(nutriSemEscopo.token, aluno.token, { dieta: false, treinos: false }, "nutri");

    comoNutri = como(nutri.token);
    comoNutriSemEscopo = como(nutriSemEscopo.token);
  });

  it("devolve a dieta corrente e diz quem escreveu", async () => {
    await Plan.create({
      user: new mongoose.Types.ObjectId(alunoId), version: 1, summary: "plano",
      workout: null, disclaimer: "aviso", createdBy: nutriId,
      diet: { dailyCalories: 2000, macros: { proteinG: 150, carbsG: 200, fatG: 60 },
              meals: [{ name: "Café", timeHint: "", items: [{ food: "Ovos", quantity: "2" }] }], notes: "" },
    });

    const r = await comoNutri.get(`/pro/alunos/${alunoId}/dieta`).expect(200);

    expect(r.body.data.diet.dailyCalories).toBe(2000);
    expect(r.body.data.version).toBe(1);
    // Saber de quem é a dieta que está na tela: minha, de outro profissional,
    // ou da IA de antes de eu chegar.
    expect(r.body.data.createdBy).toBe(nutriId.toString());
  });

  it("aluno sem dieta devolve null, não 404", async () => {
    // 404 diria "aluno não encontrado". Aqui o aluno existe e não tem dieta.
    const r = await comoNutri.get(`/pro/alunos/${alunoSemDietaId}/dieta`).expect(200);
    expect(r.body.data.diet).toBeNull();
    expect(r.body.data.createdBy).toBeNull();
  });

  const dietaExemplo = {
    dailyCalories: 2000,
    macros: { proteinG: 150, carbsG: 200, fatG: 60 },
    meals: [{ name: "Café", timeHint: "", items: [{ food: "Ovos", quantity: "2" }] }],
    notes: "",
  };

  const treinoExemplo = {
    split: "AB",
    daysPerWeek: 2,
    sessions: [
      {
        day: "A — Peito",
        focus: "Superior",
        exercises: [{ name: "Supino reto", sets: 3, reps: "8-12", restSeconds: 90, notes: "" }],
      },
    ],
  };

  it("a autoria da dieta sobrevive a uma prescrição de treino", async () => {
    // Segunda: o nutricionista prescreve a dieta.
    await comoNutri
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "Dieta inicial", diet: dietaExemplo })
      .expect(201);
    const versaoDaDieta = await Plan.findOne({ user: new mongoose.Types.ObjectId(alunoId) }).sort({
      version: -1,
    });

    // Quarta: o treinador prescreve o treino — cria versão nova e COPIA a
    // dieta corrente para ela, com o `createdBy` dele, não do nutricionista.
    const coach = await registrarProfissional("coach");
    await vincular(coach.token, aluno.token, { dieta: false, treinos: true }, "coach");
    await como(coach.token)
      .put(`/pro/alunos/${alunoId}/treino`)
      .send({ summary: "Treino novo", workout: treinoExemplo })
      .expect(201);

    // Quinta: o nutricionista abre "Prescrever dieta" de novo. Tem que
    // continuar vendo a si mesmo como autor, e a data de segunda — não a
    // versão do treino de quarta, ainda que ela seja a mais nova.
    const r = await comoNutri.get(`/pro/alunos/${alunoId}/dieta`).expect(200);
    expect(r.body.data.createdBy).toBe(nutriId.toString());
    expect(r.body.data.em).toBe(versaoDaDieta!.createdAt.toISOString());
    expect(r.body.data.version).toBe(versaoDaDieta!.version + 1);
  });

  it("a autoria muda quando a dieta muda", async () => {
    await comoNutri
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "Dieta inicial", diet: dietaExemplo })
      .expect(201);

    const coach = await registrarProfissional("coach");
    await vincular(coach.token, aluno.token, { dieta: false, treinos: true }, "coach");
    await como(coach.token)
      .put(`/pro/alunos/${alunoId}/treino`)
      .send({ summary: "Treino novo", workout: treinoExemplo })
      .expect(201);

    // Um segundo nutricionista prescreve dieta nova por cima.
    const nutri2 = await registrarProfissional("nutri");
    await vincular(nutri2.token, aluno.token, { dieta: true, treinos: false }, "nutri");
    const dietaNova = { ...dietaExemplo, dailyCalories: 2400 };
    await como(nutri2.token)
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "Ajuste de volume", diet: dietaNova })
      .expect(201);

    const r = await comoNutri.get(`/pro/alunos/${alunoId}/dieta`).expect(200);
    expect(r.body.data.createdBy).toBe(nutri2.id);
    expect(r.body.data.diet.dailyCalories).toBe(2400);
  });

  it("dieta sem autor continua sem autor", async () => {
    // O estado de todo plano que já existe hoje: gerado pela IA, sem prescrição.
    await Plan.create({
      user: new mongoose.Types.ObjectId(alunoSemDietaId),
      version: 1,
      summary: "plano da IA",
      workout: null,
      disclaimer: "aviso",
      createdBy: null,
      diet: dietaExemplo,
    });

    const r = await comoNutri.get(`/pro/alunos/${alunoSemDietaId}/dieta`).expect(200);
    expect(r.body.data.diet.dailyCalories).toBe(2000);
    expect(r.body.data.createdBy).toBeNull();
  });

  it("sem dieta, sem autor", async () => {
    await Plan.create({
      user: new mongoose.Types.ObjectId(alunoSemDietaId),
      version: 1,
      summary: "só treino",
      workout: treinoExemplo,
      diet: null,
      disclaimer: "aviso",
      createdBy: null,
    });

    const r = await comoNutri.get(`/pro/alunos/${alunoSemDietaId}/dieta`).expect(200);
    expect(r.body.data.diet).toBeNull();
    expect(r.body.data.createdBy).toBeNull();
    expect(r.body.data.em).toBeNull();
  });

  it("sem dieta aberta é 403", async () => {
    await comoNutriSemEscopo.get(`/pro/alunos/${alunoId}/dieta`).expect(403);
  });
});

describe("PUT /pro/alunos/:id/dieta", () => {
  let nutri: { token: string; id: string };
  let coach: { token: string; id: string };
  let aluno: { token: string; id: string };
  let alunoId: string;
  let alunoObjId: mongoose.Types.ObjectId;
  let linkNutriId: string;
  let comoNutri: ReturnType<typeof como>;
  let comoCoach: ReturnType<typeof como>;

  const dieta = {
    dailyCalories: 1800,
    macros: { proteinG: 140, carbsG: 180, fatG: 50 },
    meals: [{ name: "Almoço", timeHint: "12h", items: [{ food: "Frango", quantity: "150g" }] }],
    notes: "",
  };

  beforeEach(async () => {
    nutri = await registrarProfissional("nutri");
    coach = await registrarProfissional("coach");
    aluno = await registrar();
    alunoId = aluno.id;
    alunoObjId = new mongoose.Types.ObjectId(alunoId);

    linkNutriId = await vincular(nutri.token, aluno.token, { dieta: true, treinos: false }, "nutri");

    comoNutri = como(nutri.token);
    comoCoach = como(coach.token);
  });

  it("cria VERSÃO NOVA e preserva o treino e a agenda", async () => {
    // Um treino já prescrito, com dias da semana escolhidos pelo aluno — é o
    // que a prescrição de dieta não pode apagar.
    await Plan.create({
      user: alunoObjId,
      version: 1,
      summary: "treino inicial",
      workout: {
        split: "AB",
        daysPerWeek: 2,
        sessions: [
          {
            day: "A — Peito",
            focus: "Superior",
            exercises: [{ name: "Supino reto", sets: 4, reps: "8-12", restSeconds: 90, notes: "" }],
            weekdays: [1, 4],
          },
        ],
      },
      diet: null,
      disclaimer: "aviso",
    });

    // A versão não é estética: o progresso de nutrição usa a versão do Plan para
    // saber qual meta valia em cada dia. Editar no lugar apagaria o histórico
    // de meta exatamente no caso em que ele mais importa.
    const antes = await Plan.findOne({ user: alunoObjId }).sort({ version: -1 });

    const r = await comoNutri
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "Ajustei para o seu volume de treino", diet: dieta })
      .expect(201);

    expect(r.body.data.version).toBe((antes?.version ?? 0) + 1);

    const depois = await Plan.findOne({ user: alunoObjId }).sort({ version: -1 });
    expect((depois!.diet as { dailyCalories: number }).dailyCalories).toBe(1800);

    // A v1 continua no banco, e continua sem dieta: é ela que o progresso de
    // nutrição lê para saber que meta valia antes de hoje. `findById` busca o
    // documento ANTIGO pelo id — é o que distingue `Plan.create` de um
    // `save()` que só incrementaria a versão no lugar.
    expect((await Plan.findById(antes!._id))!.diet).toBeNull();

    // O treino é metade independente do plano. Prescrever comida não é motivo
    // para apagar treino — nem a agenda de dias que o aluno montou.
    expect(depois!.workout).toEqual(antes!.workout);
    expect((depois!.workout as WorkoutData).sessions[0]!.weekdays).toEqual([1, 4]);
  });

  it("avisa o aluno pela conversa que já existe", async () => {
    await comoNutri
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "Ajustei a dieta", diet: dieta, recado: "Bebe mais água." })
      .expect(201);

    const msgs = await ProMessage.find({ link: linkNutriId }).sort({ createdAt: -1 });
    expect(msgs[0]!.texto).toMatch(/1800 kcal/);
    expect(msgs[0]!.texto).toMatch(/Bebe mais água/);
  });

  it("coach NÃO prescreve dieta", async () => {
    // Quem responde pela comida é o nutricionista, mesmo que a pessoa também
    // seja coach de alguém.
    await comoCoach
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "x", diet: dieta })
      .expect(403);
  });

  it("dieta inválida é recusada ANTES de gravar qualquer coisa", async () => {
    const antes = await Plan.countDocuments({ user: alunoObjId });
    await comoNutri
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "x", diet: { ...dieta, dailyCalories: 10 } })
      .expect(400);
    expect(await Plan.countDocuments({ user: alunoObjId })).toBe(antes);
  });
});
