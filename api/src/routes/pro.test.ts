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

describe("convite por nome de usuário", () => {
  /** Registra alguém já com @username, que é o que o convite endereçado usa. */
  async function comUsername(username: string) {
    n++;
    const r = await request(app)
      .post("/auth/register")
      .send({ name: `P${n}`, email: `pro${n}@teste.com`, password: "senha-bem-longa", username });
    return { token: r.body.token as string, id: r.body.user.id as string, username };
  }

  it("o coach convida pelo @ e a pessoa recebe", async () => {
    const coach = await registrarProfissional();
    const aluno = await comUsername("joao");

    const r = await request(app)
      .post("/pro/convites")
      .set(auth(coach.token))
      .send({ papel: "coach", username: "joao" });

    expect(r.status).toBe(201);
    expect(r.body.data.enviadoPara.username).toBe("joao");

    const recebidos = await request(app).get("/pro/convites-recebidos").set(auth(aluno.token));
    expect(recebidos.body.data).toHaveLength(1);
    expect(recebidos.body.data[0].code).toBe(r.body.data.code);
  });

  // Um convite PEDE resposta: sem chegar, o coach espera indefinidamente por
  // alguém que nunca soube que foi convidado.
  it("chega como notificação, com o nome de quem convidou", async () => {
    const coach = await registrarProfissional();
    const aluno = await comUsername("maria");

    await request(app)
      .post("/pro/convites")
      .set(auth(coach.token))
      .send({ papel: "coach", username: "maria" });

    const notifs = await request(app).get("/notifications").set(auth(aluno.token));
    const convite = notifs.body.data.find((n: { type: string }) => n.type === "convite_pro");

    expect(convite).toBeTruthy();
    expect(convite.text).toContain("quer te acompanhar");
    expect(convite.targetKind).toBe("convite");
  });

  // O link endereçado tem dono. Se vazar no grupo da academia, não traz a turma.
  it("só o destinatário abre e aceita", async () => {
    const coach = await registrarProfissional();
    const aluno = await comUsername("pedro");
    const intruso = await registrar();

    const r = await request(app)
      .post("/pro/convites")
      .set(auth(coach.token))
      .send({ papel: "coach", username: "pedro" });
    const code = r.body.data.code;

    // Nem descobre de quem era: 404, não 403.
    expect((await request(app).get(`/pro/convites/${code}`).set(auth(intruso.token))).status).toBe(404);
    expect(
      (await request(app).post(`/pro/convites/${code}/aceitar`).set(auth(intruso.token)).send({})).status
    ).toBe(404);

    const ok = await request(app).post(`/pro/convites/${code}/aceitar`).set(auth(aluno.token)).send({});
    expect(ok.status).toBe(201);
  });

  it("username que não existe é 404, e nenhum convite é criado", async () => {
    const coach = await registrarProfissional();

    const r = await request(app)
      .post("/pro/convites")
      .set(auth(coach.token))
      .send({ papel: "coach", username: "nao_existe_ninguem" });

    expect(r.status).toBe(404);
    expect(await ProfessionalInvite.countDocuments()).toBe(0);
  });

  it("não convida quem já é seu aluno", async () => {
    const coach = await registrarProfissional();
    const aluno = await comUsername("repetido");
    await request(app)
      .post("/pro/convites")
      .set(auth(coach.token))
      .send({ papel: "coach", username: "repetido" })
      .then((r) =>
        request(app).post(`/pro/convites/${r.body.data.code}/aceitar`).set(auth(aluno.token)).send({})
      );

    const denovo = await request(app)
      .post("/pro/convites")
      .set(auth(coach.token))
      .send({ papel: "coach", username: "repetido" });

    expect(denovo.status).toBe(409);
  });

  it("nem a si mesmo", async () => {
    const coach = await registrarProfissional();
    const eu = (await User.findById(coach.id))!;
    eu.username = "eumesmo";
    await eu.save();

    const r = await request(app)
      .post("/pro/convites")
      .set(auth(coach.token))
      .send({ papel: "coach", username: "eumesmo" });

    expect(r.status).toBe(400);
  });

  it("aceito o convite, ele some da lista de recebidos", async () => {
    const coach = await registrarProfissional();
    const aluno = await comUsername("some");

    const r = await request(app)
      .post("/pro/convites")
      .set(auth(coach.token))
      .send({ papel: "coach", username: "some" });
    await request(app).post(`/pro/convites/${r.body.data.code}/aceitar`).set(auth(aluno.token)).send({});

    const recebidos = await request(app).get("/pro/convites-recebidos").set(auth(aluno.token));
    expect(recebidos.body.data).toHaveLength(0);
  });

  it("o link aberto continua funcionando para qualquer um", async () => {
    const coach = await registrarProfissional();
    const qualquer = await registrar();

    const r = await request(app).post("/pro/convites").set(auth(coach.token)).send({ papel: "coach" });
    expect(r.body.data.enviadoPara).toBeNull();

    const ok = await request(app)
      .post(`/pro/convites/${r.body.data.code}/aceitar`)
      .set(auth(qualquer.token))
      .send({});
    expect(ok.status).toBe(201);
  });
});

describe("foto na conversa", () => {
  it("mensagem só com foto é válida, e volta com a URL", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    const r = await request(app)
      .post(`/pro/acompanhamentos/${linkId}/mensagens`)
      .set(auth(aluno.token))
      .send({ imageUrl: "https://fitcdn.satriz.club/agachamento.jpg", imageWidth: 1080, imageHeight: 1350 });

    expect(r.status).toBe(201);
    expect(r.body.data.imageUrl).toBe("https://fitcdn.satriz.club/agachamento.jpg");
    expect(r.body.data.texto).toBe("");

    const lido = await request(app)
      .get(`/pro/acompanhamentos/${linkId}/mensagens`)
      .set(auth(coach.token));
    expect(lido.body.data[0].imageWidth).toBe(1080);
  });

  it("foto com legenda continua valendo", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    const r = await request(app)
      .post(`/pro/acompanhamentos/${linkId}/mensagens`)
      .set(auth(aluno.token))
      .send({ imageUrl: "https://fitcdn.satriz.club/x.jpg", texto: "tá certo assim?" });

    expect(r.status).toBe(201);
    expect(r.body.data.texto).toBe("tá certo assim?");
  });
});

describe("avisos do acompanhamento", () => {
  const avisos = (token: string) => request(app).get("/pro/avisos").set(auth(token));

  it("sem nada pendente, vem vazio dos dois lados", async () => {
    const aluno = await registrar();
    const r = await avisos(aluno.token);

    expect(r.status).toBe(200);
    expect(r.body.data.convites).toEqual([]);
    expect(r.body.data.conversas).toEqual([]);
  });

  it("junta convite e mensagem não lida numa requisição só", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    await request(app)
      .post(`/pro/acompanhamentos/${linkId}/mensagens`)
      .set(auth(coach.token))
      .send({ texto: "bom treino" });

    const outro = await registrarProfissional("nutri");
    await request(app)
      .post("/pro/convites")
      .set(auth(outro.token))
      .send({ papel: "nutri" })
      .then((r) =>
        request(app)
          .get(`/pro/convites/${r.body.data.code}`)
          .set(auth(aluno.token))
          .then(() => r)
      );

    const r = await avisos(aluno.token);
    expect(r.body.data.conversas).toHaveLength(1);
    expect(r.body.data.conversas[0].naoLidas).toBe(1);
    expect(r.body.data.conversas[0].profissional.nome).toBeTruthy();
  });

  // Ler a conversa é o que zera o aviso: sem isto, o card ficaria para sempre.
  it("depois de ler, o aviso some", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);
    await request(app)
      .post(`/pro/acompanhamentos/${linkId}/mensagens`)
      .set(auth(coach.token))
      .send({ texto: "oi" });

    expect((await avisos(aluno.token)).body.data.conversas).toHaveLength(1);

    await request(app).get(`/pro/acompanhamentos/${linkId}/mensagens`).set(auth(aluno.token));

    expect((await avisos(aluno.token)).body.data.conversas).toHaveLength(0);
  });

  it("a própria mensagem não vira aviso para quem mandou", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    await request(app)
      .post(`/pro/acompanhamentos/${linkId}/mensagens`)
      .set(auth(aluno.token))
      .send({ texto: "professor?" });

    expect((await avisos(aluno.token)).body.data.conversas).toHaveLength(0);
  });

  it("convite endereçado aparece; aceito, some", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const u = (await User.findById(aluno.id))!;
    u.username = "avisado";
    await u.save();

    const c = await request(app)
      .post("/pro/convites")
      .set(auth(coach.token))
      .send({ papel: "coach", username: "avisado" });

    expect((await avisos(aluno.token)).body.data.convites).toHaveLength(1);

    await request(app)
      .post(`/pro/convites/${c.body.data.code}/aceitar`)
      .set(auth(aluno.token))
      .send({});

    expect((await avisos(aluno.token)).body.data.convites).toHaveLength(0);
  });

  it("não vaza aviso de outra pessoa", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);
    await request(app)
      .post(`/pro/acompanhamentos/${linkId}/mensagens`)
      .set(auth(coach.token))
      .send({ texto: "particular" });

    const estranho = await registrar();
    expect((await avisos(estranho.token)).body.data.conversas).toHaveLength(0);
  });
});

describe("o coach vê o mesmo que o aluno", () => {
  /** Prepara um aluno com treino, para os dois lados terem o que comparar. */
  async function comTreinos() {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    for (const peso of [80, 90]) {
      await request(app)
        .post("/activities")
        .set(auth(aluno.token))
        .send({
          sportId: "musculacao",
          kind: "strength",
          payload: {
            variant: "musculacao",
            exercises: [{ name: "Supino reto", sets: [{ type: "valida", weightKg: peso, reps: 5 }] }],
          },
        });
    }
    return { coach, aluno, linkId };
  }

  it("o radar do coach é o mesmo do aluno", async () => {
    const { coach, aluno } = await comTreinos();

    const doCoach = await request(app)
      .get(`/pro/alunos/${aluno.id}/grupos`)
      .set(auth(coach.token));
    const doAluno = await request(app).get("/evolucao/grupos").set(auth(aluno.token));

    expect(doCoach.status).toBe(200);
    expect(doCoach.body.data).toEqual(doAluno.body.data);
    expect(doCoach.body.data.find((g: { grupo: string }) => g.grupo === "Peito").series).toBe(2);
  });

  it("as conquistas do coach são as mesmas do aluno", async () => {
    const { coach, aluno } = await comTreinos();

    const doCoach = await request(app)
      .get(`/pro/alunos/${aluno.id}/conquistas`)
      .set(auth(coach.token));
    const doAluno = await request(app).get("/prs/historico?limit=30").set(auth(aluno.token));

    expect(doCoach.status).toBe(200);
    expect(doCoach.body.data.length).toBe(doAluno.body.data.length);
    expect(doCoach.body.data[0].exerciseName).toBe("Supino reto");
    expect(doCoach.body.data[0].previousValue).toBe(80);
  });

  it("o calendário é de um ano em qualquer janela, como o do aluno", async () => {
    const { coach, aluno } = await comTreinos();

    // O aluno pede sempre 365 (`MinhasAtividadesScreen`). Seguir a janela dava
    // ao coach 30 casinhas contra o ano inteiro que o aluno vê — e, com a
    // janela em "tudo", `Math.min(0, 365)` pedia ZERO dias.
    for (const dias of [30, 90, 0]) {
      const r = await request(app).get(`/pro/alunos/${aluno.id}?dias=${dias}`).set(auth(coach.token));
      expect(r.status).toBe(200);
      expect(r.body.data.calendario.length).toBe(365);
      expect(r.body.meta.dias).toBe(dias);
    }
  });

  it("as conquistas paginam por cursor, como as do aluno", async () => {
    const { coach, aluno } = await comTreinos();

    const primeira = await request(app)
      .get(`/pro/alunos/${aluno.id}/conquistas?limit=1`)
      .set(auth(coach.token));

    expect(primeira.status).toBe(200);
    expect(primeira.body.data.length).toBe(1);
    expect(primeira.body.meta.nextCursor).toBeTruthy();

    const segunda = await request(app)
      .get(`/pro/alunos/${aluno.id}/conquistas?limit=1&cursor=${encodeURIComponent(primeira.body.meta.nextCursor)}`)
      .set(auth(coach.token));

    expect(segunda.status).toBe(200);
    // Página seguinte é conteúdo NOVO, e não a mesma linha de novo — é o erro
    // que um cursor mal montado comete sem falhar.
    expect(segunda.body.data[0]?.id).not.toBe(primeira.body.data[0].id);
  });

  it("quem é coach E nutri do mesmo aluno não perde o acesso de coach", async () => {
    // Dois vínculos ativos entre as mesmas duas pessoas são estado legítimo: o
    // índice único é {professional, client, papel}. Com um `findOne` sem papel,
    // o vínculo escolhido era o que o banco devolvesse primeiro — e, se viesse
    // o de nutri (que não abre treinos), o próprio treinador levava 403.
    const p = await registrar();
    const u = (await User.findById(p.id))!;
    u.set("pro.coach", { ativo: true, origem: "manual", limiteDeAlunos: 10 });
    u.set("pro.nutri", { ativo: true, origem: "manual", limiteDeAlunos: 10 });
    await u.save();

    const aluno = await registrar();

    // O de nutri PRIMEIRO, de propósito: é a ordem que reproduzia a falha.
    const daNutri = await convite(p.token, "nutri");
    await request(app)
      .post(`/pro/convites/${daNutri}/aceitar`)
      .set(auth(aluno.token))
      .send({ treinos: false, dieta: true });

    const doCoach = await convite(p.token, "coach");
    await request(app).post(`/pro/convites/${doCoach}/aceitar`).set(auth(aluno.token)).send({});

    const perfil = await request(app).get(`/pro/alunos/${aluno.id}`).set(auth(p.token));
    expect(perfil.status).toBe(200);

    const grupos = await request(app).get(`/pro/alunos/${aluno.id}/grupos`).set(auth(p.token));
    expect(grupos.status).toBe(200);

    const prescricao = await request(app)
      .put(`/pro/alunos/${aluno.id}/treino`)
      .set(auth(p.token))
      .send({
        summary: "Semana de adaptação.",
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
      });
    expect(prescricao.status).toBe(201);
  });

  it("a métrica e a janela valem também para o coach", async () => {
    const { coach, aluno } = await comTreinos();

    const volume = await request(app)
      .get(`/pro/alunos/${aluno.id}/exercicios/supino_reto?metrica=volume`)
      .set(auth(coach.token));

    expect(volume.status).toBe(200);
    expect(volume.body.meta.metrica).toBe("volume");
    expect(volume.body.data[0].valor).toBe(400);
  });

  it("aluno que fechou os treinos fecha tudo junto, não só o perfil", async () => {
    const { coach, aluno, linkId } = await comTreinos();
    await request(app)
      .patch(`/pro/acompanhamentos/${linkId}`)
      .set(auth(aluno.token))
      .send({ treinos: false });

    for (const rota of [
      `/pro/alunos/${aluno.id}`,
      `/pro/alunos/${aluno.id}/grupos`,
      `/pro/alunos/${aluno.id}/conquistas`,
      `/pro/alunos/${aluno.id}/exercicios/supino_reto`,
    ]) {
      expect((await request(app).get(rota).set(auth(coach.token))).status).toBe(403);
    }
  });

  it("estranho não alcança nenhuma delas", async () => {
    const { aluno } = await comTreinos();
    const outro = await registrarProfissional();

    for (const rota of [
      `/pro/alunos/${aluno.id}/grupos`,
      `/pro/alunos/${aluno.id}/conquistas`,
    ]) {
      expect((await request(app).get(rota).set(auth(outro.token))).status).toBe(404);
    }
  });
});
