import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { setAIProvider } from "../services/ai/index.js";
import { Activity } from "../models/Activity.js";
import type { AIProvider, GenerateOptions } from "../services/ai/provider.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";

class Modelo implements AIProvider {
  readonly name = "modelo";
  readonly aceitaImagem = false;
  resposta = "";
  ultima: GenerateOptions | null = null;
  async generate(options: GenerateOptions): Promise<string> {
    this.ultima = options;
    return this.resposta;
  }
}
const modelo = new Modelo();

const ler = (texto: string) =>
  request(app).post("/activities/ler-quadro").set("Authorization", `Bearer ${token}`).send({ texto });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(modelo);
  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email: "quadro@test.com", password: "senha12345" });
  token = reg.body.token;
});

afterAll(async () => {
  setAIProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(() => {
  setAIProvider(modelo);
  modelo.ultima = null;
});

const QUADRO_COLADO = `WARM-UP
EMOM (1'15") X 4
-4 Beat Swing
-2 Pull Up

WOD
*BLOCO A) - AMRAP 6'
"Relay"
-100 Mts Run
-2 Rope Climb

*REST 1'`;

describe("Ler o quadro da aula", () => {
  it("devolve os blocos montados e NAO grava nada", async () => {
    // O modelo TRANSCREVE: copia o modo e separa movimentos. Quem deduz
    // estrutura e o interpretador, no servidor.
    modelo.resposta = JSON.stringify({
      box: null,
      tamanhoDoTime: 2,
      blocos: [
        {
          modo: 'EMOM (1\'15") x 4',
          nome: "WARM-UP",
          movimentos: [
            { nome: "Beat Swing", volume: { valor: 4, unidade: "reps" } },
            { nome: "Pull Up", volume: { valor: 2, unidade: "reps" } },
          ],
        },
        {
          modo: "AMRAP 6'",
          nome: "Relay",
          movimentos: [
            { nome: "Run", volume: { valor: 100, unidade: "metros" }, escopo: "dividido" },
            { nome: "Rope Climb", volume: { valor: 2, unidade: "reps" }, escopo: "dividido" },
          ],
        },
        { modo: "REST 1'", movimentos: [] },
      ],
      observacao: "",
    });

    const r = await ler(QUADRO_COLADO).expect(200);

    expect(r.body.data.blocos).toHaveLength(3);
    expect(r.body.data.tamanhoDoTime).toBe(2);

    // O modo chega como foi escrito...
    expect(r.body.data.blocos[0].modo).toBe('EMOM (1\'15") x 4');
    // ...e a estrutura vem do interpretador, nao do modelo.
    expect(r.body.data.blocos[0].lido).toMatchObject({
      familia: "emom",
      intervaloSec: 75,
      rounds: 4,
    });
    expect(r.body.data.blocos[2].lido).toMatchObject({ familia: "descanso", duracaoSec: 60 });

    // Quem grava é a pessoa, depois de conferir.
    expect(await Activity.countDocuments({})).toBe(0);
  });

  it("DESCARTA resultado, mesmo quando o modelo insiste em preencher", async () => {
    modelo.resposta = JSON.stringify({
      blocos: [
        {
          modo: "21-15-9",
          nome: "Fran",
          movimentos: [{ nome: "Thruster", volume: { valor: [21, 15, 9], unidade: "reps" } }],
          // O quadro NÃO tem isto. Se passasse, viraria um recorde de 5:32 que
          // a pessoa nunca fez, no histórico que ela usa para saber se evoluiu.
          resultado: { tipo: "tempo", tempoSec: 332 },
        },
      ],
      observacao: "",
    });

    const r = await ler("Fran\n21-15-9 Thruster").expect(200);

    expect(r.body.data.blocos[0].resultado ?? null).toBeNull();
  });

  it("o texto do quadro chega ao modelo como está", async () => {
    modelo.resposta = JSON.stringify({ blocos: [], observacao: "" });

    await ler(QUADRO_COLADO).expect(200);

    const mandado = modelo.ultima?.messages[0]?.content ?? "";
    expect(mandado).toContain("EMOM (1'15\") X 4");
    expect(mandado).toContain("Relay");
  });

  it("quadro que a leitura não entendeu volta vazio, com explicação", async () => {
    modelo.resposta = JSON.stringify({
      blocos: [],
      observacao: "Não reconheci nenhum formato de treino neste texto.",
    });

    const r = await ler("lista de compras: leite, pão").expect(200);

    // Melhor um bloco a menos do que um bloco inventado.
    expect(r.body.data.blocos).toEqual([]);
    expect(r.body.data.observacao).toContain("Não reconheci");
  });

  it("resposta fora do formato vira erro tratado", async () => {
    modelo.resposta = "claro! seu treino tem um aquecimento e um WOD legal";

    const r = await ler(QUADRO_COLADO);

    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/formato inesperado/i);
  });

  it("exige autenticação", async () => {
    await request(app).post("/activities/ler-quadro").send({ texto: QUADRO_COLADO }).expect(401);
  });
});

describe("Registrar o treino colado", () => {
  it("o quadro original fica guardado junto dos blocos", async () => {
    const r = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sportId: "crossfit",
        kind: "wod",
        date: "2026-09-10",
        payload: {
          v: 3,
          quadro: QUADRO_COLADO,
          blocos: [
            {
              modo: "AMRAP 6'",
              nome: "Relay",
              movimentos: [
                { nome: "Run", volume: { valor: 100, unidade: "metros" }, escopo: "dividido" },
              ],
              resultado: { tipo: "rounds_reps", rounds: 7, repsExtras: 1 },
              escala: { nivel: "rx" },
            },
          ],
        },
      })
      .expect(201);

    // Os blocos são a interpretação; o texto é a fonte. Se a leitura errou,
    // daqui a um ano ainda dá para saber o que o coach escreveu.
    expect(r.body.data.crossfit.quadro).toContain("EMOM");
  });

  it("treino SÓ com o quadro, sem bloco nenhum, ainda é registrável", async () => {
    // A leitura pode falhar, e o formato do box pode não caber em bloco algum.
    // Ficar bloqueado esperando a IA seria pior que guardar o texto.
    await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sportId: "crossfit",
        kind: "wod",
        date: "2026-09-10",
        payload: { v: 3, quadro: QUADRO_COLADO, blocos: [] },
      })
      .expect(201);
  });

  it("vazio dos dois lados é recusado", async () => {
    const r = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${token}`)
      .send({ sportId: "crossfit", kind: "wod", date: "2026-09-10", payload: { v: 3, blocos: [] } });

    expect(r.status).toBe(400);
  });
});
