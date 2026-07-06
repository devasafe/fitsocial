import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { ExerciseVideo } from "../models/ExerciseVideo.js";
import { setYoutubeSearcher } from "../services/exerciseVideo.js";
import { User } from "../models/User.js";
import { signToken } from "../utils/token.js";

let mongod: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let token: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
  const user = await User.create({ email: "a@a.com", passwordHash: "x", name: "A" });
  token = signToken(user._id.toString());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await ExerciseVideo.deleteMany({});
  setYoutubeSearcher(async (q) => ({ youtubeId: "v" + q.length, title: q }));
});

describe("POST /exercise-videos/resolve", () => {
  it("exige autenticação", async () => {
    const res = await request(app).post("/exercise-videos/resolve").send({ names: ["Agachamento"] });
    expect(res.status).toBe(401);
  });

  it("resolve os nomes e devolve o mapa por nome original", async () => {
    const res = await request(app)
      .post("/exercise-videos/resolve")
      .set("Authorization", `Bearer ${token}`)
      .send({ names: ["Agachamento", "Supino Reto"] });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.videos)).toEqual(["Agachamento", "Supino Reto"]);
    expect(res.body.videos["Agachamento"].youtubeId).toMatch(/^v\d+$/);
  });

  it("deduplica nomes que normalizam igual (uma entrada no cache)", async () => {
    await request(app)
      .post("/exercise-videos/resolve")
      .set("Authorization", `Bearer ${token}`)
      .send({ names: ["Agachamento", "agachamento"] });
    expect(await ExerciseVideo.countDocuments()).toBe(1);
  });
});
