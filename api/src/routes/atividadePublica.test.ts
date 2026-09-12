import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { Post } from "../models/Post.js";
import { Follow } from "../models/Follow.js";

// O perfil passa a contar treinos de verdade e a mostrá-los sem exigir post.
// Nada aqui pode expor treino de quem não escolheu tornar público.

const app = createApp();
let mongod: MongoMemoryServer;
const SENHA = "senha-bem-longa";

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
    User.deleteMany({}), Activity.deleteMany({}),
    Post.deleteMany({}), Follow.deleteMany({}),
  ]);
});

async function registrar(email: string) {
  const r = await request(app).post("/auth/register").send({ name: "Fulano", email, password: SENHA });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Liga a preferência de treinos públicos (o que a pessoa responderia na pergunta). */
async function tornarTreinosPublicos(token: string) {
  await request(app).patch("/auth/settings").set(auth(token)).send({ activitiesPublic: true }).expect(200);
}

async function registrarTreino(token: string, extra: Record<string, unknown> = {}) {
  return request(app).post("/activities").set(auth(token)).send({
    sportId: "musculacao",
    kind: "strength",
    title: "Peito e tríceps",
    durationSec: 4320,
    payload: {
      variant: "musculacao",
      exercises: [
        { name: "Supino reto", sets: [{ type: "valida", weightKg: 60, reps: 10, done: true }] },
      ],
    },
    ...extra,
  });
}

describe("Treino aparece no perfil sem virar post", () => {
  it("o contador de treinos sobe sem publicar nada", async () => {
    const u = await registrar("atleta@teste.com");
    await tornarTreinosPublicos(u.token);

    expect((await registrarTreino(u.token)).status).toBe(201);

    const perfil = await request(app).get(`/social/users/${u.id}`).set(auth(u.token));

    // O que quebrava antes: o rótulo dizia "Treinos" e o número contava posts.
    expect(perfil.body.counts.treinos).toBe(1);
    expect(perfil.body.counts.posts).toBe(0);
    expect(perfil.body.posts).toHaveLength(0);
  });

  it("outra pessoa vê o treino no perfil, mesmo sem seguir", async () => {
    const dono = await registrar("dono@teste.com");
    const visitante = await registrar("visitante@teste.com");
    await tornarTreinosPublicos(dono.token);
    await registrarTreino(dono.token);

    const r = await request(app).get(`/social/users/${dono.id}/activities`).set(auth(visitante.token));

    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].title).toBe("Peito e tríceps");
    expect(r.body.data[0].compartilhado).toBe(false);
  });

  it("marca quais treinos também foram publicados no feed", async () => {
    const u = await registrar("atleta@teste.com");
    await tornarTreinosPublicos(u.token);
    await registrarTreino(u.token, { shareToFeed: true });

    const r = await request(app).get(`/social/users/${u.id}/activities`).set(auth(u.token));
    expect(r.body.data[0].compartilhado).toBe(true);
  });
});

describe("Nada fica público sem escolha", () => {
  it("quem ainda NÃO respondeu a pergunta não expõe treino nenhum", async () => {
    const dono = await registrar("indeciso@teste.com");
    const visitante = await registrar("visitante@teste.com");
    // Sem chamar tornarTreinosPublicos: activitiesPublic segue null.
    await registrarTreino(dono.token);

    const lista = await request(app).get(`/social/users/${dono.id}/activities`).set(auth(visitante.token));
    const perfil = await request(app).get(`/social/users/${dono.id}`).set(auth(visitante.token));

    expect(lista.body.data).toHaveLength(0);
    expect(perfil.body.counts.treinos).toBe(0);
  });

  it("quem respondeu que NÃO continua privado", async () => {
    const dono = await registrar("reservado@teste.com");
    const visitante = await registrar("visitante@teste.com");
    await request(app).patch("/auth/settings").set(auth(dono.token)).send({ activitiesPublic: false });
    await registrarTreino(dono.token);

    const r = await request(app).get(`/social/users/${dono.id}/activities`).set(auth(visitante.token));
    expect(r.body.data).toHaveLength(0);
  });

  it("mas o dono continua vendo os próprios treinos e as estatísticas", async () => {
    const dono = await registrar("reservado@teste.com");
    await request(app).patch("/auth/settings").set(auth(dono.token)).send({ activitiesPublic: false });
    await registrarTreino(dono.token);

    const lista = await request(app).get(`/social/users/${dono.id}/activities`).set(auth(dono.token));
    const proprias = await request(app).get("/activities").set(auth(dono.token));

    expect(lista.body.data).toHaveLength(1);
    expect(proprias.body.data).toHaveLength(1); // histórico privado intacto
  });

  it("treino restrito a seguidores só aparece para quem segue", async () => {
    const dono = await registrar("dono@teste.com");
    const estranho = await registrar("estranho@teste.com");
    const seguidor = await registrar("seguidor@teste.com");
    await tornarTreinosPublicos(dono.token);
    await registrarTreino(dono.token, { visibility: "followers" });
    await request(app).post(`/social/users/${dono.id}/follow`).set(auth(seguidor.token));

    const paraEstranho = await request(app).get(`/social/users/${dono.id}/activities`).set(auth(estranho.token));
    const paraSeguidor = await request(app).get(`/social/users/${dono.id}/activities`).set(auth(seguidor.token));

    expect(paraEstranho.body.data).toHaveLength(0);
    expect(paraSeguidor.body.data).toHaveLength(1);
  });
});

describe("Rota de GPS", () => {
  const corrida = {
    sportId: "corrida",
    kind: "endurance",
    title: "Corrida no parque",
    durationSec: 1938,
    payload: {
      distanceM: 6420,
      points: [
        { lat: -23.5505, lng: -46.6333 },
        { lat: -23.5510, lng: -46.6340 },
        { lat: -23.5515, lng: -46.6350 },
      ],
    },
  };

  it("o traçado NÃO sai para terceiros quando as rotas são privadas", async () => {
    const dono = await registrar("corredor@teste.com");
    const visitante = await registrar("visitante@teste.com");
    await tornarTreinosPublicos(dono.token); // treinos públicos, rotas não
    const criada = await request(app).post("/activities").set(auth(dono.token)).send(corrida);
    const id = criada.body.data.id;

    const detalhe = await request(app).get(`/activities/${id}`).set(auth(visitante.token));
    const lista = await request(app).get(`/social/users/${dono.id}/activities`).set(auth(visitante.token));

    // A corrida aparece; o caminho de casa, não.
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.data.payload.points).toBeUndefined();
    expect(detalhe.body.data.payload.polyline).toBeUndefined();
    expect(lista.body.data[0].payload.points).toBeUndefined();

    // O resultado continua lá: esconder a rota não é esconder o treino.
    expect(detalhe.body.data.metrics.distanceKm).toBeGreaterThan(0);
  });

  it("o dono continua vendo a própria rota", async () => {
    const dono = await registrar("corredor@teste.com");
    const criada = await request(app).post("/activities").set(auth(dono.token)).send(corrida);

    const detalhe = await request(app).get(`/activities/${criada.body.data.id}`).set(auth(dono.token));
    expect(detalhe.body.data.payload.points?.length).toBeGreaterThan(0);
  });

  // Havia um interruptor que liberava o traçado para todo mundo. Ele foi
  // aposentado em 12/09/2026: o mapa diz de que porta a pessoa sai e a que
  // horas, e isso deixou de ser uma escolha de configuração. O GPS existe para
  // ELA registrar onde correu.
  it("nem com o ajuste antigo ligado o traçado sai para outra pessoa", async () => {
    const dono = await registrar("corredor@teste.com");
    const visitante = await registrar("visitante@teste.com");
    await tornarTreinosPublicos(dono.token);
    await request(app).patch("/auth/settings").set(auth(dono.token)).send({ routesPublic: true });
    const criada = await request(app).post("/activities").set(auth(dono.token)).send(corrida);

    const detalhe = await request(app).get(`/activities/${criada.body.data.id}`).set(auth(visitante.token));

    expect(detalhe.body.data.payload.points).toBeUndefined();
    expect(detalhe.body.data.payload.polyline).toBeUndefined();
    // E o treino continua visível: esconder a rota não é esconder a corrida.
    expect(detalhe.body.data.metrics.distanceKm).toBeGreaterThan(0);
  });
});

describe("Compartilhar um treino depois", () => {
  it("cria o post e devolve o id", async () => {
    const u = await registrar("atleta@teste.com");
    const criada = await registrarTreino(u.token);
    const id = criada.body.data.id;

    const r = await request(app).post(`/activities/${id}/share`).set(auth(u.token)).send({});

    expect(r.status).toBe(201);
    expect(r.body.meta.jaCompartilhado).toBe(false);
    expect(await Post.countDocuments({ activity: id })).toBe(1);
  });

  it("compartilhar duas vezes não duplica no feed", async () => {
    const u = await registrar("atleta@teste.com");
    const criada = await registrarTreino(u.token);
    const id = criada.body.data.id;

    await request(app).post(`/activities/${id}/share`).set(auth(u.token)).send({});
    const segunda = await request(app).post(`/activities/${id}/share`).set(auth(u.token)).send({});

    expect(segunda.body.meta.jaCompartilhado).toBe(true);
    expect(await Post.countDocuments({ activity: id })).toBe(1);
  });

  it("ninguém compartilha treino alheio", async () => {
    const dono = await registrar("dono@teste.com");
    const outro = await registrar("outro@teste.com");
    const criada = await registrarTreino(dono.token);

    const r = await request(app).post(`/activities/${criada.body.data.id}/share`).set(auth(outro.token)).send({});
    expect(r.status).toBe(403);
  });
});

describe("Preferências", () => {
  it("começam sem resposta, e é isso que faz o app perguntar", async () => {
    const u = await registrar("novato@teste.com");

    const r = await request(app).get("/auth/settings").set(auth(u.token));
    expect(r.body.data.activitiesPublic).toBeNull();
    expect(r.body.data.routesPublic).toBe(false);
  });

  it("o cartão do perfil traz os exercícios e os músculos, como o do feed", async () => {
    const u = await registrar("atleta@teste.com");
    await tornarTreinosPublicos(u.token);
    await registrarTreino(u.token, {
      payload: {
        variant: "musculacao",
        exercises: [
          {
            name: "Agachamento livre",
            sets: [
              { type: "valida", weightKg: 100, reps: 5, done: true },
              { type: "valida", weightKg: 100, reps: 5, done: true },
            ],
          },
          {
            name: "Panturrilha em pé",
            sets: [{ type: "valida", weightKg: 80, reps: 15, done: true }],
          },
        ],
      },
    });

    const r = await request(app).get(`/social/users/${u.id}/activities`).set(auth(u.token)).expect(200);
    const treino = r.body.data[0];

    // A MESMA linha que o feed e o cartão de compartilhar escrevem.
    expect(treino.movimentos).toEqual([
      "2×5  Agachamento livre  100 kg",
      "1×15  Panturrilha em pé  80 kg",
    ]);
    expect(treino.metrics.musculos).toEqual(["Quadríceps", "Panturrilha"]);
    // O volume continua no dado — o cartão é que não o mostra mais.
    expect(treino.metrics.volumeTotalKg).toBe(2200);
  });

  it("a resposta vale para os treinos seguintes, não para os anteriores", async () => {
    const u = await registrar("atleta@teste.com");

    await registrarTreino(u.token); // antes de responder
    await tornarTreinosPublicos(u.token);
    await registrarTreino(u.token); // depois de responder

    const treinos = await Activity.find({ user: u.id }).sort({ createdAt: 1 });
    expect(treinos[0].visibility).toBe("followers"); // o antigo não mudou sozinho
    expect(treinos[1].visibility).toBe("public");
  });
});
