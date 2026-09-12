import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { Plan } from "../models/Plan.js";

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

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
  ]);
});

async function convite(token: string, papel: "coach" | "nutri" = "coach", usos = 1) {
  const r = await request(app).post("/pro/convites").set(auth(token)).send({ papel, usos });
  expect(r.status).toBe(201);
  return r.body.data.code as string;
}

async function vincular(coachToken: string, alunoToken: string, escopo = {}) {
  const code = await convite(coachToken);
  const r = await request(app)
    .post(`/pro/convites/${code}/aceitar`)
    .set(auth(alunoToken))
    .send(escopo);
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

describe("acesso ao painel", () => {
  it("quem não é profissional não passa", async () => {
    const qualquer = await registrar();

    for (const [metodo, rota] of [
      ["get", "/pro/me"],
      ["get", "/pro/alunos"],
      ["get", "/pro/convites"],
    ] as const) {
      const r = await request(app)[metodo](rota).set(auth(qualquer.token));
      expect(r.status).toBe(403);
    }
    const post = await request(app).post("/pro/convites").set(auth(qualquer.token)).send({ papel: "coach" });
    expect(post.status).toBe(403);
  });

  it("sem token, 401", async () => {
    expect((await request(app).get("/pro/alunos")).status).toBe(401);
  });

  // O acesso é lido do documento a cada requisição: revogar tem efeito na hora,
  // sem esperar token expirar.
  it("revogar a capacidade fecha o painel imediatamente", async () => {
    const coach = await registrarProfissional();
    expect((await request(app).get("/pro/me").set(auth(coach.token))).status).toBe(200);

    const u = (await User.findById(coach.id))!;
    u.set("pro.coach.ativo", false);
    await u.save();

    expect((await request(app).get("/pro/me").set(auth(coach.token))).status).toBe(403);
  });

  it("o painel diz o teto e quantos alunos já entraram", async () => {
    const coach = await registrarProfissional("coach", 10);
    await vincular(coach.token, (await registrar()).token);

    const r = await request(app).get("/pro/me").set(auth(coach.token));
    expect(r.body.data.capacidades).toEqual([{ papel: "coach", ativo: true, limite: 10, alunos: 1 }]);
  });
});

describe("convite e aceite pela API", () => {
  it("o aluno vê de quem é o convite antes de aceitar", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const code = await convite(coach.token);

    const r = await request(app).get(`/pro/convites/${code}`).set(auth(aluno.token));

    expect(r.status).toBe(200);
    expect(r.body.data.profissional.id).toBe(coach.id);
    expect(r.body.data.jaVinculado).toBe(false);
  });

  it("aceitar cria o vínculo, e o aluno passa a ver quem o acompanha", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const meus = await request(app).get("/pro/acompanhamentos").set(auth(aluno.token));
    expect(meus.body.data).toHaveLength(1);
    expect(meus.body.data[0].profissional.id).toBe(coach.id);
    expect(meus.body.data[0].escopo.treinos).toBe(true);
    expect(meus.body.data[0].escopo.fotos).toBe(false);
  });

  it("o aluno muda o escopo e sai quando quiser", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    const patch = await request(app)
      .patch(`/pro/acompanhamentos/${linkId}`)
      .set(auth(aluno.token))
      .send({ medidas: true });
    expect(patch.body.data.escopo.medidas).toBe(true);

    const del = await request(app).delete(`/pro/acompanhamentos/${linkId}`).set(auth(aluno.token));
    expect(del.body.data.status).toBe("encerrado");

    const depois = await request(app).get("/pro/acompanhamentos").set(auth(aluno.token));
    expect(depois.body.data).toHaveLength(0);
  });

  it("o profissional revoga um convite que ainda não foi usado", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const code = await convite(coach.token);

    await request(app).delete(`/pro/convites/${code}`).set(auth(coach.token)).expect(200);

    const r = await request(app).post(`/pro/convites/${code}/aceitar`).set(auth(aluno.token)).send({});
    expect(r.status).toBe(410);
  });

  it("um coach não revoga convite de outro", async () => {
    const a = await registrarProfissional();
    const b = await registrarProfissional();
    const code = await convite(a.token);

    expect((await request(app).delete(`/pro/convites/${code}`).set(auth(b.token))).status).toBe(404);
  });

  it("lotado, o convite não sai", async () => {
    const coach = await registrarProfissional("coach", 1);
    await vincular(coach.token, (await registrar()).token);

    const r = await request(app).post("/pro/convites").set(auth(coach.token)).send({ papel: "coach" });
    expect(r.status).toBe(409);
  });
});

describe("a lista de alunos", () => {
  it("mostra quando cada um treinou pela última vez", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    await request(app)
      .post("/activities")
      .set(auth(aluno.token))
      .send({
        sportId: "musculacao",
        kind: "strength",
        payload: { variant: "musculacao", exercises: [{ name: "Supino", sets: [{ type: "valida", weightKg: 80, reps: 5 }] }] },
      });

    const r = await request(app).get("/pro/alunos").set(auth(coach.token));

    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].aluno.id).toBe(aluno.id);
    expect(r.body.data[0].treinos.naSemana).toBe(1);
    expect(r.body.data[0].treinos.ultimoEm).toBeTruthy();
  });

  // A diferença entre "não treinou" e "não me deixou ver" é o que o
  // profissional precisa saber — zero nos dois casos seria mentira.
  it("aluno que fechou os treinos aparece sem números, não com zero", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);
    await request(app)
      .patch(`/pro/acompanhamentos/${linkId}`)
      .set(auth(aluno.token))
      .send({ treinos: false });

    const r = await request(app).get("/pro/alunos").set(auth(coach.token));
    expect(r.body.data[0].treinos).toBeNull();
  });

  it("cada coach vê só os próprios alunos", async () => {
    const a = await registrarProfissional();
    const b = await registrarProfissional();
    await vincular(a.token, (await registrar()).token);

    const r = await request(app).get("/pro/alunos").set(auth(b.token));
    expect(r.body.data).toHaveLength(0);
  });
});

describe("o perfil do aluno", () => {
  it("traz a evolução e a constância de quem autorizou", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    for (const peso of [80, 90]) {
      await request(app)
        .post("/activities")
        .set(auth(aluno.token))
        .send({
          sportId: "musculacao",
          kind: "strength",
          payload: { variant: "musculacao", exercises: [{ name: "Supino reto", sets: [{ type: "valida", weightKg: peso, reps: 5 }] }] },
        });
    }

    const r = await request(app).get(`/pro/alunos/${aluno.id}`).set(auth(coach.token));

    expect(r.status).toBe(200);
    expect(r.body.data.aluno.id).toBe(aluno.id);
    expect(r.body.data.exercicios[0].slug).toBe("supino_reto");
    expect(r.body.data.exercicios[0].melhor).toBe(90);
    expect(r.body.data.constancia.total).toBe(2);
    expect(Array.isArray(r.body.data.calendario)).toBe(true);
  });

  it("quem não é meu aluno é 404, não uma página vazia", async () => {
    const coach = await registrarProfissional();
    const estranho = await registrar();

    const r = await request(app).get(`/pro/alunos/${estranho.id}`).set(auth(coach.token));
    expect(r.status).toBe(404);
  });

  it("aluno que fechou os treinos dá 403 — diferente de não ter treinado", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);
    await request(app)
      .patch(`/pro/acompanhamentos/${linkId}`)
      .set(auth(aluno.token))
      .send({ treinos: false });

    const r = await request(app).get(`/pro/alunos/${aluno.id}`).set(auth(coach.token));
    expect(r.status).toBe(403);
  });

  it("depois de encerrado, o perfil fecha", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    await request(app).delete(`/pro/alunos/${linkId}`).set(auth(coach.token)).expect(200);

    const r = await request(app).get(`/pro/alunos/${aluno.id}`).set(auth(coach.token));
    expect(r.status).toBe(404);
  });

  it("id inválido não derruba a rota", async () => {
    const coach = await registrarProfissional();
    const r = await request(app).get("/pro/alunos/nao-e-um-id").set(auth(coach.token));
    expect(r.status).toBe(404);
  });
});

describe("prescrição de treino", () => {
  const treinoAB = {
    summary: "Semana de adaptação, foco em técnica.",
    workout: {
      split: "AB",
      daysPerWeek: 3,
      sessions: [
        {
          day: "A — Peito",
          focus: "Superior",
          exercises: [{ name: "Supino reto", sets: 4, reps: "8-12", restSeconds: 90, notes: "" }],
        },
      ],
    },
  };

  it("o coach escreve o treino e o aluno passa a ver na Home dele", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const r = await request(app)
      .put(`/pro/alunos/${aluno.id}/treino`)
      .set(auth(coach.token))
      .send(treinoAB);

    expect(r.status).toBe(201);
    expect(r.body.data.version).toBe(1);

    const doAluno = await request(app).get("/plans/current").set(auth(aluno.token));
    expect(doAluno.status).toBe(200);
    expect(doAluno.body.plan.workout.split).toBe("AB");
    // O aluno sabe que não foi a IA que mudou o treino dele.
    expect(doAluno.body.plan.createdBy).toBe(coach.id);
  });

  // `Activity.planLink` aponta para o NÚMERO da versão: reescrever a versão
  // corrente faria o treino já executado passar a dizer que era outro.
  it("cada prescrição é uma versão nova, não uma edição da anterior", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    await request(app).put(`/pro/alunos/${aluno.id}/treino`).set(auth(coach.token)).send(treinoAB);
    const segunda = await request(app)
      .put(`/pro/alunos/${aluno.id}/treino`)
      .set(auth(coach.token))
      .send({ ...treinoAB, summary: "Subindo a carga." });

    expect(segunda.body.data.version).toBe(2);
    expect(await Plan.countDocuments({ user: new mongoose.Types.ObjectId(aluno.id) })).toBe(2);
  });

  // As duas metades do plano são independentes. Prescrever treino não é motivo
  // para apagar a comida de ninguém.
  it("não encosta na dieta que já existe", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const dieta = {
      dailyCalories: 2200,
      macros: { proteinG: 160, carbsG: 220, fatG: 70 },
      meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3" }] }],
      notes: "",
    };
    await Plan.create({
      user: new mongoose.Types.ObjectId(aluno.id),
      version: 1,
      summary: "só dieta",
      diet: dieta,
      disclaimer: "aviso",
    });

    await request(app).put(`/pro/alunos/${aluno.id}/treino`).set(auth(coach.token)).send(treinoAB);

    const doAluno = await request(app).get("/plans/current").set(auth(aluno.token));
    expect(doAluno.body.plan.diet.dailyCalories).toBe(2200);
    expect(doAluno.body.plan.workout.split).toBe("AB");
  });

  it("não dá para prescrever para quem não é seu aluno", async () => {
    const coach = await registrarProfissional();
    const estranho = await registrar();

    const r = await request(app)
      .put(`/pro/alunos/${estranho.id}/treino`)
      .set(auth(coach.token))
      .send(treinoAB);
    expect(r.status).toBe(404);
  });

  it("aluno que fechou os treinos não recebe prescrição", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);
    await request(app)
      .patch(`/pro/acompanhamentos/${linkId}`)
      .set(auth(aluno.token))
      .send({ treinos: false });

    const r = await request(app)
      .put(`/pro/alunos/${aluno.id}/treino`)
      .set(auth(coach.token))
      .send(treinoAB);
    expect(r.status).toBe(403);
  });

  // Quem acompanha a dieta não prescreve treino: o papel diz o que a pessoa faz.
  it("nutri não prescreve treino", async () => {
    const nutri = await registrarProfissional("nutri");
    const aluno = await registrar();
    const code = await convite(nutri.token, "nutri");
    await request(app).post(`/pro/convites/${code}/aceitar`).set(auth(aluno.token)).send({});

    const r = await request(app)
      .put(`/pro/alunos/${aluno.id}/treino`)
      .set(auth(nutri.token))
      .send(treinoAB);
    expect(r.status).toBe(403);
  });

  it("treino malformado é recusado na borda", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const r = await request(app)
      .put(`/pro/alunos/${aluno.id}/treino`)
      .set(auth(coach.token))
      .send({ summary: "x", workout: { split: "AB", daysPerWeek: 3, sessions: [] } });
    expect(r.status).toBe(400);
  });
});

describe("conversa", () => {
  async function dupla() {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);
    return { coach, aluno, linkId };
  }

  const mandar = (token: string, linkId: string, body: Record<string, unknown>) =>
    request(app).post(`/pro/acompanhamentos/${linkId}/mensagens`).set(auth(token)).send(body);

  const ler = (token: string, linkId: string, query = "") =>
    request(app).get(`/pro/acompanhamentos/${linkId}/mensagens${query}`).set(auth(token));

  it("os dois lados falam na mesma conversa", async () => {
    const { coach, aluno, linkId } = await dupla();

    await mandar(coach.token, linkId, { texto: "Bom treino hoje!" }).expect(201);
    await mandar(aluno.token, linkId, { texto: "Valeu, professor" }).expect(201);

    const doCoach = await ler(coach.token, linkId);
    const doAluno = await ler(aluno.token, linkId);

    expect(doCoach.body.data).toHaveLength(2);
    expect(doAluno.body.data).toHaveLength(2);
    // Mais recente primeiro.
    expect(doCoach.body.data[0].texto).toBe("Valeu, professor");
  });

  it("aceita foto, que é metade da conversa real", async () => {
    const { aluno, linkId } = await dupla();

    const r = await mandar(aluno.token, linkId, {
      imageUrl: "https://fitcdn.satriz.club/x.jpg",
      imageWidth: 1080,
      imageHeight: 1350,
    });

    expect(r.status).toBe(201);
    expect(r.body.data.imageUrl).toBe("https://fitcdn.satriz.club/x.jpg");
  });

  it("mensagem vazia não passa", async () => {
    const { coach, linkId } = await dupla();
    expect((await mandar(coach.token, linkId, {})).status).toBe(400);
    expect((await mandar(coach.token, linkId, { texto: "   " })).status).toBe(400);
  });

  it("estranho não lê nem escreve na conversa dos outros", async () => {
    const { linkId } = await dupla();
    const estranho = await registrar();

    expect((await ler(estranho.token, linkId)).status).toBe(404);
    expect((await mandar(estranho.token, linkId, { texto: "oi" })).status).toBe(404);
  });

  // Marcar as próprias como lidas seria dizer que a pessoa leu o que ela mesma
  // escreveu — e a bolinha do outro lado nunca apareceria.
  it("abrir a conversa marca como lida só o que o outro mandou", async () => {
    const { coach, aluno, linkId } = await dupla();
    await mandar(coach.token, linkId, { texto: "Oi" });

    const antes = await request(app).get("/pro/nao-lidas").set(auth(aluno.token));
    expect(antes.body.meta.total).toBe(1);

    // O próprio coach abrindo não zera a do aluno.
    await ler(coach.token, linkId);
    expect((await request(app).get("/pro/nao-lidas").set(auth(aluno.token))).body.meta.total).toBe(1);

    await ler(aluno.token, linkId);
    expect((await request(app).get("/pro/nao-lidas").set(auth(aluno.token))).body.meta.total).toBe(0);
  });

  it("pagina por cursor sem repetir mensagem", async () => {
    const { coach, aluno, linkId } = await dupla();
    for (let i = 0; i < 5; i++) await mandar(coach.token, linkId, { texto: `msg ${i}` });

    const p1 = await ler(aluno.token, linkId, "?limit=2");
    expect(p1.body.data).toHaveLength(2);

    const p2 = await ler(aluno.token, linkId, `?limit=2&cursor=${encodeURIComponent(p1.body.meta.nextCursor)}`);
    const ids = [...p1.body.data, ...p2.body.data].map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(4);
  });

  // O histórico é dos dois. Encerrar fecha a porta, não queima o arquivo.
  it("encerrado, a conversa fica legível mas ninguém escreve mais", async () => {
    const { coach, aluno, linkId } = await dupla();
    await mandar(coach.token, linkId, { texto: "última" });

    await request(app).delete(`/pro/acompanhamentos/${linkId}`).set(auth(aluno.token)).expect(200);

    const lido = await ler(aluno.token, linkId);
    expect(lido.status).toBe(200);
    expect(lido.body.data).toHaveLength(1);
    expect(lido.body.meta.encerrado).toBe(true);

    expect((await mandar(coach.token, linkId, { texto: "oi?" })).status).toBe(409);
  });
});

describe("a curva de um exercício do aluno", () => {
  it("devolve a mesma série que o aluno vê na aba dele", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    for (const peso of [80, 90]) {
      await request(app)
        .post("/activities")
        .set(auth(aluno.token))
        .send({
          sportId: "musculacao",
          kind: "strength",
          payload: { variant: "musculacao", exercises: [{ name: "Supino reto", sets: [{ type: "valida", weightKg: peso, reps: 5 }] }] },
        });
    }

    const doCoach = await request(app)
      .get(`/pro/alunos/${aluno.id}/exercicios/supino_reto`)
      .set(auth(coach.token));
    const doAluno = await request(app)
      .get("/evolucao/exercicios/supino_reto")
      .set(auth(aluno.token));

    expect(doCoach.status).toBe(200);
    expect(doCoach.body.data.map((p: { valor: number }) => p.valor)).toEqual([80, 90]);
    expect(doCoach.body.data).toEqual(doAluno.body.data);
  });

  it("estranho não puxa a curva de ninguém", async () => {
    const coach = await registrarProfissional();
    const estranho = await registrar();

    const r = await request(app)
      .get(`/pro/alunos/${estranho.id}/exercicios/supino_reto`)
      .set(auth(coach.token));
    expect(r.status).toBe(404);
  });
});
