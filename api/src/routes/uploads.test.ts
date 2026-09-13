import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../app.js";
import { UPLOADS_DIR } from "../services/storage/disk.js";
import { setStorageProvider } from "../services/storage/index.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";
const created: string[] = [];

// Imagem PNG real e decodificável (o sharp precisa conseguir abri-la).
let imagemValida: Buffer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  imagemValida = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 130, b: 140 } },
  })
    .png()
    .toBuffer();
  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email: "asafe@test.com", password: "senha12345" });
  token = reg.body.token;
});

afterAll(async () => {
  // Remove os arquivos criados no teste.
  for (const f of created) {
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, f));
    } catch {
      /* já removido */
    }
  }
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Upload de imagens", () => {
  it("exige autenticação", async () => {
    const res = await request(app).post("/uploads").attach("image", imagemValida, {
      filename: "x.png",
      contentType: "image/png",
    });
    expect(res.status).toBe(401);
  });

  it("faz upload de uma imagem e retorna URL", async () => {
    const res = await request(app)
      .post("/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", imagemValida, { filename: "foto.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.url).toContain("/uploads/");
    created.push(res.body.url.split("/uploads/")[1]);
  });

  it("uma foto de celular comum passa — 5 MB era pouco", async () => {
    // Câmera de celular de hoje produz 4 a 12 MB sem esforço, e o teto antigo
    // rejeitava isso com "File too large", em inglês, na cara de quem só queria
    // postar. O arquivo guardado é pequeno de qualquer jeito: o `processImage`
    // reduz para 1600px e reencoda antes de salvar.
    const oitoMegas = Buffer.concat([imagemValida, Buffer.alloc(8 * 1024 * 1024)]);

    const res = await request(app)
      .post("/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", oitoMegas, { filename: "foto.png", contentType: "image/png" });

    // Passa do multer. O sharp pode recusar o buffer remendado do teste, mas o
    // que importa aqui é NÃO ser mais o erro de tamanho.
    expect(res.body.error ?? "").not.toContain("MB");
  });

  it("arquivo grande demais é recusado em português, dizendo o limite", async () => {
    const gigante = Buffer.alloc(21 * 1024 * 1024);

    const res = await request(app)
      .post("/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", gigante, { filename: "enorme.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    // Nada de "File too large": um erro que não diz o que fazer vira chamado.
    expect(res.body.error).toContain("20 MB");
    expect(res.body.error).toContain("menor");
  });

  it("recusa arquivo que não é imagem (400)", async () => {
    const res = await request(app)
      .post("/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", Buffer.from("isso é texto"), {
        filename: "a.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
  });

  it("processa a imagem (remove EXIF) e delega ao provider configurado", async () => {
    const capturado: { buffer?: Buffer } = {};
    setStorageProvider({
      name: "fake",
      save: async (file) => {
        capturado.buffer = file.buffer;
        return { url: "https://cdn.fake/x.jpg" };
      },
      delete: async () => {},
    });
    try {
      const comExif = await sharp({
        create: { width: 600, height: 400, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .jpeg()
        .withMetadata({ exif: { IFD0: { Software: "exif-test" } } })
        .toBuffer();

      const res = await request(app)
        .post("/uploads")
        .set("Authorization", `Bearer ${token}`)
        .attach("image", comExif, { filename: "f.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(201);
      // A URL veio do provider (não é mais /uploads/ do disco).
      expect(res.body.url).toBe("https://cdn.fake/x.jpg");
      // A imagem chegou ao provider já sem EXIF.
      expect(capturado.buffer).toBeDefined();
      expect((await sharp(capturado.buffer!).metadata()).exif).toBeUndefined();
    } finally {
      setStorageProvider(null);
    }
  });

  it("rejeita bytes que não são imagem válida mesmo com mimetype de imagem (400)", async () => {
    const res = await request(app)
      .post("/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", Buffer.from("nao sou uma imagem de verdade"), {
        filename: "fake.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(400);
  });
});
