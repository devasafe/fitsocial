// Espelho de `gatesDoPlano`/`planoPorDiaDaSemana` para o treino, mas sobre a
// dieta: até esta frente o vínculo de nutricionista não tinha função nenhuma,
// e por isso `POST /plans/diet` e companhia ficavam abertos mesmo para quem
// já tinha nutricionista. Agora o vínculo existe de verdade, e a dieta que
// troca sozinha é a pessoa descobrir de manhã que está comendo outra coisa.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { setAIProvider } from "../services/ai/index.js";
import { User } from "../models/User.js";
import { Profile } from "../models/Profile.js";
import { Plan } from "../models/Plan.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { CoachMessage } from "../models/CoachMessage.js";
import { FoodLog } from "../models/FoodLog.js";
import type { AIProvider, GenerateOptions } from "../services/ai/provider.js";

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const DIETA_GERADA = JSON.stringify({
  summary: "Dieta de teste",
  diet: {
    dailyCalories: 2000,
    macros: { proteinG: 150, carbsG: 200, fatG: 60 },
    meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3" }] }],
    notes: "",
  },
  disclaimer: "Aviso.",
});

// `planDataSchema` (generate/adjust/import) exige as DUAS metades — diferente
// de `dietDataSchema` (só `/plans/diet`), que é o que `DIETA_GERADA` acima
// serve.
const PLANO_GERADO = JSON.stringify({
  summary: "Plano de teste",
  workout: {
    split: "Full body",
    daysPerWeek: 3,
    sessions: [
      { day: "A", focus: "Geral", exercises: [{ name: "Agachamento", sets: 3, reps: "10", restSeconds: 60, notes: "" }] },
    ],
  },
  diet: {
    dailyCalories: 2000,
    macros: { proteinG: 150, carbsG: 200, fatG: 60 },
    meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3" }] }],
    notes: "",
  },
  disclaimer: "Aviso.",
});

/** Dublê de IA: só a rota de geração de dieta fala com ela neste arquivo. */
class EspiaoDeProvider implements AIProvider {
  readonly name = "espiao";
  readonly aceitaImagem = false;
  proximaResposta = DIETA_GERADA;
  async generate(_params: GenerateOptions): Promise<string> {
    return this.proximaResposta;
  }
}
const espiao = new EspiaoDeProvider();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(espiao);
});

afterAll(async () => {
  setAIProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Profile.deleteMany({}),
    Plan.deleteMany({}),
    Activity.deleteMany({}),
    ProfessionalLink.deleteMany({}),
    ProfessionalInvite.deleteMany({}),
    CoachMessage.deleteMany({}),
    FoodLog.deleteMany({}),
  ]);
  espiao.proximaResposta = DIETA_GERADA;
});

let n = 0;
async function registrar(premium = true): Promise<{ token: string; id: mongoose.Types.ObjectId }> {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Pessoa ${n}`, email: `trava${n}@teste.com`, password: "senha-bem-longa" });
  const id = new mongoose.Types.ObjectId(r.body.user.id as string);
  if (premium) {
    await User.updateOne({ _id: id }, { $set: { tier: "premium", premiumSource: "admin" } });
  }
  await Profile.create({
    user: id,
    goal: "ganhar_massa",
    sex: "masculino",
    age: 30,
    heightCm: 180,
    weightKg: 80,
    experienceLevel: "intermediario",
    daysPerWeek: 4,
    sessionMinutes: 60,
    dietaryRestrictions: [],
    injuriesConditions: [],
  });
  return { token: r.body.token as string, id };
}

async function registrarNutri() {
  const p = await registrar();
  await User.updateOne(
    { _id: p.id },
    { $set: { "pro.nutri": { ativo: true, origem: "manual", limiteDeAlunos: 10 } } }
  );
  return p;
}

/** Espelho de `registrarNutri`, para os testes que provam o mesmo defeito do lado do treino. */
async function registrarCoach() {
  const p = await registrar();
  await User.updateOne(
    { _id: p.id },
    { $set: { "pro.coach": { ativo: true, origem: "manual", limiteDeAlunos: 10 } } }
  );
  return p;
}

async function vincular(
  nutriToken: string,
  alunoToken: string,
  papel: "coach" | "nutri" = "nutri",
  escopo: Record<string, boolean> = {}
) {
  const c = await request(app)
    .post("/pro/convites")
    .set(auth(nutriToken))
    .send({ papel });
  expect(c.status).toBe(201);
  const r = await request(app)
    .post(`/pro/convites/${c.body.data.code}/aceitar`)
    .set(auth(alunoToken))
    .send(escopo);
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

const DIETA_VALIDA = {
  dailyCalories: 2200,
  macros: { proteinG: 150, carbsG: 220, fatG: 70 },
  meals: [{ name: "Almoço", timeHint: "12:00", items: [{ food: "Arroz", quantity: "100g" }] }],
  notes: "",
};

const TREINO_VALIDO = {
  split: "Full body 3x",
  daysPerWeek: 3,
  sessions: [
    { day: "A", focus: "Geral", exercises: [{ name: "Agachamento", sets: 3, reps: "10", restSeconds: 60, notes: "" }] },
  ],
};

function criarPlano(user: mongoose.Types.ObjectId, partes: { workout?: unknown; diet?: unknown; createdBy?: mongoose.Types.ObjectId }) {
  return Plan.create({
    user,
    version: 1,
    summary: "estratégia",
    workout: partes.workout ?? null,
    diet: partes.diet ?? null,
    createdBy: partes.createdBy ?? null,
    disclaimer: "Aviso.",
  });
}

describe("Quem tem nutricionista não recebe dieta da IA", () => {
  // Defeito 1: a trava é pelo ESCOPO, não pela existência do vínculo. Um
  // vínculo de nutri com `dieta: false` (o app instalado pré-marca exatamente
  // isto em todo aceite, inclusive de convite de nutricionista) não torna o
  // nutricionista dono da dieta — o dono continua sendo o aluno, e ele não
  // pode ficar impedido de escrever algo que mais ninguém escreve.
  it("aluno com nutricionista SEM escopo de dieta continua escrevendo a própria dieta", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: false });

    await request(app).post("/plans/diet").set(auth(aluno.token)).send({}).expect(201);
  });

  it("POST /plans/diet recusa com 409 e manda falar com o profissional", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true });

    const r = await request(app).post("/plans/diet").set(auth(aluno.token)).send({}).expect(409);
    expect(r.body.error).toMatch(/nutricionista/i);
    expect(r.body.error).toMatch(/acompanhamento/i);
  });

  it("PUT /plans/current com dieta recusa", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true });
    await criarPlano(aluno.id, { workout: TREINO_VALIDO });

    await request(app)
      .put("/plans/current")
      .set(auth(aluno.token))
      .send({ diet: DIETA_VALIDA })
      .expect(409);
  });

  it("PUT /plans/current só com treino CONTINUA passando", async () => {
    // A trava é sobre comida. Quem tem nutricionista e não tem treinador
    // continua dono do próprio treino.
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { workout: TREINO_VALIDO });

    await request(app)
      .put("/plans/current")
      .set(auth(aluno.token))
      .send({ workout: TREINO_VALIDO })
      .expect(200);
  });

  it("aluno SEM nutricionista continua gerando dieta", async () => {
    const aluno = await registrar();

    await request(app).post("/plans/diet").set(auth(aluno.token)).send({}).expect(201);
  });

  it("encerrar o vínculo com o nutricionista destrava a geração de dieta", async () => {
    // `encerrarVinculo` não apaga o documento — vira histórico com outro
    // status. `temProfissional` filtra `status: "ativo"`, e é essa linha, e só
    // ela, que separa "encerrei com minha nutricionista" de "não consigo mais
    // gerar dieta nenhuma". A mesma função é compartilhada com o treinador,
    // então este teste protege os dois papéis de uma vez.
    const nutri = await registrarNutri();
    const aluno = await registrar();
    const linkId = await vincular(nutri.token, aluno.token, "nutri", { dieta: true });

    await request(app).post("/plans/diet").set(auth(aluno.token)).send({}).expect(409);

    const e = await request(app).delete(`/pro/acompanhamentos/${linkId}`).set(auth(aluno.token));
    expect(e.status).toBe(200);

    await request(app).post("/plans/diet").set(auth(aluno.token)).send({}).expect(201);
  });

  it("apagar a dieta é permitido quando ela NÃO tem autor, e só a dieta some", async () => {
    // Dieta feita pela IA pode ser zerada, senão quem tinha dieta antiga e
    // contratou nutricionista ficaria preso a ela.
    //
    // Com SÓ dieta no plano, `DELETE /plans/current/diet` cairia no ramo que
    // apaga o documento inteiro (nada sobra) — e aí um 200 não distingue
    // "zerou a metade certa" de "apagou tudo". Por isso o plano aqui tem as
    // duas metades, e a asserção que importa é sobre o TREINO ter sobrevivido.
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { workout: TREINO_VALIDO, diet: DIETA_VALIDA });

    await request(app).delete("/plans/current/diet").set(auth(aluno.token)).expect(200);

    const atual = await Plan.findOne({ user: aluno.id }).sort({ version: -1 });
    expect(atual!.diet).toBeNull();
    expect((atual!.workout as typeof TREINO_VALIDO).split).toBe(TREINO_VALIDO.split);
  });

  it("apagar a dieta é recusado quando ela foi prescrita", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true });
    await criarPlano(aluno.id, { diet: DIETA_VALIDA });
    await Plan.updateOne({ user: aluno.id }, { $set: { createdBy: nutri.id } });

    await request(app).delete("/plans/current/diet").set(auth(aluno.token)).expect(409);
  });

  it("DELETE /plans/current (tudo) é recusado quando a dieta foi prescrita", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true });
    await criarPlano(aluno.id, { diet: DIETA_VALIDA, createdBy: nutri.id });

    await request(app).delete("/plans/current").set(auth(aluno.token)).expect(409);
  });

  it("DELETE /plans/current (tudo) continua permitido quando não há autor", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { diet: DIETA_VALIDA });

    await request(app).delete("/plans/current").set(auth(aluno.token)).expect(200);
  });

  it("apagar o TREINO continua livre para quem só tem nutricionista", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { workout: TREINO_VALIDO, diet: DIETA_VALIDA });

    await request(app).delete("/plans/current/workout").set(auth(aluno.token)).expect(200);
  });
});

describe("Quem tem treinador não recebe treino da IA — pelo escopo, não pela existência (Defeito 1, espelhado)", () => {
  // O mesmo defeito existe do lado do treino, só que latente: o convite
  // pré-marca `treinos: true`, então o caminho feliz nunca pisa nele. Ele
  // aparece assim que o aluno desliga os treinos no cartão do treinador — ou,
  // como aqui, quando o teste escolhe o escopo explicitamente.
  it("aluno com treinador SEM escopo de treinos continua escrevendo o próprio treino", async () => {
    const coach = await registrarCoach();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token, "coach", { treinos: false });
    // `PUT /plans/current` EDITA um plano existente — precisa de um para não
    // cair no 404 "Nenhum plano para editar", que não tem nada a ver com a
    // trava que este teste prova.
    await criarPlano(aluno.id, { diet: DIETA_VALIDA });

    await request(app)
      .put("/plans/current")
      .set(auth(aluno.token))
      .send({ workout: TREINO_VALIDO })
      .expect(200);
  });

  it("aluno com treinador COM escopo de treinos não escreve o próprio treino", async () => {
    const coach = await registrarCoach();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token, "coach", { treinos: true });

    const r = await request(app)
      .put("/plans/current")
      .set(auth(aluno.token))
      .send({ workout: TREINO_VALIDO })
      .expect(409);
    expect(r.body.error).toMatch(/treinador/i);
  });
});

describe("as outras portas que escrevem a dieta inteira (generate/adjust/import) — Defeito 2", () => {
  // `generatePlan`/`adjustPlan`/`importPlanFromText` devolvem as DUAS metades
  // do plano (`PlanData` inclui `diet`), e só o treino passa por
  // `preservarAgenda` depois do spread — a dieta entraria crua por cima da
  // prescrição do nutricionista, sem que a palavra "diet" apareça na rota.
  //
  // Recusar a requisição INTEIRA por isso era grosseiro demais: também
  // trancava quem só tem nutricionista e nunca gerou treino nenhum — a rota
  // nunca chegava a rodar a IA, e a pessoa ficava presa na ficha, sem plano
  // algum, porque a dieta (que ela nem pediu) tinha dono.
  //
  // A correção escreve só as metades que o aluno pode escrever: a dieta
  // gerada é descartada e a corrente preservada quando ela é do
  // nutricionista; o treino gerado é descartado e o corrente preservado
  // quando ele é do treinador. Só quando AS DUAS são de profissional é que a
  // requisição inteira é recusada — não sobra nada para escrever.
  //
  // O teste que importa aqui não é só o status: é a metade preservada
  // continuar sendo, byte a byte, a que já existia — um teste que só olha o
  // status não pega alguém trocar a ordem das checagens e deixar o
  // `Plan.create` gravar o que a IA gerou por cima mesmo assim.

  it("aluno com só nutricionista gera o TREINO — o vínculo dela tem treinos:true por default, e isso não pode travar", async () => {
    // A prova de que a checagem é por PAPEL DONO, e não por "qualquer vínculo
    // decide": todo vínculo nasce com `escopo.treinos: true`, inclusive o de
    // nutri — ela não é dona de treino, então o aluno nunca precisou decidir
    // isso ali. Uma checagem que lesse esse `true` sem olhar o papel acharia
    // que existe alguém escrevendo o treino deste aluno, e ele continuaria
    // travado — o oposto do que esta correção existe para fazer.
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true });
    espiao.proximaResposta = PLANO_GERADO;

    const r = await request(app).post("/plans/generate").set(auth(aluno.token)).send({}).expect(201);

    const gerado = JSON.parse(PLANO_GERADO) as { workout: typeof TREINO_VALIDO };
    expect(r.body.plan.workout.split).toBe(gerado.workout.split);
    // Nenhuma dieta foi criada: não existia uma antes, e a que a IA gerou foi
    // descartada.
    const atual = await Plan.findOne({ user: aluno.id }).sort({ version: -1 });
    expect(atual!.diet).toBeNull();
  });

  it("POST /plans/generate escreve só o treino, e a dieta já prescrita não é tocada — byte a byte", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true });
    await criarPlano(aluno.id, { diet: DIETA_VALIDA, createdBy: nutri.id });
    espiao.proximaResposta = PLANO_GERADO;

    const r = await request(app).post("/plans/generate").set(auth(aluno.token)).send({}).expect(201);

    const gerado = JSON.parse(PLANO_GERADO) as { workout: typeof TREINO_VALIDO };
    expect(r.body.plan.workout.split).toBe(gerado.workout.split);
    const atual = await Plan.findOne({ user: aluno.id }).sort({ version: -1 });
    expect(atual!.version).toBe(2);
    // Byte a byte — não "tem valor parecido", e sim EXATAMENTE o que já
    // existia. É esta comparação, e não um campo isolado, que garante que
    // ninguém tocou no conteúdo da prescrição do nutricionista.
    expect(JSON.stringify(atual!.diet)).toBe(JSON.stringify(DIETA_VALIDA));
  });

  it("POST /plans/adjust escreve só o treino, e a dieta já prescrita não é tocada", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true });
    await criarPlano(aluno.id, { workout: TREINO_VALIDO, diet: DIETA_VALIDA, createdBy: nutri.id });
    espiao.proximaResposta = PLANO_GERADO;

    const r = await request(app).post("/plans/adjust").set(auth(aluno.token)).send({}).expect(201);

    const gerado = JSON.parse(PLANO_GERADO) as { workout: typeof TREINO_VALIDO };
    expect(r.body.plan.workout.split).toBe(gerado.workout.split);
    const atual = await Plan.findOne({ user: aluno.id }).sort({ version: -1 });
    expect(JSON.stringify(atual!.diet)).toBe(JSON.stringify(DIETA_VALIDA));
  });

  it("POST /plans/import escreve só o treino, e a dieta já prescrita não é tocada", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true });
    await criarPlano(aluno.id, { diet: DIETA_VALIDA, createdBy: nutri.id });
    espiao.proximaResposta = PLANO_GERADO;

    const r = await request(app)
      .post("/plans/import")
      .set(auth(aluno.token))
      .send({ text: "Treino: A - Agachamento 3x10. B - Supino 3x10. Faça 3 vezes por semana." })
      .expect(201);

    const gerado = JSON.parse(PLANO_GERADO) as { workout: typeof TREINO_VALIDO };
    expect(r.body.plan.workout.split).toBe(gerado.workout.split);
    const atual = await Plan.findOne({ user: aluno.id }).sort({ version: -1 });
    expect(JSON.stringify(atual!.diet)).toBe(JSON.stringify(DIETA_VALIDA));
  });

  it("aluno com treinador E nutricionista, os dois com escopo aberto, não gera plano nenhum", async () => {
    const coach = await registrarCoach();
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token, "coach", { treinos: true });
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true });

    const r = await request(app).post("/plans/generate").set(auth(aluno.token)).send({}).expect(409);
    // A mensagem explica QUAL profissional escreve O QUÊ — não é um 409 mudo.
    expect(r.body.error).toMatch(/treinador/i);
    expect(r.body.error).toMatch(/nutricionista/i);

    expect(await Plan.countDocuments({ user: aluno.id })).toBe(0);
  });

  it("aluno sem nenhum profissional continua gerando plano pela IA nas três", async () => {
    const aluno = await registrar();
    espiao.proximaResposta = PLANO_GERADO;

    const g = await request(app).post("/plans/generate").set(auth(aluno.token)).send({});
    expect(g.status).toBe(201);

    const a = await request(app).post("/plans/adjust").set(auth(aluno.token)).send({});
    expect(a.status).toBe(201);

    const i = await request(app)
      .post("/plans/import")
      .set(auth(aluno.token))
      .send({ text: "Treino: A - Agachamento 3x10. B - Supino 3x10. Faça 3 vezes por semana." });
    expect(i.status).toBe(201);
  });

  it("preservarAgenda continua valendo quando o treino É escrito", async () => {
    // Regressão: a rota não pode parar de chamar `preservarAgenda` no ramo em
    // que o treino é gerado, só porque agora ele é condicional.
    const aluno = await registrar();
    await criarPlano(aluno.id, {
      workout: {
        ...TREINO_VALIDO,
        sessions: [{ ...TREINO_VALIDO.sessions[0], weekdays: [1, 3, 5] }],
      },
    });
    espiao.proximaResposta = PLANO_GERADO;

    const r = await request(app).post("/plans/generate").set(auth(aluno.token)).send({}).expect(201);

    const sessaoA = (r.body.plan.workout.sessions as { day: string; weekdays?: number[] }[]).find(
      (s) => s.day === "A"
    );
    expect(sessaoA?.weekdays).toEqual([1, 3, 5]);
  });
});

describe("GET /plans/hoje avisa o app: podeEditarDieta", () => {
  it("sem nutricionista, podeEditarDieta é true", async () => {
    const aluno = await registrar();

    const r = await request(app).get("/plans/hoje").set(auth(aluno.token));
    expect(r.body.meta.podeEditarDieta).toBe(true);
  });

  it("com nutricionista, podeEditarDieta é false — e podeEditarPlano não muda", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);

    const r = await request(app).get("/plans/hoje").set(auth(aluno.token));
    expect(r.body.meta.podeEditarDieta).toBe(false);
    expect(r.body.meta.podeEditarPlano).toBe(true);
  });

  it("encerrar o vínculo devolve podeEditarDieta a true", async () => {
    // `papeisAtivosDoAluno` tem o PRÓPRIO filtro `status: "ativo"`
    // (vinculos.ts) — é código novo desta rodada, e diferente de
    // `temProfissional`. O teste de encerramento mais acima passa por
    // `temProfissional` (via `POST /plans/diet`); este cobre o outro caminho.
    const nutri = await registrarNutri();
    const aluno = await registrar();
    const linkId = await vincular(nutri.token, aluno.token);

    const antes = await request(app).get("/plans/hoje").set(auth(aluno.token));
    expect(antes.body.meta.podeEditarDieta).toBe(false);

    const e = await request(app).delete(`/pro/acompanhamentos/${linkId}`).set(auth(aluno.token));
    expect(e.status).toBe(200);

    const depois = await request(app).get("/plans/hoje").set(auth(aluno.token));
    expect(depois.body.meta.podeEditarDieta).toBe(true);
  });
});

describe("o chat do coach IA respeita o nutricionista", () => {
  const falar = (t: string, content = "quero mudar a dieta") =>
    request(app).post("/coach/messages").set(auth(t)).send({ content });

  it("quem tem nutricionista não recebe dietAdjustPending, e o coach avisa para falar com ele", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { workout: TREINO_VALIDO, diet: DIETA_VALIDA });
    espiao.proximaResposta = JSON.stringify({ reply: "vou refazer sua dieta", action: "adjust_diet" });

    const r = await falar(aluno.token).expect(200);

    expect(r.body.dietAdjustPending).toBe(false);
    expect(r.body.reply).toContain("vou refazer sua dieta");
    expect(r.body.reply).toMatch(/nutricionista/i);
  });

  it("sem nutricionista, adjust_diet continua funcionando normalmente", async () => {
    const aluno = await registrar();
    await criarPlano(aluno.id, { workout: TREINO_VALIDO, diet: DIETA_VALIDA });
    espiao.proximaResposta = JSON.stringify({ reply: "vou refazer sua dieta", action: "adjust_diet" });

    const r = await falar(aluno.token).expect(200);

    expect(r.body.dietAdjustPending).toBe(true);
    expect(r.body.reply).toBe("vou refazer sua dieta");
  });
});
