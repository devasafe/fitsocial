import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../app.js";
import { setAIProvider } from "../services/ai/index.js";
import { FoodLog } from "../models/FoodLog.js";
import type { AIProvider, GenerateOptions } from "../services/ai/provider.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";

/** Modelo com visão. Guarda o que recebeu, para provar que a foto chegou. */
class ModeloComVisao implements AIProvider {
  readonly name = "visao";
  readonly aceitaImagem = true;
  resposta = "";
  ultima: GenerateOptions | null = null;
  async generate(options: GenerateOptions): Promise<string> {
    this.ultima = options;
    return this.resposta;
  }
}

class ModeloSemVisao implements AIProvider {
  readonly name = "so-texto";
  readonly aceitaImagem = false;
  async generate(): Promise<string> {
    return "nunca deveria ser chamado com uma foto";
  }
}

const modelo = new ModeloComVisao();

const prato = () =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 150, b: 90 } } })
    .jpeg()
    .toBuffer();

function enviar(buffer: Buffer, campos: Record<string, string> = {}) {
  let req = request(app)
    .post("/nutrition/analisar-foto")
    .set("Authorization", `Bearer ${token}`)
    .attach("image", buffer, "prato.jpg");
  for (const [k, v] of Object.entries(campos)) req = req.field(k, v);
  return req;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(modelo);
  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email: "foto@test.com", password: "senha12345" });
  token = reg.body.token;
});

afterAll(async () => {
  setAIProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  setAIProvider(modelo);
  modelo.ultima = null;
  await FoodLog.deleteMany({});
});

describe("Estimar a refeição pela foto", () => {
  it("devolve os itens estimados e NÃO grava nada", async () => {
    modelo.resposta = JSON.stringify({
      itens: [
        { nome: "arroz branco", gramas: 150, kcal: 193, proteinaG: 3.6, carboG: 42, gorduraG: 0.4, confianca: "alta" },
        { nome: "frango grelhado", gramas: 120, kcal: 198, proteinaG: 37, carboG: 0, gorduraG: 4.3, confianca: "media" },
      ],
      observacao: "Não dá para saber quanto de óleo foi no frango.",
    });

    const r = await enviar(await prato()).expect(200);

    expect(r.body.data.itens).toHaveLength(2);
    expect(r.body.data.itens[0].nome).toBe("arroz branco");
    expect(r.body.data.observacao).toContain("óleo");

    // A pessoa confirma na tela seguinte. Gravar aqui poria no diário dela um
    // número que ela nunca viu.
    expect(await FoodLog.countDocuments({})).toBe(0);
  });

  it("a foto chega ao modelo, sem EXIF e em base64", async () => {
    modelo.resposta = JSON.stringify({ itens: [], observacao: "" });

    await enviar(await prato()).expect(200);

    expect(modelo.ultima?.imagem).toBeDefined();
    expect(modelo.ultima?.imagem?.mimeType).toBe("image/jpeg");
    // Foto de refeição é tirada em casa e carrega a coordenada de casa: o
    // processamento reencoda e descarta o EXIF antes de sair daqui.
    const meta = await sharp(Buffer.from(modelo.ultima!.imagem!.base64, "base64")).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("corrige o kcal quando ele não fecha com os macros, e rebaixa a confiança", async () => {
    // 20g de proteína + 30g de carbo + 10g de gordura = 290 kcal, não 900.
    modelo.resposta = JSON.stringify({
      itens: [
        { nome: "panqueca", gramas: 100, kcal: 900, proteinaG: 20, carboG: 30, gorduraG: 10, confianca: "alta" },
      ],
      observacao: "",
    });

    const r = await enviar(await prato()).expect(200);

    // Modelo de linguagem erra aritmética, e um item inflado quebra o total do
    // dia de um jeito que a pessoa não consegue diagnosticar.
    expect(r.body.data.itens[0].kcal).toBe(290);
    expect(r.body.data.itens[0].confianca).toBe("baixa");
  });

  it("prato vazio devolve lista vazia com explicação, em vez de inventar", async () => {
    modelo.resposta = JSON.stringify({ itens: [], observacao: "Não vejo comida nesta foto." });

    const r = await enviar(await prato()).expect(200);

    expect(r.body.data.itens).toEqual([]);
    expect(r.body.data.observacao).toContain("Não vejo comida");
  });

  it("resposta fora do formato vira erro tratado, não 500", async () => {
    modelo.resposta = "claro! aqui vai: um prato bonito de comida";

    const r = await enviar(await prato());

    // Convenção do projeto: falha de IA é 502 com mensagem de produto, e o
    // detalhe técnico fica no log — ver middleware/error.ts.
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/formato inesperado/i);
    expect(await FoodLog.countDocuments({})).toBe(0);
  });

  it("sem modelo com visão, recusa em vez de perguntar a um modelo de texto", async () => {
    setAIProvider(new ModeloSemVisao());

    const r = await enviar(await prato());

    // Modelo de texto não recusa uma foto: ele responde com confiança sobre um
    // prato que nunca viu. E a mensagem diz "configuração", não "fora do ar":
    // a IA está de pé, quem falta é um modelo que enxergue.
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/configuração/i);
  });

  it("arquivo que não é imagem é recusado antes de gastar chamada de IA", async () => {
    modelo.ultima = null;

    const r = await enviar(Buffer.from("isto e um texto, nao uma foto"));

    expect(r.status).toBe(400);
    expect(modelo.ultima).toBeNull();
  });

  it("exige autenticação", async () => {
    await request(app)
      .post("/nutrition/analisar-foto")
      .attach("image", await prato(), "prato.jpg")
      .expect(401);
  });
});

describe("Registrar o que a pessoa confirmou", () => {
  it("guarda gramas, origem e a foto junto do item", async () => {
    const r = await request(app)
      .post("/nutrition/logs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        date: "2026-09-10",
        meal: "almoco",
        name: "arroz branco",
        kcal: 193,
        proteinG: 3.6,
        carbsG: 42,
        fatG: 0.4,
        gramas: 150,
        origem: "foto",
        imageUrl: "https://fitcdn.satriz.club/fotos/prato.jpg",
      })
      .expect(201);

    expect(r.body.data.gramas).toBe(150);
    expect(r.body.data.origem).toBe("foto");
  });

  it("registro manual continua funcionando sem os campos novos", async () => {
    // O APK que já está instalado manda só o formato antigo.
    const r = await request(app)
      .post("/nutrition/logs")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2026-09-10", meal: "cafe", name: "ovos", kcal: 210, proteinG: 18 })
      .expect(201);

    expect(r.body.data.origem).toBe("manual");
    expect(r.body.data.gramas).toBeNull();
  });
});
