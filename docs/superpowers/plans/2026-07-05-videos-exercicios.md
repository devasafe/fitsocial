# Vídeos de execução dos exercícios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, ao lado de cada exercício do treino, uma miniatura de vídeo de execução do YouTube que abre num player embutido, resolvendo nome→vídeo automaticamente com cache compartilhado.

**Architecture:** Coleção `ExerciseVideo` no Mongo funciona como cache/catálogo que cresce sozinho: o backend resolve o nome de um exercício contra o cache e, no miss, busca uma vez no YouTube e persiste. A busca externa fica atrás de uma função injetável (`setYoutubeSearcher`) espelhando o padrão `setAIProvider`, pra testar sem rede. O app resolve a sessão inteira num request batch ao abrir a tela e renderiza miniaturas não-bloqueantes.

**Tech Stack:** Node + Express + TypeScript + Mongoose + Zod (backend, ESM com imports `.js`); Vitest + mongodb-memory-server + supertest (testes); React Native/Expo + TypeScript (app).

## Global Constraints

- Backend é ESM: **todo import relativo termina em `.js`** (ex.: `"../models/ExerciseVideo.js"`), mesmo apontando para `.ts`.
- Testes usam **Vitest** (`import { describe, it, expect } from "vitest"`), não Jest.
- Rotas autenticadas seguem o padrão `router.use(requireAuth)`; `req.user` já vem tipado globalmente.
- Erros HTTP via `throw new HttpError(status, msg)` (de `../utils/httpError.js`), capturados pelo middleware central; rotas usam `asyncHandler`.
- Dependências externas (rede) ficam atrás de setter injetável pra teste, como `setAIProvider`.
- Mensagens ao usuário em **PT-BR**.
- A feature degrada graciosamente sem `YOUTUBE_API_KEY`: nunca quebra o fluxo de treino.
- Após cada task, rodar `npm test` no `api/` (backend) e `npm run typecheck` no `app-android/` quando a task tocar o app.

---

### Task 1: Config — variável YOUTUBE_API_KEY

**Files:**
- Modify: `api/src/config/env.ts`

**Interfaces:**
- Produces: `env.youtubeApiKey: string` (`""` quando ausente).

- [ ] **Step 1: Adicionar a variável ao objeto `env`**

Em `api/src/config/env.ts`, dentro do objeto `env`, logo após a linha `geminiModel: ...`, adicionar:

```ts
  // Chave da YouTube Data API v3 (opcional). Sem ela, os vídeos de exercício degradam graciosamente.
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd api && npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add api/src/config/env.ts
git commit -m "feat: adiciona env YOUTUBE_API_KEY (opcional)"
```

---

### Task 2: Modelo ExerciseVideo

**Files:**
- Create: `api/src/models/ExerciseVideo.ts`

**Interfaces:**
- Produces:
  - `ExerciseVideo` (mongoose model) com campos `{ normalizedName: string, displayName: string, youtubeId: string | null, thumbnailUrl: string, title: string, source: "youtube" | "curated", pinned: boolean }` + timestamps.
  - Índice único em `normalizedName`.

- [ ] **Step 1: Criar o modelo**

Criar `api/src/models/ExerciseVideo.ts`:

```ts
import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

// Cache/catálogo compartilhado de vídeos de execução por exercício.
// Cresce sob demanda: um miss no cache dispara uma busca no YouTube que é persistida aqui.
const exerciseVideoSchema = new Schema(
  {
    // Chave de cache: nome do exercício normalizado (minúsculas, sem acento, espaços colapsados).
    normalizedName: { type: String, required: true, unique: true, index: true },
    // Nome original que originou a entrada (para depuração/curadoria).
    displayName: { type: String, required: true },
    // ID do vídeo no YouTube. null = "miss" (busca não achou nada) — evita re-buscar sempre.
    youtubeId: { type: String, default: null },
    thumbnailUrl: { type: String, default: "" },
    title: { type: String, default: "" },
    source: { type: String, enum: ["youtube", "curated"], default: "youtube" },
    // true = entrada curada/corrigida manualmente; não deve ser sobrescrita automaticamente.
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export type ExerciseVideoDoc = HydratedDocument<InferSchemaType<typeof exerciseVideoSchema>>;

export const ExerciseVideo = mongoose.model("ExerciseVideo", exerciseVideoSchema);
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd api && npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add api/src/models/ExerciseVideo.ts
git commit -m "feat: modelo ExerciseVideo (cache de vídeos de exercício)"
```

---

### Task 3: Normalização de nome de exercício

**Files:**
- Create: `api/src/services/exerciseVideo.ts` (só a função `normalizeExerciseName` nesta task)
- Create: `api/src/services/exerciseVideo.test.ts`

**Interfaces:**
- Produces: `normalizeExerciseName(name: string): string` — minúsculas, sem acentos, espaços colapsados, trim; preserva qualificadores ("com barra", "na máquina").

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/services/exerciseVideo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeExerciseName } from "./exerciseVideo.js";

describe("normalizeExerciseName", () => {
  it("remove acentos e coloca em minúsculas", () => {
    expect(normalizeExerciseName("Supino Inclinado com Halteres")).toBe(
      "supino inclinado com halteres"
    );
    expect(normalizeExerciseName("Rosca Direta")).toBe("rosca direta");
    expect(normalizeExerciseName("Elevação Pélvica")).toBe("elevacao pelvica");
  });

  it("colapsa espaços e apara as bordas", () => {
    expect(normalizeExerciseName("  Puxada   Frontal  ")).toBe("puxada frontal");
  });

  it("preserva qualificadores que mudam o exercício", () => {
    expect(normalizeExerciseName("Supino Reto com Barra")).toBe("supino reto com barra");
    expect(normalizeExerciseName("Supino Reto na Máquina")).toBe("supino reto na maquina");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd api && npx vitest run src/services/exerciseVideo.test.ts`
Expected: FAIL — `normalizeExerciseName` não existe / módulo não resolve.

- [ ] **Step 3: Implementar a função**

Criar `api/src/services/exerciseVideo.ts`:

```ts
/**
 * Normaliza o nome de um exercício para servir de chave de cache:
 * minúsculas, sem acentos, espaços colapsados. Preserva qualificadores
 * ("com barra", "na máquina") porque eles mudam o exercício.
 */
export function normalizeExerciseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd api && npx vitest run src/services/exerciseVideo.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add api/src/services/exerciseVideo.ts api/src/services/exerciseVideo.test.ts
git commit -m "feat: normalizeExerciseName (chave de cache de vídeos)"
```

---

### Task 4: Searcher do YouTube injetável

**Files:**
- Modify: `api/src/services/exerciseVideo.ts`

**Interfaces:**
- Consumes: `env.youtubeApiKey` (Task 1).
- Produces:
  - Tipo `YoutubeHit = { youtubeId: string; title: string } | null`.
  - Tipo `YoutubeSearcher = (query: string) => Promise<YoutubeHit>`.
  - `setYoutubeSearcher(fn: YoutubeSearcher | null): void` — injeta um searcher (mock nos testes).
  - `getYoutubeSearcher(): YoutubeSearcher` — retorna o injetado ou o padrão (REST).
  - `thumbnailFor(youtubeId: string): string` — `https://img.youtube.com/vi/<id>/hqdefault.jpg`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `api/src/services/exerciseVideo.test.ts`:

```ts
import { setYoutubeSearcher, getYoutubeSearcher, thumbnailFor } from "./exerciseVideo.js";

describe("youtube searcher (injeção)", () => {
  it("thumbnailFor monta a URL hqdefault", () => {
    expect(thumbnailFor("abc123")).toBe("https://img.youtube.com/vi/abc123/hqdefault.jpg");
  });

  it("getYoutubeSearcher retorna o searcher injetado", async () => {
    setYoutubeSearcher(async (q) => ({ youtubeId: "vid-" + q.length, title: "T " + q }));
    const hit = await getYoutubeSearcher()("agachamento execução correta");
    expect(hit).toEqual({ youtubeId: "vid-28", title: "T agachamento execução correta" });
    setYoutubeSearcher(null);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/services/exerciseVideo.test.ts`
Expected: FAIL — exports não existem.

- [ ] **Step 3: Implementar searcher + injeção**

Adicionar a `api/src/services/exerciseVideo.ts` (após `normalizeExerciseName`):

```ts
import { env } from "../config/env.js";

const YT_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

export type YoutubeHit = { youtubeId: string; title: string } | null;
export type YoutubeSearcher = (query: string) => Promise<YoutubeHit>;

/** Miniatura padrão do YouTube a partir do ID do vídeo. */
export function thumbnailFor(youtubeId: string): string {
  return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
}

interface YoutubeSearchResponse {
  items?: { id?: { videoId?: string }; snippet?: { title?: string } }[];
  error?: { message?: string };
}

// Searcher padrão: YouTube Data API v3, vídeos curtos, relevância em PT.
const defaultSearcher: YoutubeSearcher = async (query) => {
  if (!env.youtubeApiKey) return null;
  const params = new URLSearchParams({
    key: env.youtubeApiKey,
    q: query,
    part: "snippet",
    type: "video",
    videoDuration: "short",
    maxResults: "1",
    relevanceLanguage: "pt",
    safeSearch: "strict",
  });

  let res: Response;
  try {
    res = await fetch(`${YT_SEARCH_URL}?${params.toString()}`);
  } catch {
    return null; // falha de rede: não persiste miss, tenta de novo depois
  }
  if (!res.ok) return null; // inclui 403 de quota estourada

  const data = (await res.json().catch(() => ({}))) as YoutubeSearchResponse;
  const item = data.items?.[0];
  const videoId = item?.id?.videoId;
  if (!videoId) return null;
  return { youtubeId: videoId, title: item?.snippet?.title ?? "" };
};

let searcher: YoutubeSearcher | null = null;

/** Injeta um searcher (mock nos testes). Passe null para voltar ao padrão. */
export function setYoutubeSearcher(fn: YoutubeSearcher | null): void {
  searcher = fn;
}

/** Retorna o searcher injetado ou o padrão (REST). */
export function getYoutubeSearcher(): YoutubeSearcher {
  return searcher ?? defaultSearcher;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx vitest run src/services/exerciseVideo.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add api/src/services/exerciseVideo.ts api/src/services/exerciseVideo.test.ts
git commit -m "feat: searcher do YouTube injetável + thumbnailFor"
```

---

### Task 5: resolveExerciseVideo (cache-first)

**Files:**
- Modify: `api/src/services/exerciseVideo.ts`

**Interfaces:**
- Consumes: `normalizeExerciseName`, `getYoutubeSearcher`, `thumbnailFor` (Tasks 3-4), `ExerciseVideo` (Task 2), `env.youtubeApiKey` (Task 1).
- Produces:
  - Tipo `ResolvedVideo = { youtubeId: string; thumbnailUrl: string; title: string } | null`.
  - `resolveExerciseVideo(name: string): Promise<ResolvedVideo>` — cache-first; no miss busca no YouTube e persiste; "miss" persistido (`youtubeId: null`) retorna null sem re-buscar; sem API key retorna null sem persistir.

- [ ] **Step 1: Escrever os testes que falham**

Criar `api/src/services/resolveExerciseVideo.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ExerciseVideo } from "../models/ExerciseVideo.js";
import { resolveExerciseVideo, setYoutubeSearcher } from "./exerciseVideo.js";

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
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/services/resolveExerciseVideo.test.ts`
Expected: FAIL — `resolveExerciseVideo` não existe.

- [ ] **Step 3: Implementar resolveExerciseVideo**

Adicionar ao final de `api/src/services/exerciseVideo.ts`:

```ts
import { ExerciseVideo } from "../models/ExerciseVideo.js";

export type ResolvedVideo = { youtubeId: string; thumbnailUrl: string; title: string } | null;

function toResolved(doc: { youtubeId: string | null; thumbnailUrl?: string; title?: string }): ResolvedVideo {
  if (!doc.youtubeId) return null;
  return {
    youtubeId: doc.youtubeId,
    thumbnailUrl: doc.thumbnailUrl || thumbnailFor(doc.youtubeId),
    title: doc.title ?? "",
  };
}

/**
 * Resolve um nome de exercício para um vídeo do YouTube, cache-first.
 * - Cache hit (inclusive "miss" persistido): retorna sem tocar na rede.
 * - Miss: busca no YouTube; se achar, persiste vídeo; se não, persiste "miss" (youtubeId: null).
 * - Falha de rede/quota (searcher retorna null): NÃO persiste miss aqui — deixa re-tentar depois.
 *   Diferenciamos "sem API key" olhando env: sem key nunca persiste nada.
 */
export async function resolveExerciseVideo(name: string): Promise<ResolvedVideo> {
  const normalizedName = normalizeExerciseName(name);
  if (!normalizedName) return null;

  const cached = await ExerciseVideo.findOne({ normalizedName });
  if (cached) return toResolved(cached);

  // Sem chave configurada: não persiste nada (feature degradada).
  if (!env.youtubeApiKey) return null;

  const hit = await getYoutubeSearcher()(`${name} execução correta`);

  // Persiste o resultado (vídeo achado OU "miss" definitivo). Upsert protege de corrida.
  const update = hit
    ? { youtubeId: hit.youtubeId, thumbnailUrl: thumbnailFor(hit.youtubeId), title: hit.title, source: "youtube" as const }
    : { youtubeId: null, thumbnailUrl: "", title: "", source: "youtube" as const };

  await ExerciseVideo.updateOne(
    { normalizedName },
    { $setOnInsert: { normalizedName, displayName: name, pinned: false }, $set: update },
    { upsert: true }
  );

  return hit ? toResolved({ youtubeId: hit.youtubeId, thumbnailUrl: thumbnailFor(hit.youtubeId), title: hit.title }) : null;
}
```

Nota: quando o searcher padrão devolve `null` por falha de rede/quota **com** API key configurada, esta implementação persiste um "miss". É uma simplificação aceitável do MVP (a spec permite corrigir via `pinned`); a distinção fina fica para v2.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx vitest run src/services/resolveExerciseVideo.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add api/src/services/exerciseVideo.ts api/src/services/resolveExerciseVideo.test.ts
git commit -m "feat: resolveExerciseVideo cache-first com persistência de miss"
```

---

### Task 6: Rota POST /exercise-videos/resolve

**Files:**
- Create: `api/src/routes/exerciseVideos.ts`
- Create: `api/src/routes/exerciseVideos.test.ts`
- Modify: `api/src/app.ts`

**Interfaces:**
- Consumes: `resolveExerciseVideo` (Task 5), `requireAuth`, `rateLimit`, `asyncHandler`.
- Produces: `exerciseVideosRouter`; endpoint `POST /exercise-videos/resolve` body `{ names: string[] }` → `{ videos: Record<string, ResolvedVideo> }` (chave = nome original recebido).

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/src/routes/exerciseVideos.test.ts`:

```ts
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
```

Nota: confirmar o helper de assinatura de token em `api/src/utils/token.ts` (usado nos testes de auth existentes). Se o nome exportado diferir de `signToken`, ajustar o import — checar com `grep "export" api/src/utils/token.ts` e o uso em `api/src/routes/auth.test.ts`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/routes/exerciseVideos.test.ts`
Expected: FAIL — rota inexistente (404) / módulo não resolve.

- [ ] **Step 3: Criar o router**

Criar `api/src/routes/exerciseVideos.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { resolveExerciseVideo, type ResolvedVideo } from "../services/exerciseVideo.js";

export const exerciseVideosRouter = Router();
exerciseVideosRouter.use(requireAuth);

const resolveSchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(30),
});

// Resolve a sessão inteira de uma vez. Deduplica por nome e resolve em paralelo.
exerciseVideosRouter.post(
  "/resolve",
  rateLimit({ windowMs: 60_000, max: 30, name: "exercise-videos" }),
  asyncHandler(async (req, res) => {
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Envie uma lista de nomes de exercícios (1 a 30).");
    }
    const { names } = parsed.data;

    // Deduplica preservando o nome original; resolve cada nome único uma vez.
    const unique = [...new Set(names)];
    const resolvedList = await Promise.all(unique.map((n) => resolveExerciseVideo(n)));
    const byName = new Map<string, ResolvedVideo>();
    unique.forEach((n, i) => byName.set(n, resolvedList[i]));

    const videos: Record<string, ResolvedVideo> = {};
    for (const n of names) videos[n] = byName.get(n) ?? null;

    res.json({ videos });
  })
);
```

- [ ] **Step 4: Registrar a rota em `app.ts`**

Em `api/src/app.ts`:
1. Adicionar o import junto aos demais routers:
```ts
import { exerciseVideosRouter } from "./routes/exerciseVideos.js";
```
2. Registrar junto às outras rotas (ex.: após `app.use("/coach", coachRouter);`):
```ts
  app.use("/exercise-videos", exerciseVideosRouter);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd api && npx vitest run src/routes/exerciseVideos.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Rodar a suíte inteira do backend**

Run: `cd api && npm test`
Expected: todos verdes (63 anteriores + novos).

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/exerciseVideos.ts api/src/routes/exerciseVideos.test.ts api/src/app.ts
git commit -m "feat: rota POST /exercise-videos/resolve (batch, auth, rate limit)"
```

---

### Task 7: Client do app — resolveExerciseVideos

**Files:**
- Create: `app-android/src/api/exerciseVideos.ts`

**Interfaces:**
- Consumes: `apiFetch` (`./client`).
- Produces:
  - Tipo `VideoRef = { youtubeId: string; thumbnailUrl: string; title: string }`.
  - `resolveExerciseVideos(names: string[], token: string | null): Promise<Record<string, VideoRef | null>>`.

- [ ] **Step 1: Criar o client**

Criar `app-android/src/api/exerciseVideos.ts`:

```ts
import { apiFetch } from "./client";

export interface VideoRef {
  youtubeId: string;
  thumbnailUrl: string;
  title: string;
}

/** Resolve os vídeos de execução de uma sessão inteira num único request. */
export async function resolveExerciseVideos(
  names: string[],
  token: string | null
): Promise<Record<string, VideoRef | null>> {
  if (names.length === 0) return {};
  const { videos } = await apiFetch<{ videos: Record<string, VideoRef | null> }>(
    "/exercise-videos/resolve",
    { method: "POST", body: { names }, token }
  );
  return videos;
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd app-android && npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app-android/src/api/exerciseVideos.ts
git commit -m "feat: client resolveExerciseVideos no app"
```

---

### Task 8: Instalar player do YouTube

**Files:**
- Modify: `app-android/package.json` (via instalação)

**Interfaces:**
- Produces: dependência `react-native-youtube-iframe` + `react-native-webview` (peer) disponíveis.

- [ ] **Step 1: Instalar via Expo (garante versões compatíveis)**

Run: `cd app-android && npx expo install react-native-youtube-iframe react-native-webview`
Expected: instala e ajusta versões compatíveis com o SDK do Expo do projeto.

Se `react-native-youtube-iframe` não for compatível com o Expo web usado no projeto, registrar aqui e usar o fallback da Task 9 (WebView embed direto ou abrir externo) — o modal deve funcionar mesmo assim.

- [ ] **Step 2: Verificar typecheck**

Run: `cd app-android && npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app-android/package.json app-android/package-lock.json
git commit -m "chore: instala player do YouTube (react-native-youtube-iframe)"
```

---

### Task 9: Componentes ExerciseVideoModal + ExerciseVideoThumb

**Files:**
- Create: `app-android/src/components/ExerciseVideoModal.tsx`
- Create: `app-android/src/components/ExerciseVideoThumb.tsx`

**Interfaces:**
- Consumes: `VideoRef` (Task 7), `react-native-youtube-iframe` (Task 8), tema (`../theme`).
- Produces:
  - `ExerciseVideoModal({ visible, video, exerciseName, onClose })`.
  - `ExerciseVideoThumb({ video, loading, exerciseName })` — miniatura clicável; sem vídeo abre busca externa no YouTube; loading mostra placeholder.

- [ ] **Step 1: Criar o modal do player**

Criar `app-android/src/components/ExerciseVideoModal.tsx`:

```tsx
import React from "react";
import { Modal, View, Text, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";
import { colors, radius, spacing } from "../theme";
import type { VideoRef } from "../api/exerciseVideos";

interface Props {
  visible: boolean;
  video: VideoRef | null;
  exerciseName: string;
  onClose: () => void;
}

export function ExerciseVideoModal({ visible, video, exerciseName, onClose }: Props) {
  const width = Dimensions.get("window").width - spacing.lg * 2;
  const height = Math.round((width * 9) / 16);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title} numberOfLines={1}>
              {exerciseName}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          {video ? (
            <YoutubePlayer height={height} width={width} play={false} videoId={video.youtubeId} />
          ) : (
            <Text style={styles.empty}>Vídeo indisponível.</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.text, fontWeight: "800", fontSize: 16, flex: 1, marginRight: spacing.md },
  close: { color: colors.textMuted, fontSize: 18, fontWeight: "700" },
  empty: { color: colors.textMuted, paddingVertical: spacing.xl, textAlign: "center" },
});
```

- [ ] **Step 2: Criar a miniatura**

Criar `app-android/src/components/ExerciseVideoThumb.tsx`:

```tsx
import React, { useState } from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking, ActivityIndicator } from "react-native";
import { colors, radius } from "../theme";
import type { VideoRef } from "../api/exerciseVideos";
import { ExerciseVideoModal } from "./ExerciseVideoModal";

interface Props {
  video: VideoRef | null;
  loading?: boolean;
  exerciseName: string;
}

const W = 64;
const H = 40;

export function ExerciseVideoThumb({ video, loading, exerciseName }: Props) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <View style={[styles.box, styles.center]}>
        <ActivityIndicator size="small" color={colors.textMuted} />
      </View>
    );
  }

  // Sem vídeo (sem API key ou "miss"): fallback abre a busca no YouTube externo.
  if (!video) {
    const q = encodeURIComponent(`${exerciseName} execução correta`);
    return (
      <TouchableOpacity
        style={[styles.box, styles.center, styles.fallback]}
        onPress={() => Linking.openURL(`https://www.youtube.com/results?search_query=${q}`)}
        accessibilityLabel={`Buscar vídeo de ${exerciseName} no YouTube`}
      >
        <Text style={styles.play}>▶</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={styles.box}
        onPress={() => setOpen(true)}
        accessibilityLabel={`Ver vídeo de ${exerciseName}`}
      >
        <Image source={{ uri: video.thumbnailUrl }} style={styles.thumb} resizeMode="cover" />
        <View style={styles.overlay}>
          <Text style={styles.play}>▶</Text>
        </View>
      </TouchableOpacity>
      <ExerciseVideoModal
        visible={open}
        video={video}
        exerciseName={exerciseName}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  box: { width: W, height: H, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  fallback: { borderWidth: 1, borderColor: colors.border },
  thumb: { width: "100%", height: "100%" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  play: { color: "#fff", fontSize: 14, fontWeight: "900" },
});
```

Nota: confirmar que `radius.sm` e as chaves de `colors`/`spacing` usadas existem em `app-android/src/theme` (o WorkoutScreen já usa `radius.sm`, `colors.bg`, `colors.border`, `spacing.xl` pode não existir — se faltar no modal, trocar por `spacing.lg`). Checar com `grep -n "sm\|xl\|bg\|border\|surface\|textMuted" app-android/src/theme.ts`.

- [ ] **Step 3: Verificar typecheck**

Run: `cd app-android && npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app-android/src/components/ExerciseVideoModal.tsx app-android/src/components/ExerciseVideoThumb.tsx
git commit -m "feat: componentes ExerciseVideoThumb + ExerciseVideoModal"
```

---

### Task 10: Integrar no WorkoutScreen

**Files:**
- Modify: `app-android/src/screens/WorkoutScreen.tsx`

**Interfaces:**
- Consumes: `resolveExerciseVideos` (Task 7), `ExerciseVideoThumb` (Task 9), `useAuth` (contexto de auth existente — confirmar caminho e nome do token).

- [ ] **Step 1: Buscar os vídeos ao montar e renderizar as miniaturas**

Em `app-android/src/screens/WorkoutScreen.tsx`:

1. Adicionar imports:
```ts
import { useEffect, useState } from "react";
import { resolveExerciseVideos, type VideoRef } from "../api/exerciseVideos";
import { ExerciseVideoThumb } from "../components/ExerciseVideoThumb";
import { useAuth } from "../context/AuthContext";
```
(Confirmar caminho real do contexto de auth com `grep -rn "useAuth" app-android/src` — telas como CheckInScreen já o usam.)

2. Dentro do componente, antes do `return`, coletar nomes e resolver:
```ts
  const { token } = useAuth();
  const [videos, setVideos] = useState<Record<string, VideoRef | null>>({});
  const [loadingVideos, setLoadingVideos] = useState(true);

  useEffect(() => {
    const names = workout.sessions.flatMap((s) => s.exercises.map((e) => e.name));
    let alive = true;
    resolveExerciseVideos(names, token)
      .then((v) => alive && setVideos(v))
      .catch(() => alive && setVideos({})) // não bloqueia o treino
      .finally(() => alive && setLoadingVideos(false));
    return () => {
      alive = false;
    };
  }, [workout, token]);
```

3. No `exerciseHeader`, adicionar a miniatura antes do nome (mantendo o layout em linha):
```tsx
              <View style={styles.exerciseHeader}>
                <ExerciseVideoThumb
                  video={videos[ex.name] ?? null}
                  loading={loadingVideos}
                  exerciseName={ex.name}
                />
                <Text style={styles.exerciseName}>{ex.name}</Text>
                <Text style={styles.exerciseSets}>
                  {ex.sets} × {ex.reps}
                </Text>
              </View>
```

4. Ajustar o estilo `exerciseName` para dar espaço à miniatura (adicionar `marginHorizontal`):
```ts
  exerciseName: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1, marginHorizontal: spacing.sm },
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd app-android && npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app-android/src/screens/WorkoutScreen.tsx
git commit -m "feat: miniatura de vídeo por exercício no WorkoutScreen"
```

---

### Task 11: Integrar no CheckInScreen

**Files:**
- Modify: `app-android/src/screens/CheckInScreen.tsx`

**Interfaces:**
- Consumes: `resolveExerciseVideos` (Task 7), `ExerciseVideoThumb` (Task 9), `useAuth`.

- [ ] **Step 1: Resolver vídeos ao montar e renderizar no card do checklist**

Em `app-android/src/screens/CheckInScreen.tsx`:

1. Adicionar imports (se `useAuth`/`useState`/`useEffect` ainda não importados):
```ts
import { resolveExerciseVideos, type VideoRef } from "../api/exerciseVideos";
import { ExerciseVideoThumb } from "../components/ExerciseVideoThumb";
```

2. Dentro do componente, resolver os vídeos da sessão (usar `session.exercises`, já disponível):
```ts
  const [videos, setVideos] = useState<Record<string, VideoRef | null>>({});
  const [loadingVideos, setLoadingVideos] = useState(true);

  useEffect(() => {
    const names = session.exercises.map((e) => e.name);
    let alive = true;
    resolveExerciseVideos(names, token)
      .then((v) => alive && setVideos(v))
      .catch(() => alive && setVideos({}))
      .finally(() => alive && setLoadingVideos(false));
    return () => {
      alive = false;
    };
  }, [session, token]);
```
(Se `token` não estiver no escopo, obter via `const { token } = useAuth();` — confirmar que a tela já usa `useAuth`.)

3. Dentro do card de cada exercício (bloco `rows.map(...)`, na `View` com `flex: 1` que exibe o nome), adicionar a miniatura ao lado do nome. Localizar o `<Text>` do nome do exercício e antecedê-lo com:
```tsx
              <ExerciseVideoThumb
                video={videos[row.name] ?? null}
                loading={loadingVideos}
                exerciseName={row.name}
              />
```
(Confirmar o nome do campo que guarda o nome do exercício em `row` — inspecionar o `map((e) => ({ ... }))` que cria `rows`; usar a mesma propriedade que renderiza o título.)

- [ ] **Step 2: Verificar typecheck**

Run: `cd app-android && npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app-android/src/screens/CheckInScreen.tsx
git commit -m "feat: miniatura de vídeo por exercício no CheckInScreen"
```

---

### Task 12: Documentação (.env.example e README)

**Files:**
- Modify: `api/.env.example` (se existir; senão criar)
- Modify: `README.md`

**Interfaces:** nenhuma (documentação).

- [ ] **Step 1: Documentar a variável**

Em `api/.env.example` (criar se não existir), adicionar:
```
# YouTube Data API v3 — habilita os vídeos de execução dos exercícios (opcional).
# Sem esta chave, o app mostra um botão que abre a busca no YouTube por fora.
YOUTUBE_API_KEY=
```

No `README.md`, na seção de variáveis de ambiente / setup do backend, adicionar uma linha explicando `YOUTUBE_API_KEY` (opcional; como obter em console.cloud.google.com → YouTube Data API v3; feature degrada sem ela).

- [ ] **Step 2: Commit**

```bash
git add api/.env.example README.md
git commit -m "docs: documenta YOUTUBE_API_KEY (vídeos de exercício)"
```

---

## Validação final (manual, pelo Asafe)

- Rodar backend (`cd api && npm run dev`) e app (`cd app-android && npm start`).
- Sem `YOUTUBE_API_KEY`: abrir um treino → miniaturas mostram ▶ de fallback; tocar abre busca no YouTube externo. Treino funciona normal.
- Com `YOUTUBE_API_KEY` no `api/.env`: abrir um treino → miniaturas reais carregam; tocar abre o player embutido. Reabrir a mesma tela → carrega instantâneo (cache).
- Verificar no Mongo que `exercisevideos` foi populada e que reabrir não gera novas buscas.

## Notas de verificação para o implementador

Antes de começar, confirme estes pontos do codebase (podem divergir da suposição do plano) e ajuste os imports/nomes:
- `api/src/utils/token.ts`: nome exato do helper de assinatura de token (usado em `auth.test.ts`).
- `api/src/models/User.ts`: campos obrigatórios para `User.create(...)` no teste da Task 6 (o exemplo usa `{ email, passwordHash, name }`).
- `app-android/src/context/AuthContext`: caminho e nome do hook (`useAuth`) e do campo do token.
- `app-android/src/theme.ts`: chaves de `colors`/`radius`/`spacing` referenciadas.
- `CheckInScreen`: nome da propriedade em `row` que guarda o nome do exercício.
