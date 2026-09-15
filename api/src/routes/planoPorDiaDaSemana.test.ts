// O plano ganhou eixo temporal: cada sessão pode dizer em que dias da semana
// acontece. Este arquivo cobre as três rotas novas e — o bloco que mais importa
// — o que acontece com a agenda quando quem reescreve o treino não sabe que ela
// existe. Há um APK em produção que não se atualiza sozinho.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { setAIProvider } from "../services/ai/index.js";
import { User } from "../models/User.js";
import { Plan } from "../models/Plan.js";
import { Profile } from "../models/Profile.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { diaDaSemana, chaveDoDia } from "../utils/dia.js";
import type { AIProvider } from "../services/ai/provider.js";

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const HOJE = diaDaSemana();
const OUTRO_DIA = (HOJE + 3) % 7;

let n = 0;
async function registrar(): Promise<{ token: string; id: string }> {
  n++;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `A${n}`, email: `agenda${n}@teste.com`, password: "senha-bem-longa" });
  return { token: r.body.token, id: r.body.user.id };
}

async function registrarProfissional() {
  const p = await registrar();
  const u = (await User.findById(p.id))!;
  u.set("pro.coach", { ativo: true, origem: "manual", limiteDeAlunos: 10 });
  await u.save();
  return p;
}

async function vincular(coachToken: string, alunoToken: string) {
  const c = await request(app).post("/pro/convites").set(auth(coachToken)).send({ papel: "coach" });
  expect(c.status).toBe(201);
  const r = await request(app)
    .post(`/pro/convites/${c.body.data.code}/aceitar`)
    .set(auth(alunoToken))
    .send({});
  expect(r.status).toBe(201);
}

function exercicio(name = "Agachamento livre") {
  return { name, sets: 3, reps: "8-12", restSeconds: 90, notes: "" };
}

function sessao(day: string, weekdays?: number[], focus = "") {
  return {
    day,
    focus,
    exercises: [exercicio()],
    ...(weekdays === undefined ? {} : { weekdays }),
  };
}

type Sessao = ReturnType<typeof sessao>;

async function semearPlano(userId: string, sessions: Sessao[], extra: Record<string, unknown> = {}) {
  return Plan.create({
    user: userId,
    version: 1,
    summary: "resumo",
    workout: { split: "ABC", daysPerWeek: 3, sessions },
    diet: null,
    disclaimer: "aviso",
    ...extra,
  });
}

async function semearFicha(userId: string) {
  await Profile.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      goal: "ganhar_massa",
      sex: "masculino",
      age: 30,
      heightCm: 178,
      weightKg: 80,
      experienceLevel: "intermediario",
      daysPerWeek: 3,
      sessionMinutes: 60,
      dietaryRestrictions: [],
      injuriesConditions: [],
      notes: "",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/** Um treino de musculação salvo de verdade, pelo caminho que o app usa. */
async function registrarTreino(
  token: string,
  exercises: {
    name: string;
    sets: {
      type?: string;
      weightKg?: number;
      reps?: number | null;
      holdSec?: number;
      durationMin?: number;
    }[];
  }[] = [
    { name: "Supino reto", sets: [{ type: "valida", weightKg: 80, reps: 10 }] },
  ]
) {
  const r = await request(app)
    .post("/activities")
    .set(auth(token))
    .send({ sportId: "musculacao", kind: "strength", payload: { variant: "musculacao", exercises } });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly aceitaImagem = false;
  next = "";
  async generate(): Promise<string> {
    return this.next;
  }
}
const mock = new MockProvider();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(mock);
});

afterAll(async () => {
  setAIProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    Profile.deleteMany({}),
    Activity.deleteMany({}),
    ProfessionalLink.deleteMany({}),
    ProfessionalInvite.deleteMany({}),
  ]);
});

// ------------------------------------------------------------- GET /plans/hoje

describe("GET /plans/hoje", () => {
  it("exige autenticação", async () => {
    expect((await request(app).get("/plans/hoje")).status).toBe(401);
  });

  it("sem plano é 200 com estado sem_plano, e não 404", async () => {
    // Todo 404 aparece em vermelho no console, e "ainda não gerou plano" é o
    // estado normal de quem acabou de se cadastrar.
    const u = await registrar();
    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.status).toBe(200);
    expect(r.body.data.estado).toBe("sem_plano");
    expect(r.body.data.semana).toHaveLength(7);
    expect(r.body.data.semana.every((d: { sessao: unknown }) => d.sessao === null)).toBe(true);
  });

  it("plano só com dieta também é sem_plano — treino vazio não é treino", async () => {
    const u = await registrar();
    await Plan.create({
      user: u.id,
      version: 1,
      summary: "só dieta",
      workout: null,
      diet: { dailyCalories: 2000, macros: { proteinG: 150, carbsG: 200, fatG: 60 }, meals: [], notes: "" },
      disclaimer: "aviso",
    });
    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.estado).toBe("sem_plano");
  });

  it("nenhuma sessão com dia → sem_agenda, com índice para a tela de encaixe", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A"), sessao("Dia B")]);

    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.estado).toBe("sem_agenda");
    expect(r.body.data.sessoes).toHaveLength(2);
    expect(r.body.data.sessoes[0]).toMatchObject({ indice: 0, day: "Dia A", exerciciosCount: 1 });
    expect(r.body.meta.naoAgendadas).toBe(2);
  });

  it("sugere o dia quando ele está escrito no nome, e só então", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Segunda"), sessao("Dia A — Peito e Tríceps"), sessao("Seg/Qui")]);

    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.sessoes[0].sugestao).toEqual([1]);
    expect(r.body.data.sessoes[1].sugestao).toEqual([]);
    expect(r.body.data.sessoes[2].sugestao).toEqual([1, 4]);
    // Sugestão é sugestão: nada foi gravado.
    const plan = await Plan.findOne({ user: u.id });
    const sessions = (plan!.workout as { sessions: { weekdays?: number[] }[] }).sessions;
    expect(sessions.every((s) => s.weekdays === undefined)).toBe(true);
  });

  it("hoje tem sessão → treino_de_hoje com os exercícios inteiros", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [HOJE]), sessao("Dia B", [OUTRO_DIA])]);

    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.estado).toBe("treino_de_hoje");
    expect(r.body.data.sessao.day).toBe("Dia A");
    // A tela de executar precisa do exercício completo, com `kind` preenchido.
    expect(r.body.data.sessao.exercises[0]).toMatchObject({
      name: "Agachamento livre",
      sets: 3,
      reps: "8-12",
      kind: "strength",
    });
  });

  it("as sessões com índice vêm mesmo com a agenda pronta", async () => {
    // Sem isto, escolher os dias uma vez seria escolher para sempre: a tela de
    // mudar os dias não teria de onde montar a grade.
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [HOJE]), sessao("Dia B", [OUTRO_DIA])]);

    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.estado).toBe("treino_de_hoje");
    expect(r.body.data.sessoes).toHaveLength(2);
    expect(r.body.data.sessoes[0]).toMatchObject({ indice: 0, weekdays: [HOJE] });
    expect(r.body.data.sessoes[1]).toMatchObject({ indice: 1, weekdays: [OUTRO_DIA] });
  });

  it("hoje vazio com a semana montada → descanso, e a semana vem junto", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [OUTRO_DIA])]);

    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.estado).toBe("descanso");
    expect(r.body.data.sessao).toBeNull();
    expect(r.body.data.semana[OUTRO_DIA].sessao.day).toBe("Dia A");
    expect(r.body.data.semana[HOJE].sessao).toBeNull();
  });

  it("uma sessão em dois dias aparece nos dois", async () => {
    // ABC em seis dias: A cai na segunda e na quinta. É o caso que obrigou
    // `weekdays` a ser array em vez de um dia só.
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [1, 4])]);

    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.semana[1].sessao.day).toBe("Dia A");
    expect(r.body.data.semana[4].sessao.day).toBe("Dia A");
    expect(r.body.data.semana[2].sessao).toBeNull();
  });

  it("plano parcialmente agendado não volta para a tela de encaixe", async () => {
    // Um coach acrescentando uma quarta sessão não pode jogar o aluno inteiro
    // de volta ao encaixe: o estado é decidido por HOJE, não por completude.
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [HOJE]), sessao("Dia D")]);

    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.estado).toBe("treino_de_hoje");
    expect(r.body.meta.naoAgendadas).toBe(1);
  });

  it("?dia espia outro dia sem mudar qual é hoje", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia B", [OUTRO_DIA])]);

    const r = await request(app).get(`/plans/hoje?dia=${OUTRO_DIA}`).set(auth(u.token));
    expect(r.body.data.estado).toBe("treino_de_hoje");
    expect(r.body.data.diaDaSemana).toBe(OUTRO_DIA);
    expect(r.body.meta.diaDaSemana).toBe(HOJE);
  });

  it("?dia fora da semana é 400", async () => {
    const u = await registrar();
    expect((await request(app).get("/plans/hoje?dia=9").set(auth(u.token))).status).toBe(400);
    expect((await request(app).get("/plans/hoje?dia=abc").set(auth(u.token))).status).toBe(400);
    expect((await request(app).get("/plans/hoje?dia=1.5").set(auth(u.token))).status).toBe(400);
  });

  it("?dia vazio é 400, e não domingo", async () => {
    // `z.coerce.number()` é `Number(x)`, e `Number("") === 0`. Com a coerção
    // crua, numa terça isto devolvia o treino de domingo sem erro nenhum.
    const u = await registrar();
    await semearPlano(u.id, [sessao("Domingo", [0]), sessao("Terça", [2])]);
    expect((await request(app).get("/plans/hoje?dia=").set(auth(u.token))).status).toBe(400);
    expect((await request(app).get("/plans/hoje?dia=%20").set(auth(u.token))).status).toBe(400);
  });

  it("sessoes vem em todo estado, inclusive vazio em sem_plano", async () => {
    const u = await registrar();
    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.sessoes).toEqual([]);
  });

  it("não grava `kind` de volta no documento ao servir o treino de hoje", async () => {
    // `backfillWorkoutKinds` muta in place; a serialização clona antes por isso.
    // Sem este teste, o próximo refactor tira o clone e nada apita.
    const u = await registrar();
    const plan = await semearPlano(u.id, [sessao("Dia A", [HOJE])]);

    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.data.sessao.exercises[0].kind).toBe("strength");

    const relido = await Plan.findById(plan._id);
    const ex = (relido!.workout as { sessions: { exercises: { kind?: string }[] }[] }).sessions[0]!
      .exercises[0]!;
    expect(ex.kind).toBeUndefined();
  });

  it("meta diz o fuso e o dia em São Paulo", async () => {
    const u = await registrar();
    const r = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(r.body.meta.fuso).toBe("America/Sao_Paulo");
    expect(r.body.meta.hoje).toBe(chaveDoDia());
    expect(r.body.meta.diaDaSemana).toBe(HOJE);
    expect(r.body.meta.podeEditarPlano).toBe(true);
  });

  it("quem tem treinador recebe podeEditarPlano falso", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const r = await request(app).get("/plans/hoje").set(auth(aluno.token));
    expect(r.body.meta.podeEditarPlano).toBe(false);
  });
});

// --------------------------------------------------- PUT /plans/current/agenda

describe("PUT /plans/current/agenda", () => {
  it("grava os dias e o treino de hoje passa a existir", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A"), sessao("Dia B")]);

    const r = await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [{ indice: 0, weekdays: [HOJE] }, { indice: 1, weekdays: [OUTRO_DIA] }] });
    expect(r.status).toBe(200);
    expect(r.body.meta.diasOcupados).toBe(2);
    expect(r.body.meta.naoAgendadas).toBe(0);

    const hoje = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(hoje.body.data.estado).toBe("treino_de_hoje");
    expect(hoje.body.data.sessao.day).toBe("Dia A");
  });

  it("persiste no banco — não só no corpo da resposta", async () => {
    // `workout` é Mixed: sem `markModified` a escrita é um no-op silencioso que
    // passaria no teste ingênuo de ler a resposta.
    const u = await registrar();
    const plan = await semearPlano(u.id, [sessao("Dia A")]);

    await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [{ indice: 0, weekdays: [2] }] });

    const relido = await Plan.findById(plan._id);
    const sessions = (relido!.workout as { sessions: { weekdays?: number[] }[] }).sessions;
    expect(sessions[0]!.weekdays).toEqual([2]);
  });

  it("substitui a agenda inteira: sessão não citada fica sem dia", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [1]), sessao("Dia B", [4])]);

    await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [{ indice: 0, weekdays: [1] }] });

    const plan = await Plan.findOne({ user: u.id });
    const sessions = (plan!.workout as { sessions: { weekdays?: number[] }[] }).sessions;
    expect(sessions[0]!.weekdays).toEqual([1]);
    expect(sessions[1]!.weekdays).toEqual([]);
  });

  it("recusa o mesmo dia em duas sessões, e não grava nada", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A"), sessao("Dia B")]);

    const r = await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [{ indice: 0, weekdays: [1] }, { indice: 1, weekdays: [1] }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("Segunda");

    const plan = await Plan.findOne({ user: u.id });
    const sessions = (plan!.workout as { sessions: { weekdays?: number[] }[] }).sessions;
    expect(sessions.every((s) => s.weekdays === undefined)).toBe(true);
  });

  it("índice que não existe é 409", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A")]);
    const r = await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [{ indice: 7, weekdays: [1] }] });
    expect(r.status).toBe(409);
  });

  it("versão diferente da atual é 409", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A")]);
    const r = await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ versao: 99, agenda: [{ indice: 0, weekdays: [1] }] });
    expect(r.status).toBe(409);
  });

  it("dia fora da semana é 400", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A")]);
    const r = await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [{ indice: 0, weekdays: [7] }] });
    expect(r.status).toBe(400);
  });

  it("sem treino para agendar é 404", async () => {
    const u = await registrar();
    const r = await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [] });
    expect(r.status).toBe(404);
  });

  it("quem tem treinador PODE escolher os dias do treino que o coach escreveu", async () => {
    // A guarda de treinador é de AUTORIA. Escolher quando eu treino não é
    // autoria — e bloquear prenderia todo aluno com coach em sem_agenda.
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);
    await semearPlano(aluno.id, [sessao("Dia A")], { createdBy: coach.id });

    const r = await request(app)
      .put("/plans/current/agenda")
      .set(auth(aluno.token))
      .send({ agenda: [{ indice: 0, weekdays: [HOJE] }] });
    expect(r.status).toBe(200);
  });

  it("recusa o mesmo índice duas vezes na grade", async () => {
    // Sem isto o Map de índices ficava com o último e a segunda-feira sumia
    // com 200 OK — engolindo metade do que a pessoa pediu.
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A")]);
    const r = await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [{ indice: 0, weekdays: [1] }, { indice: 0, weekdays: [2] }] });
    expect(r.status).toBe(400);
  });

  it("recusa quando o nome da sessão não bate — os índices deslizaram", async () => {
    // `versao` sozinha não pega: `PUT /plans/current` edita in place e não a
    // incrementa. Sem o nome, os dias cairiam nas sessões erradas em silêncio.
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A"), sessao("Dia B")]);
    const r = await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [{ indice: 0, day: "Dia B", weekdays: [1] }] });
    expect(r.status).toBe(409);
  });

  it("não mexe em daysPerWeek", async () => {
    // Ele é a intenção da ficha e o denominador da adesão; recalcular aqui
    // reescreveria a métrica em silêncio.
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A")]);

    await request(app)
      .put("/plans/current/agenda")
      .set(auth(u.token))
      .send({ agenda: [{ indice: 0, weekdays: [1, 4] }] });

    const plan = await Plan.findOne({ user: u.id });
    expect((plan!.workout as { daysPerWeek: number }).daysPerWeek).toBe(3);
  });
});

// -------------------------------------------------- POST /plans/current/sessoes

describe("POST /plans/current/sessoes", () => {
  it("cria o primeiro plano da pessoa a partir de um treino registrado", async () => {
    const u = await registrar();
    const id = await registrarTreino(u.token);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Peito e tríceps", weekdays: [HOJE] });

    expect(r.status).toBe(201);
    expect(r.body.meta.criouPlano).toBe(true);
    expect(r.body.data.plan.version).toBe(1);
    expect(r.body.data.plan.workout.sessions[0].day).toBe("Peito e tríceps");

    const hoje = await request(app).get("/plans/hoje").set(auth(u.token));
    expect(hoje.body.data.estado).toBe("treino_de_hoje");
  });

  it("ao criar o primeiro plano, a Home para de perguntar como a pessoa treina", async () => {
    const u = await registrar();
    const id = await registrarTreino(u.token);
    await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Meu A", weekdays: [HOJE] });

    const user = await User.findById(u.id);
    expect(user!.get("settings.programacao")).toBe("plano");
  });

  it("preenche a metade de treino de quem só tinha dieta, sem criar versão nova", async () => {
    const u = await registrar();
    await Plan.create({
      user: u.id,
      version: 1,
      summary: "só dieta",
      workout: null,
      diet: { dailyCalories: 2000, macros: { proteinG: 150, carbsG: 200, fatG: 60 }, meals: [], notes: "" },
      disclaimer: "aviso",
    });
    const id = await registrarTreino(u.token);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Meu A", weekdays: [HOJE] });

    expect(r.status).toBe(201);
    expect(r.body.meta.criouPlano).toBe(false);
    expect(r.body.data.plan.version).toBe(1);
    expect(r.body.data.plan.diet.dailyCalories).toBe(2000);
    expect(await Plan.countDocuments({ user: u.id })).toBe(1);
  });

  it("acrescenta ao plano existente sem bumpar a versão", async () => {
    // Bumpar faria todo planLink.planVersion já gravado apontar para "um plano
    // antigo" sem que nada tenha sido prescrito.
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [OUTRO_DIA])]);
    const id = await registrarTreino(u.token);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Dia B", weekdays: [HOJE] });

    expect(r.body.data.plan.version).toBe(1);
    expect(r.body.data.plan.workout.sessions).toHaveLength(2);
    expect(await Plan.countDocuments({ user: u.id })).toBe(1);
  });

  it("converte as séries executadas em prescrição, ignorando aquecimento", async () => {
    const u = await registrar();
    const id = await registrarTreino(u.token, [
      {
        name: "Supino reto",
        sets: [
          { type: "aquecimento", weightKg: 40, reps: 15 },
          { type: "valida", weightKg: 80, reps: 10 },
          { type: "valida", weightKg: 80, reps: 9 },
        ],
      },
    ]);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Meu A", weekdays: [HOJE] });

    const ex = r.body.data.plan.workout.sessions[0].exercises[0];
    expect(ex).toMatchObject({ name: "Supino reto", sets: 2, reps: "10", restSeconds: 60 });
  });

  it("exercício por tempo ou distância não vira série de força vazia", async () => {
    // `strengthSetSchema` aceita tempo e distância de propósito (é como esteira
    // e prancha são anotadas). Carimbar `kind: "strength"` na conversão
    // impediria o classificador de rodar para sempre, e jogar `reps` fora
    // deixava a linha sem número nenhum.
    const u = await registrar();
    const id = await registrarTreino(u.token, [
      { name: "Prancha", sets: [{ type: "valida", holdSec: 45, reps: null }] },
      { name: "Esteira", sets: [{ type: "valida", durationMin: 20, reps: null }] },
    ]);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Meu A", weekdays: [HOJE] });

    const ex = r.body.data.plan.workout.sessions[0].exercises;
    // O tempo vira a prescrição, em vez de virar string vazia.
    expect(ex[0]).toMatchObject({ name: "Prancha", reps: "45s" });
    expect(ex[1]).toMatchObject({ name: "Esteira", reps: "20 min" });
    // E o classificador roda: os dois são medidos em tempo, então o check-in
    // pede duração em vez de carga × repetições. Carimbar "strength" na
    // conversão teria travado os dois como exercício de carga para sempre.
    expect(ex[0].kind).toBe("cardio");
    expect(ex[1].kind).toBe("cardio");
  });

  it("avisa de quem a sessão nova tomou o dia", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [HOJE])]);
    const id = await registrarTreino(u.token);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Dia B", weekdays: [HOJE] });

    expect(r.body.meta.diasTomadosDe).toEqual(["Dia A"]);
  });

  it("nome repetido ganha sufixo — sessionDay precisa ser único", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Meu A", [OUTRO_DIA])]);
    const id = await registrarTreino(u.token);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Meu A", weekdays: [HOJE] });

    expect(r.body.meta.sessionDay).toBe("Meu A (2)");
  });

  it("a sessão nova leva o dia de quem já o tinha", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [HOJE])]);
    const id = await registrarTreino(u.token);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Dia B", weekdays: [HOJE] });

    const sessions = r.body.data.plan.workout.sessions;
    expect(sessions[0].weekdays).toEqual([]);
    expect(sessions[1].weekdays).toEqual([HOJE]);
  });

  it("carimba planLink no treino que semeou a sessão", async () => {
    // Sem isto, o treino que criou a ficha ficaria de fora da adesão a ela.
    const u = await registrar();
    const id = await registrarTreino(u.token);

    await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: id, day: "Meu A", weekdays: [HOJE] });

    const a = await Activity.findById(id);
    expect(a!.planLink).toMatchObject({ planVersion: 1, sessionDay: "Meu A" });
  });

  it("treino de outra pessoa é 404", async () => {
    const dono = await registrar();
    const outro = await registrar();
    const id = await registrarTreino(dono.token);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(outro.token))
      .send({ activityId: id, day: "Meu A", weekdays: [HOJE] });
    expect(r.status).toBe(404);
  });

  it("id inválido é 400", async () => {
    const u = await registrar();
    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: "nao-e-id", weekdays: [HOJE] });
    expect(r.status).toBe(400);
  });

  it("atividade que não é musculação é 400", async () => {
    const u = await registrar();
    const corrida = await request(app)
      .post("/activities")
      .set(auth(u.token))
      .send({ sportId: "corrida", kind: "endurance", durationSec: 1800, payload: { distanceM: 5000 } });
    expect(corrida.status).toBe(201);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(u.token))
      .send({ activityId: corrida.body.data.id, weekdays: [HOJE] });
    expect(r.status).toBe(400);
  });

  it("quem tem treinador não acrescenta sessão à prescrição", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);
    const id = await registrarTreino(aluno.token);

    const r = await request(app)
      .post("/plans/current/sessoes")
      .set(auth(aluno.token))
      .send({ activityId: id, day: "Meu A", weekdays: [HOJE] });
    expect(r.status).toBe(409);
  });
});

// ------------------------------------- a agenda sobrevive a quem não a conhece

describe("a agenda sobrevive a quem não a conhece", () => {
  /** O corpo que o APK instalado manda: sem `weekdays`, porque ele não sabe dele. */
  function comoOAppAntigo(sessions: { day: string; focus?: string }[]) {
    return {
      workout: {
        split: "ABC",
        daysPerWeek: 3,
        sessions: sessions.map((s) => ({
          day: s.day,
          focus: s.focus ?? "",
          exercises: [exercicio()],
        })),
      },
    };
  }

  async function diasGravados(userId: string): Promise<(number[] | undefined)[]> {
    const plan = await Plan.findOne({ user: userId }).sort({ version: -1 });
    return (plan!.workout as { sessions: { weekdays?: number[] }[] }).sessions.map((s) => s.weekdays);
  }

  it("PUT /plans/current do app antigo preserva a agenda", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [1]), sessao("Dia B", [4])]);

    const r = await request(app)
      .put("/plans/current")
      .set(auth(u.token))
      .send(comoOAppAntigo([{ day: "Dia A" }, { day: "Dia B" }]));
    expect(r.status).toBe(200);
    expect(await diasGravados(u.id)).toEqual([[1], [4]]);
  });

  it("weekdays vazio no PUT limpa de propósito", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [1])]);

    await request(app)
      .put("/plans/current")
      .set(auth(u.token))
      .send({ workout: { split: "ABC", daysPerWeek: 3, sessions: [sessao("Dia A", [])] } });

    expect(await diasGravados(u.id)).toEqual([[]]);
  });

  it("sessão renomeada perde o dia, e o resto continua", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [1]), sessao("Dia B", [4])]);

    await request(app)
      .put("/plans/current")
      .set(auth(u.token))
      .send(comoOAppAntigo([{ day: "Peito" }, { day: "Dia B" }]));

    expect(await diasGravados(u.id)).toEqual([undefined, [4]]);
  });

  it("sessão nova entra sem dia, sem roubar o de ninguém", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [1])]);

    await request(app)
      .put("/plans/current")
      .set(auth(u.token))
      .send(comoOAppAntigo([{ day: "Dia A" }, { day: "Dia C" }]));

    expect(await diasGravados(u.id)).toEqual([[1], undefined]);
  });

  it("POST /plans/adjust preserva a agenda das sessões de mesmo nome", async () => {
    // A IA reescreve o treino inteiro. É o escritor que menos parece um
    // escritor de workout, e o que mais facilmente passaria despercebido.
    const u = await registrar();
    await semearFicha(u.id);
    await semearPlano(u.id, [sessao("Dia A", [1]), sessao("Dia B", [4])]);
    await request(app).post("/billing/dev-upgrade").set(auth(u.token));

    mock.next = JSON.stringify({
      summary: "reajustado",
      workout: {
        split: "ABC",
        daysPerWeek: 3,
        sessions: [
          { day: "Dia A", focus: "", exercises: [exercicio()] },
          { day: "Dia B", focus: "", exercises: [exercicio("Terra")] },
        ],
      },
      diet: {
        dailyCalories: 2000,
        macros: { proteinG: 150, carbsG: 200, fatG: 60 },
        meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3" }] }],
        notes: "",
      },
      disclaimer: "aviso",
    });

    const r = await request(app).post("/plans/adjust").set(auth(u.token)).send({});
    expect(r.status).toBe(201);
    expect(await diasGravados(u.id)).toEqual([[1], [4]]);
  });

  it("regenerar o plano pela IA preserva a agenda das sessões de mesmo nome", async () => {
    // "Plano novo, nada a preservar" só vale para a PRIMEIRA geração. Quem é
    // premium regenera por cima de um plano que já existe — e é o botão que a
    // Home oferece justamente a quem paga.
    const u = await registrar();
    await semearFicha(u.id);
    await semearPlano(u.id, [sessao("Dia A", [1]), sessao("Dia B", [4])]);
    await request(app).post("/billing/dev-upgrade").set(auth(u.token));

    mock.next = JSON.stringify({
      summary: "novo",
      workout: {
        split: "ABC",
        daysPerWeek: 3,
        sessions: [
          { day: "Dia A", focus: "", exercises: [exercicio()] },
          { day: "Dia B", focus: "", exercises: [exercicio("Terra")] },
        ],
      },
      diet: {
        dailyCalories: 2000,
        macros: { proteinG: 150, carbsG: 200, fatG: 60 },
        meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3" }] }],
        notes: "",
      },
      disclaimer: "aviso",
    });

    const r = await request(app).post("/plans/generate").set(auth(u.token)).send({});
    expect(r.status).toBe(201);
    expect(await diasGravados(u.id)).toEqual([[1], [4]]);
  });

  it("a prescrição do coach preserva a agenda que o aluno montou", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);
    await semearPlano(aluno.id, [sessao("Dia A", [1])], { createdBy: coach.id });

    const r = await request(app)
      .put(`/pro/alunos/${aluno.id}/treino`)
      .set(auth(coach.token))
      .send({
        summary: "novo bloco",
        workout: {
          split: "ABC",
          daysPerWeek: 3,
          sessions: [{ day: "Dia A", focus: "", exercises: [exercicio("Terra")] }],
        },
      });
    expect(r.status).toBe(201);
    expect(await diasGravados(aluno.id)).toEqual([[1]]);
  });

  it("GET /plans/current continua no envelope antigo e agora carrega weekdays", async () => {
    const u = await registrar();
    await semearPlano(u.id, [sessao("Dia A", [1])]);

    const r = await request(app).get("/plans/current").set(auth(u.token));
    expect(r.status).toBe(200);
    expect(r.body.plan.workout.sessions[0].weekdays).toEqual([1]);
    // O `kind` continua sendo preenchido na serialização, e o clone que faz
    // isso não pode comer o campo novo junto.
    expect(r.body.plan.workout.sessions[0].exercises[0].kind).toBe("strength");
  });
});
