import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ExerciseVideo } from "../models/ExerciseVideo.js";
import { resolveExerciseVideo, setYoutubeSearcher } from "./exerciseVideo.js";
import { env } from "../config/env.js";

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
  await ExerciseVideo.deleteMany({});
  setYoutubeSearcher(null);
});

describe("resolveExerciseVideo", () => {
  it("no miss: busca no YouTube, persiste e retorna", async () => {
    const search = vi.fn(async () => ({ youtubeId: "vid1", title: "Como fazer agachamento" }));
    setYoutubeSearcher(search);

    const r = await resolveExerciseVideo("Agachamento Livre");
    expect(r).toEqual({
      youtubeId: "vid1",
      thumbnailUrl: "https://img.youtube.com/vi/vid1/hqdefault.jpg",
      title: "Como fazer agachamento",
    });
    expect(search).toHaveBeenCalledTimes(1);

    const saved = await ExerciseVideo.findOne({ normalizedName: "agachamento livre" });
    expect(saved?.youtubeId).toBe("vid1");
  });

  it("cache hit: não chama o searcher de novo", async () => {
    const search = vi.fn(async () => ({ youtubeId: "vid1", title: "t" }));
    setYoutubeSearcher(search);
    await resolveExerciseVideo("Agachamento Livre");
    await resolveExerciseVideo("agachamento   livre"); // mesmo nome normalizado
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("miss persistido (sem resultado) retorna null e não re-busca", async () => {
    const search = vi.fn(async () => null);
    setYoutubeSearcher(search);
    expect(await resolveExerciseVideo("Exercício Inexistente XYZ")).toBeNull();
    expect(await resolveExerciseVideo("Exercício Inexistente XYZ")).toBeNull();
    expect(search).toHaveBeenCalledTimes(1); // segunda chamada veio do cache
    const saved = await ExerciseVideo.findOne({ normalizedName: "exercicio inexistente xyz" });
    expect(saved?.youtubeId).toBeNull();
  });

  it("sem API key: retorna null e não persiste", async () => {
    const search = vi.fn(async () => ({ youtubeId: "vidX", title: "t" }));
    setYoutubeSearcher(search);
    const saved = env.youtubeApiKey;
    env.youtubeApiKey = "";
    try {
      expect(await resolveExerciseVideo("Agachamento Livre")).toBeNull();
      expect(search).not.toHaveBeenCalled();
      expect(await ExerciseVideo.countDocuments()).toBe(0);
    } finally {
      env.youtubeApiKey = saved;
    }
  });
});
