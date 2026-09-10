import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { Plan } from "../models/Plan.js";

// Existe um APK distribuído para pessoas reais que manda e lê o formato ANTIGO.
// Elas não atualizam. Cada teste aqui defende uma coisa que já quebrou uma vez.

const app = createApp();
let mongod: MongoMemoryServer;

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
    PersonalRecord.deleteMany({}),
    Plan.deleteMany({}),
  ]);
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let n = 0;
async function registrar() {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Pessoa ${n}`, email: `p${n}@teste.com`, password: "senha-bem-longa" });
  return { token: r.body.token as string, id: new mongoose.Types.ObjectId(r.body.user.id as string) };
}

/** Exatamente o corpo que o APK antigo monta em RegisterWodScreen. */
function wodAntigo(extra: Record<string, unknown> = {}) {
  return {
    sportId: "crossfit",
    kind: "wod",
    payload: { name: "Treino A", scoreType: "for_time", level: "rx", resultTimeSec: 300, ...extra },
  };
}

const registrarWod = (t: string, corpo: Record<string, unknown>) =>
  request(app).post("/activities").set(auth(t)).send(corpo);

const prs = (user: mongoose.Types.ObjectId) => PersonalRecord.find({ user }).lean();

describe("O APK antigo continua funcionando", () => {
  it("o payload no formato antigo continua sendo aceito", async () => {
    const u = await registrar();
    await registrarWod(u.token, wodAntigo()).expect(201);
  });

  it("WOD com nome livre AINDA gera recorde", async () => {
    const u = await registrar();
    await registrarWod(u.token, wodAntigo({ resultTimeSec: 300 }));
    await registrarWod(u.token, wodAntigo({ resultTimeSec: 280 }));

    // Eu tinha passado a exigir benchmark do catálogo, e isso parou de atualizar
    // o recorde de quem chama o WOD de "Treino A" — silenciosamente.
    const lista = await prs(u.id);
    const wod = lista.find((p) => p.type === "wod_time");
    expect(wod).toBeDefined();
    expect(wod!.value).toBe(280);
  });

  it("AMRAP grava o recorde em ROUNDS, como sempre gravou", async () => {
    const u = await registrar();
    await registrarWod(
      u.token,
      wodAntigo({ scoreType: "amrap", resultTimeSec: null, resultRounds: 15 })
    );

    const wod = (await prs(u.id)).find((p) => p.type === "wod_score");
    // Eu tinha trocado para o total de reps sob a MESMA chave: um "15 rounds"
    // já gravado viraria alvo de um "150 reps" e celebraria recorde falso.
    expect(wod?.unit).toBe("rounds");
    expect(wod?.value).toBe(15);
  });

  it('nível "adaptado" mantém a chave que já está gravada', async () => {
    const u = await registrar();
    await registrarWod(u.token, wodAntigo({ level: "adaptado" }));

    const wod = (await prs(u.id)).find((p) => p.type === "wod_time");
    // Converter para "custom" criaria um recorde novo ao lado do antigo, e a
    // pessoa veria duplicata.
    expect(wod?.repRange).toBe("adaptado");
  });

  it("um treino gravado em BLOCOS continua legível pelo app antigo", async () => {
    const u = await registrar();
    await request(app)
      .post("/activities")
      .set(auth(u.token))
      .send({
        sportId: "crossfit",
        kind: "wod",
        payload: {
          v: 2,
          blocos: [
            {
              tipo: "metcon",
              nome: "Fran",
              formato: "for_time",
              prescricao: { movimentos: [{ nome: "Thruster", reps: 21, carga: { valor: 43, unidade: "kg" } }] },
              resultado: { tipo: "tempo", tempoSec: 332 },
              escala: { nivel: "rx" },
            },
          ],
        },
      })
      .expect(201);

    const lista = await request(app).get("/activities").set(auth(u.token));
    const p = lista.body.data[0].payload;

    // O app antigo lê payload.name / .level / .resultTimeSec / .movements.
    // Sem estes campos ele mostra "WOD: —" para tudo.
    expect(p.name).toBe("Fran");
    expect(p.level).toBe("rx");
    expect(p.resultTimeSec).toBe(332);
    expect(p.movements[0]).toMatchObject({ name: "Thruster", reps: 21, loadKg: 43 });
    // E os blocos continuam ali para o app novo.
    expect(lista.body.data[0].crossfit.blocos).toHaveLength(1);
  });

  it("post sem dimensao de imagem continua sendo criado e servido", async () => {
    const u = await registrar();

    // O APK antigo manda só imageUrl. Se o servidor passasse a exigir tamanho,
    // publicar foto pararia de funcionar para quem não atualiza.
    const criado = await request(app)
      .post("/social/posts")
      .set(auth(u.token))
      .send({ text: "foto sem tamanho", imageUrl: "https://exemplo.com/f.jpg" })
      .expect(201);

    expect(criado.body.post.imageWidth).toBeNull();
    expect(criado.body.post.imageHeight).toBeNull();

    const feed = await request(app).get("/social/feed").set(auth(u.token)).expect(200);
    expect(feed.body.posts[0].imageUrl).toBe("https://exemplo.com/f.jpg");
  });

  it("plano sem treino devolve forma VAZIA, nunca null", async () => {
    const u = await registrar();
    await Plan.create({
      user: u.id,
      version: 1,
      summary: "só dieta",
      workout: null,
      diet: { dailyCalories: 2000, macros: { proteinG: 1, carbsG: 1, fatG: 1 }, meals: [], notes: "" },
      disclaimer: "d",
    });

    const r = await request(app).get("/plans/current").set(auth(u.token)).expect(200);

    // O app antigo faz `plan.workout.sessions.map(...)` sem guarda: null fecha
    // o app na abertura, e o sintoma não aponta para a causa.
    expect(r.body.plan.workout).not.toBeNull();
    expect(r.body.plan.workout.sessions).toEqual([]);
  });
});
