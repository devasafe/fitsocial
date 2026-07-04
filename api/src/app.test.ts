import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "./app.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { errorHandler } from "./middleware/error.js";

describe("App base", () => {
  const app = createApp();

  it("healthcheck responde ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rota desconhecida retorna 404", async () => {
    const res = await request(app).get("/rota-que-nao-existe");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Rota não encontrada");
  });
});

describe("rateLimit", () => {
  // App mínimo com limite de 2 por janela para exercitar o middleware.
  const mini = express();
  mini.get("/x", rateLimit({ windowMs: 60_000, max: 2, name: "test" }), (_req, res) =>
    res.json({ ok: true })
  );
  mini.use(errorHandler);

  it("permite até o limite e bloqueia (429) depois", async () => {
    expect((await request(mini).get("/x")).status).toBe(200);
    expect((await request(mini).get("/x")).status).toBe(200);
    const blocked = await request(mini).get("/x");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain("Muitas solicitações");
  });
});
