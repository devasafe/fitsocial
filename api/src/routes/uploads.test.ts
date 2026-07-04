import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../app.js";
import { UPLOADS_DIR } from "./uploads.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";
const created: string[] = [];

// PNG 1x1 mínimo válido.
const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000a49444154789c6360000002000154a24f9f0000000049454e44ae426082",
  "hex"
);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
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
    const res = await request(app).post("/uploads").attach("image", PNG_1x1, {
      filename: "x.png",
      contentType: "image/png",
    });
    expect(res.status).toBe(401);
  });

  it("faz upload de uma imagem e retorna URL", async () => {
    const res = await request(app)
      .post("/uploads")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", PNG_1x1, { filename: "foto.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.url).toContain("/uploads/");
    created.push(res.body.url.split("/uploads/")[1]);
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
});
