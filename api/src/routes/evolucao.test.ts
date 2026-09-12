import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { PersonalRecordEvent } from "../models/PersonalRecordEvent.js";

const DIA = 24 * 60 * 60 * 1000;

describe("Evolução", () => {
  const app = createApp();
  let mongod: MongoMemoryServer;
  let token = "";
  let userId = "";

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Asafe", email: "asafe@test.com", password: "senha12345" });
    token = reg.body.token;
    userId = reg.body.user.id;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Activity.deleteMany({});
    // Os recordes também: sem isto, o supino de um teste anterior continua
    // valendo e o treino do teste seguinte deixa de ser recorde sem motivo.
    await PersonalRecord.deleteMany({});
    await PersonalRecordEvent.deleteMany({});
  });

  /** Registra um treino de força pela API, como o app faz. */
  async function treino(
    exercicios: { name: string; exerciseId?: string; sets: { weightKg: number; reps: number }[] }[],
    diasAtras = 0
  ) {
    const r = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sportId: "musculacao",
        kind: "strength",
        startedAt: new Date(Date.now() - diasAtras * DIA).toISOString(),
        durationSec: 3600,
        payload: {
          variant: "musculacao",
          exercises: exercicios.map((e) => ({
            name: e.name,
            exerciseId: e.exerciseId,
            sets: e.sets.map((s) => ({ type: "valida", weightKg: s.weightKg, reps: s.reps, done: true })),
          })),
        },
      });
    expect(r.status).toBe(201);
    return r.body;
  }

  const supino = (peso: number, reps = 5) => ({ name: "Supino reto", sets: [{ weightKg: peso, reps }] });

  /** Registra uma corrida pela API, como o app faz. */
  async function corrida(
    { km, minutos, sportId = "corrida" }: { km: number; minutos: number; sportId?: string },
    diasAtras = 0
  ) {
    const r = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sportId,
        kind: "endurance",
        startedAt: new Date(Date.now() - diasAtras * DIA).toISOString(),
        durationSec: minutos * 60,
        payload: { distanceM: km * 1000 },
      });
    expect(r.status).toBe(201);
    return r.body;
  }

  describe("GET /evolucao/exercicios", () => {
    it("lista o que foi treinado na janela, com o quanto mudou", async () => {
      await treino([supino(80)], 10);
      await treino([supino(90)], 2);

      const r = await request(app)
        .get("/evolucao/exercicios?dias=90")
        .set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data).toHaveLength(1);
      expect(r.body.data[0]).toMatchObject({
        slug: "supino_reto",
        nome: "Supino reto",
        vezes: 2,
        melhor: 90,
        ultimo: 90,
        delta: 10,
      });
      expect(r.body.meta.dias).toBe(90);
    });

    // O motivo de o slug existir: sem ele, isto devolveria dois exercícios.
    it("junta as grafias do mesmo exercício num item só", async () => {
      await treino([{ name: "Supino reto", sets: [{ weightKg: 80, reps: 5 }] }], 10);
      await treino([{ name: "supino  RETO", sets: [{ weightKg: 90, reps: 5 }] }], 1);

      const r = await request(app)
        .get("/evolucao/exercicios?dias=90")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data).toHaveLength(1);
      expect(r.body.data[0].vezes).toBe(2);
      expect(r.body.data[0].delta).toBe(10);
    });

    it("respeita a janela: treino velho demais fica de fora", async () => {
      await treino([supino(80)], 120);
      await treino([{ name: "Agachamento livre", sets: [{ weightKg: 100, reps: 5 }] }], 3);

      const r = await request(app)
        .get("/evolucao/exercicios?dias=30")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data.map((e: { slug: string }) => e.slug)).toEqual(["agachamento_livre"]);
    });

    it("sem delta quando só treinou uma vez — não há de quê", async () => {
      await treino([supino(80)], 1);

      const r = await request(app)
        .get("/evolucao/exercicios")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data[0].delta).toBeNull();
    });

    it("delta negativo quando a carga caiu", async () => {
      await treino([supino(100)], 20);
      await treino([supino(85)], 1);

      const r = await request(app)
        .get("/evolucao/exercicios")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data[0].delta).toBe(-15);
      // O melhor histórico continua sendo o melhor, mesmo tendo piorado depois.
      expect(r.body.data[0].melhor).toBe(100);
    });

    it("exige autenticação", async () => {
      const r = await request(app).get("/evolucao/exercicios");
      expect(r.status).toBe(401);
    });

    // `Number("")` é 0, e 0 aqui significa "tudo": sem tratar, um parâmetro
    // vazio viraria uma varredura do histórico inteiro, em silêncio.
    it("dias vazio cai no padrão, não em 'tudo'", async () => {
      const r = await request(app)
        .get("/evolucao/exercicios?dias=")
        .set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.meta.dias).toBe(90);
    });
  });

  describe("GET /evolucao/exercicios/:slug", () => {
    it("devolve um ponto por treino, em ordem de tempo", async () => {
      await treino([supino(80)], 20);
      await treino([supino(85)], 10);
      await treino([supino(90)], 1);

      const r = await request(app)
        .get("/evolucao/exercicios/supino_reto?dias=90&metrica=carga_max")
        .set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data.map((p: { valor: number }) => p.valor)).toEqual([80, 85, 90]);
      const datas = r.body.data.map((p: { data: string }) => new Date(p.data).getTime());
      expect(datas).toEqual([...datas].sort((a, b) => a - b));
    });

    it("dois treinos no mesmo dia são dois pontos", async () => {
      await treino([supino(80)], 1);
      await treino([supino(85)], 1);

      const r = await request(app)
        .get("/evolucao/exercicios/supino_reto")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data).toHaveLength(2);
    });

    it("volume soma peso x repetições de todas as séries do treino", async () => {
      await treino([{ name: "Supino reto", sets: [{ weightKg: 80, reps: 10 }, { weightKg: 80, reps: 8 }] }], 1);

      const r = await request(app)
        .get("/evolucao/exercicios/supino_reto?metrica=volume")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data[0].valor).toBe(80 * 10 + 80 * 8);
    });

    it("1RM estimado usa a mesma fórmula do recorde (Epley)", async () => {
      await treino([supino(100, 5)], 1);

      const r = await request(app)
        .get("/evolucao/exercicios/supino_reto?metrica=rm_estimado")
        .set("Authorization", `Bearer ${token}`);

      // 100 * (1 + 5/30) = 116,67 → arredondado a uma casa
      expect(r.body.data[0].valor).toBe(116.7);
    });

    it("não inventa ponto de 1RM quando ninguém fez de 1 a 12 reps", async () => {
      await treino([supino(40, 20)], 1);

      const r = await request(app)
        .get("/evolucao/exercicios/supino_reto?metrica=rm_estimado")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data).toHaveLength(0);
    });

    it("marca o ponto em que houve recorde", async () => {
      await treino([supino(80)], 20);
      await treino([supino(90)], 10);

      const r = await request(app)
        .get("/evolucao/exercicios/supino_reto?metrica=carga_max")
        .set("Authorization", `Bearer ${token}`);

      // O primeiro é linha de base, não conquista; o segundo superou.
      expect(r.body.data.map((p: { ehPR: boolean }) => p.ehPR)).toEqual([false, true]);
    });

    it("não marca PR em métrica que não tem recorde", async () => {
      await treino([supino(80)], 20);
      await treino([supino(90)], 10);

      const r = await request(app)
        .get("/evolucao/exercicios/supino_reto?metrica=volume")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data.every((p: { ehPR: boolean }) => p.ehPR === false)).toBe(true);
    });

    it("recusa métrica que não existe", async () => {
      const r = await request(app)
        .get("/evolucao/exercicios/supino_reto?metrica=chute")
        .set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(400);
    });

    it("exercício sem treino nenhum devolve série vazia, não erro", async () => {
      const r = await request(app)
        .get("/evolucao/exercicios/nunca_treinei_isso")
        .set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data).toEqual([]);
    });

    it("não mistura o treino de outra pessoa", async () => {
      const outro = await request(app)
        .post("/auth/register")
        .send({ name: "Outro", email: "outro@test.com", password: "senha12345" });

      await treino([supino(80)], 1);

      const r = await request(app)
        .get("/evolucao/exercicios/supino_reto")
        .set("Authorization", `Bearer ${outro.body.token}`);

      expect(r.body.data).toEqual([]);
    });
  });

  describe("GET /evolucao/grupos", () => {
    it("soma as séries por grupo muscular e devolve os 12 eixos", async () => {
      await treino([{ name: "Supino reto", sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }] }], 1);

      const r = await request(app).get("/evolucao/grupos").set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data).toHaveLength(12);
      const peito = r.body.data.find((g: { grupo: string }) => g.grupo === "Peito");
      expect(peito.series).toBe(2);
    });

    // O eixo zerado é o mais informativo do radar: é a perna que não treinou.
    it("mantém o grupo não treinado com zero, em vez de escondê-lo", async () => {
      await treino([supino(80)], 1);

      const r = await request(app).get("/evolucao/grupos").set("Authorization", `Bearer ${token}`);

      const perna = r.body.data.find((g: { grupo: string }) => g.grupo === "Quadríceps");
      expect(perna).toBeDefined();
      expect(perna.series).toBe(0);
    });
  });

  describe("GET /evolucao/calendario", () => {
    it("conta os treinos do dia e preenche os dias vazios com zero", async () => {
      await treino([supino(80)], 0);
      await treino([supino(85)], 0);
      await treino([supino(90)], 3);

      const r = await request(app)
        .get("/evolucao/calendario?dias=7")
        .set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data).toHaveLength(7);

      const hoje = r.body.data[6];
      expect(hoje.treinos).toBe(2);
      expect(hoje.minutos).toBe(120);

      const total = r.body.data.reduce((s: number, d: { treinos: number }) => s + d.treinos, 0);
      expect(total).toBe(3);
      expect(r.body.data.some((d: { treinos: number }) => d.treinos === 0)).toBe(true);
    });

    it("conta treino de qualquer esporte, não só musculação", async () => {
      await request(app)
        .post("/activities")
        .set("Authorization", `Bearer ${token}`)
        .send({
          sportId: "corrida",
          kind: "endurance",
          startedAt: new Date().toISOString(),
          durationSec: 1800,
          payload: { distanceM: 5000 },
        });

      const r = await request(app)
        .get("/evolucao/calendario?dias=7")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data[6].treinos).toBe(1);
    });

    it("recusa janela fora do limite", async () => {
      const r = await request(app)
        .get("/evolucao/calendario?dias=0")
        .set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(400);
    });
  });

  describe("GET /evolucao/cardio", () => {
    it("lista o esporte, a distância somada e o quanto o pace melhorou", async () => {
      // 10 km em 60 min = 360 s/km; 10 km em 50 min = 300 s/km. Melhorou 60.
      await corrida({ km: 10, minutos: 60 }, 20);
      await corrida({ km: 10, minutos: 50 }, 2);

      const r = await request(app).get("/evolucao/cardio?dias=90").set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data).toHaveLength(1);
      const [c] = r.body.data;
      expect(c.sportId).toBe("corrida");
      expect(c.nome).toBe("Corrida de rua");
      expect(c.vezes).toBe(2);
      expect(c.distanciaKm).toBe(20);
      expect(c.melhorPace).toBe(300);
      expect(c.ultimoPace).toBe(300);
      // Positivo é melhora: o pace CAIU 60 segundos por quilômetro.
      expect(c.delta).toBe(60);
    });

    it("vê a corrida que a aba antiga nunca viu", async () => {
      await corrida({ km: 5, minutos: 30 });

      // Regressão do motivo desta rota existir: `/checkins/cardio-progress` lê
      // `payload.exercises[].sets[].durationMin`, um formato que o aplicativo
      // parou de gravar — uma corrida registrada hoje não aparece lá.
      const antiga = await request(app)
        .get("/checkins/cardio-progress")
        .set("Authorization", `Bearer ${token}`);
      expect(antiga.body.exercises).toHaveLength(0);

      const nova = await request(app).get("/evolucao/cardio").set("Authorization", `Bearer ${token}`);
      expect(nova.body.data).toHaveLength(1);
    });

    it("separa esporte de esporte e respeita a janela", async () => {
      await corrida({ km: 10, minutos: 60 }, 2);
      await corrida({ km: 30, minutos: 60, sportId: "ciclismo" }, 2);
      await corrida({ km: 8, minutos: 50 }, 200);

      const r = await request(app).get("/evolucao/cardio?dias=30").set("Authorization", `Bearer ${token}`);

      expect(r.body.data).toHaveLength(2);
      expect(r.body.data.map((e: { sportId: string }) => e.sportId).sort()).toEqual(["ciclismo", "corrida"]);
      // A corrida de 200 dias atrás ficou de fora: uma sessão só na janela.
      expect(r.body.data.find((e: { sportId: string }) => e.sportId === "corrida").vezes).toBe(1);
    });
  });

  describe("cardio anotado dentro do treino (POST /checkins)", () => {
    /** Faz o check-in de um plano com uma entrada de cardio, como a Home faz. */
    async function checkinComCardio(
      { nome, minutos, km }: { nome: string; minutos: number; km: number },
      diasAtras = 0
    ) {
      const r = await request(app)
        .post("/checkins")
        .set("Authorization", `Bearer ${token}`)
        .send({
          sessionDay: "A — Peito",
          entries: [{ exerciseName: nome, durationMin: minutos, distanceKm: km }],
        });
      expect(r.status).toBe(201);

      // A rota grava sempre com a data de agora; para exercitar a janela é
      // preciso mover no banco, como o resto desta suíte faz.
      if (diasAtras > 0) {
        await Activity.updateOne(
          { _id: r.body.log.id },
          { $set: { startedAt: new Date(Date.now() - diasAtras * DIA) } }
        );
      }
      return r.body;
    }

    it("a esteira do plano aparece na aba de cardio", async () => {
      // Este é o fluxo PRINCIPAL do app: quem segue plano registra a esteira
      // pelo check-in, que grava `kind: "strength"` com durationMin/distanceKm
      // dentro do set. Ler só `endurance` escondia o cardio dessas pessoas.
      await checkinComCardio({ nome: "Esteira", minutos: 30, km: 5 });

      const r = await request(app).get("/evolucao/cardio").set("Authorization", `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.data).toHaveLength(1);
      expect(r.body.data[0].sportId).toBe("esteira");
      expect(r.body.data[0].distanciaKm).toBe(5);
      // 30 min / 5 km = 6:00/km.
      expect(r.body.data[0].melhorPace).toBe(360);
    });

    it("a musculação do mesmo check-in não vira cardio", async () => {
      await request(app)
        .post("/checkins")
        .set("Authorization", `Bearer ${token}`)
        .send({
          sessionDay: "A — Peito",
          entries: [
            { exerciseName: "Supino reto", weightKg: 80, reps: 8 },
            { exerciseName: "Esteira", durationMin: 20, distanceKm: 3 },
          ],
        });

      const r = await request(app).get("/evolucao/cardio").set("Authorization", `Bearer ${token}`);

      // Só a esteira: o supino tem carga, não distância.
      expect(r.body.data.map((e: { sportId: string }) => e.sportId)).toEqual(["esteira"]);
    });

    it("esteira anotada dos dois jeitos vira uma linha só", async () => {
      // A chave do cardio dentro do treino é o slug do exercício, e a da
      // atividade é o sportId. Quando batem, é a mesma coisa — e somar é o
      // certo, senão a pessoa veria "Esteira" duas vezes na lista.
      await checkinComCardio({ nome: "Esteira", minutos: 30, km: 5 }, 3);
      await corrida({ km: 4, minutos: 20, sportId: "esteira" }, 1);

      const r = await request(app).get("/evolucao/cardio").set("Authorization", `Bearer ${token}`);

      expect(r.body.data).toHaveLength(1);
      expect(r.body.data[0].sportId).toBe("esteira");
      expect(r.body.data[0].vezes).toBe(2);
      expect(r.body.data[0].distanciaKm).toBe(9);
      // 20 min / 4 km = 5:00/km, melhor que os 6:00 da esteira do plano.
      expect(r.body.data[0].melhorPace).toBe(300);
      expect(r.body.data[0].delta).toBe(60);
    });

    it("a curva junta as sessões dos dois formatos, em ordem", async () => {
      await checkinComCardio({ nome: "Esteira", minutos: 30, km: 5 }, 5);
      await corrida({ km: 4, minutos: 20, sportId: "esteira" }, 1);

      const r = await request(app)
        .get("/evolucao/cardio/esteira?metrica=pace")
        .set("Authorization", `Bearer ${token}`);

      expect(r.body.data.map((p: { valor: number }) => p.valor)).toEqual([360, 300]);
    });

    it("exercício de força sem cardio nenhum não entra", async () => {
      await treino([supino(80)], 2);

      const r = await request(app).get("/evolucao/cardio").set("Authorization", `Bearer ${token}`);
      expect(r.body.data).toHaveLength(0);
    });
  });

  describe("GET /evolucao/cardio/:sportId", () => {
    it("dá um ponto por sessão, na métrica pedida", async () => {
      await corrida({ km: 10, minutos: 60 }, 10);
      await corrida({ km: 12, minutos: 60 }, 3);

      const pace = await request(app)
        .get("/evolucao/cardio/corrida?metrica=pace")
        .set("Authorization", `Bearer ${token}`);
      expect(pace.status).toBe(200);
      expect(pace.body.data.map((p: { valor: number }) => p.valor)).toEqual([360, 300]);
      // Quem desenha recebe a instrução pronta: neste eixo, menor é melhor.
      expect(pace.body.meta.menorEhMelhor).toBe(true);

      const distancia = await request(app)
        .get("/evolucao/cardio/corrida?metrica=distancia")
        .set("Authorization", `Bearer ${token}`);
      expect(distancia.body.data.map((p: { valor: number }) => p.valor)).toEqual([10, 12]);
      expect(distancia.body.meta.menorEhMelhor).toBe(false);

      const duracao = await request(app)
        .get("/evolucao/cardio/corrida?metrica=duracao")
        .set("Authorization", `Bearer ${token}`);
      expect(duracao.body.data.map((p: { valor: number }) => p.valor)).toEqual([60, 60]);
    });

    it("marca o recorde de distância, e só ele", async () => {
      await corrida({ km: 5, minutos: 30 }, 10);
      await corrida({ km: 9, minutos: 54 }, 2);

      const distancia = await request(app)
        .get("/evolucao/cardio/corrida?metrica=distancia")
        .set("Authorization", `Bearer ${token}`);
      // A segunda corrida superou a primeira: é recorde de distância.
      expect(distancia.body.data.map((p: { ehPR: boolean }) => p.ehPR)).toEqual([false, true]);

      // No pace, nenhum ponto é marcado: `best_time` é por trecho-alvo, não
      // pela sessão, e marcar aqui inventaria uma conquista que não houve.
      const pace = await request(app)
        .get("/evolucao/cardio/corrida?metrica=pace")
        .set("Authorization", `Bearer ${token}`);
      expect(pace.body.data.every((p: { ehPR: boolean }) => p.ehPR === false)).toBe(true);
    });

    it("a sessão sem distância não vira ponto de pace", async () => {
      await corrida({ km: 0, minutos: 40, sportId: "esteira" }, 5);
      await corrida({ km: 6, minutos: 36, sportId: "esteira" }, 1);

      const pace = await request(app)
        .get("/evolucao/cardio/esteira?metrica=pace")
        .set("Authorization", `Bearer ${token}`);
      // Sem quilômetro não há pace: um ponto, não dois com um zero no meio.
      expect(pace.body.data).toHaveLength(1);
      expect(pace.body.data[0].valor).toBe(360);

      const duracao = await request(app)
        .get("/evolucao/cardio/esteira?metrica=duracao")
        .set("Authorization", `Bearer ${token}`);
      // A duração existe nas duas: só o pace é que não dá para calcular.
      expect(duracao.body.data).toHaveLength(2);
    });
  });
});
