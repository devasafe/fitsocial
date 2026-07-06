# Cardio no check-in + evolução de cardio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar campos por tipo de exercício no check-in (musculação: kg+reps; cardio: duração+distância+pace) e adicionar um gráfico de evolução de cardio separado, com o backend marcando o tipo (`kind`) de cada exercício.

**Architecture:** O backend é dono da classificação: cada exercício ganha `kind` ("strength"|"cardio"), marcado pela IA e preenchido por um classificador de fallback (`classifyExerciseKind`) via `backfillWorkoutKinds`, aplicado ao gerar/ajustar/importar planos e ao servir `/plans/current` (backfill de planos antigos). O check-in passa a persistir `durationMin`/`distanceKm`; um novo endpoint `/checkins/cardio-progress` agrega cardio por exercício; o app lê `kind`, renderiza o layout certo e plota a métrica escolhida num `LineChart` generalizado.

**Tech Stack:** Node + Express + TypeScript + Mongoose + Zod (backend ESM, imports `.js`); Vitest + mongodb-memory-server + supertest (testes backend); React Native/Expo + TypeScript + react-native-svg (app).

## Global Constraints

- Backend é ESM: **todo import relativo termina em `.js`**.
- Testes backend usam **Vitest** (`import { describe, it, expect } from "vitest"`), com mongodb-memory-server para os que tocam o banco.
- App **não tem test runner**: a verificação é `cd app-android && npx tsc --noEmit` (sem erros). Além disso, o alvo web deve continuar compilando: `cd app-android && npx expo export --platform web` (exit 0).
- `kind` **nunca sobrescreve** um valor que a IA já mandou — só preenche quando ausente.
- **Pace não é persistido** — é derivado (`durationMin / distanceKm`) no app.
- `GET /checkins/progress` (carga) permanece **inalterado**; cardio é um endpoint separado.
- Mensagens/labels ao usuário em **PT-BR**.
- Rodar após cada task backend: `cd api && npm test` (verde). Após cada task app: `cd app-android && npx tsc --noEmit` (limpo).

---

### Task 1: Classificador de tipo de exercício (backend, puro)

**Files:**
- Create: `api/src/services/exerciseKind.ts`
- Create: `api/src/services/exerciseKind.test.ts`

**Interfaces:**
- Produces:
  - `classifyExerciseKind(name: string, reps?: string): "strength" | "cardio"`
  - `backfillWorkoutKinds<W extends { sessions: { exercises: { name: string; reps: string; kind?: "strength" | "cardio" }[] }[] }>(workout: W): W` — preenche `kind` de cada exercício só quando ausente (mutação in-place + retorno).

- [ ] **Step 1: Escrever os testes que falham**

Criar `api/src/services/exerciseKind.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyExerciseKind, backfillWorkoutKinds } from "./exerciseKind.js";

describe("classifyExerciseKind", () => {
  it("detecta cardio por palavra-chave no nome", () => {
    expect(classifyExerciseKind("Esteira")).toBe("cardio");
    expect(classifyExerciseKind("Corrida na rua")).toBe("cardio");
    expect(classifyExerciseKind("Bicicleta ergométrica")).toBe("cardio");
    expect(classifyExerciseKind("Elíptico")).toBe("cardio");
    expect(classifyExerciseKind("Pular corda")).toBe("cardio");
  });

  it("detecta cardio pelo formato do reps (tempo/distância)", () => {
    expect(classifyExerciseKind("Aquecimento", "20 min")).toBe("cardio");
    expect(classifyExerciseKind("Tiro", "5 km")).toBe("cardio");
    expect(classifyExerciseKind("Intervalado", "30s")).toBe("cardio");
  });

  it("classifica musculação por padrão", () => {
    expect(classifyExerciseKind("Supino reto com barra", "8-12")).toBe("strength");
    expect(classifyExerciseKind("Agachamento livre", "5")).toBe("strength");
    expect(classifyExerciseKind("Rosca direta")).toBe("strength");
  });
});

describe("backfillWorkoutKinds", () => {
  it("preenche kind ausente e preserva o que já existe", () => {
    const workout = {
      sessions: [
        {
          exercises: [
            { name: "Esteira", reps: "20 min" }, // ausente → cardio
            { name: "Supino", reps: "8-12" }, // ausente → strength
            { name: "Agachamento", reps: "5", kind: "cardio" as const }, // presente → NÃO sobrescreve
          ],
        },
      ],
    };
    const out = backfillWorkoutKinds(workout);
    expect(out.sessions[0].exercises[0].kind).toBe("cardio");
    expect(out.sessions[0].exercises[1].kind).toBe("strength");
    expect(out.sessions[0].exercises[2].kind).toBe("cardio"); // preservado
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/services/exerciseKind.test.ts`
Expected: FAIL — módulo/funções inexistentes.

- [ ] **Step 3: Implementar**

Criar `api/src/services/exerciseKind.ts`:

```ts
export type ExerciseKind = "strength" | "cardio";

// Palavras-chave (no nome normalizado) que indicam cardio.
const CARDIO_KEYWORDS = [
  "esteira", "corrida", "correr", "caminhada", "caminhar", "bike", "bicicleta",
  "ciclismo", "spinning", "eliptico", "transport", "remo", "remador", "escada",
  "stair", "pular corda", "corda", "hiit", "cardio", "natacao", "nadar", "aerobico",
];

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Classifica um exercício como cardio ou musculação a partir do nome e do
 * formato do "reps". Usado como fallback quando a IA não marcou o tipo.
 */
export function classifyExerciseKind(name: string, reps?: string): ExerciseKind {
  const n = normalize(name);
  if (CARDIO_KEYWORDS.some((k) => n.includes(k))) return "cardio";

  if (reps) {
    const r = normalize(reps);
    // tempo (min, "20:00", "30s") ou distância (km, "800 m")
    if (/\bmin\b|\bkm\b|\bm\b|\d\s*:\s*\d|\d\s*s\b/.test(r)) return "cardio";
  }
  return "strength";
}

/**
 * Preenche `kind` de cada exercício do treino APENAS quando ausente
 * (confia no valor que a IA mandar). Mutação in-place + retorno.
 */
export function backfillWorkoutKinds<
  W extends { sessions: { exercises: { name: string; reps: string; kind?: ExerciseKind }[] }[] }
>(workout: W): W {
  for (const session of workout.sessions) {
    for (const ex of session.exercises) {
      if (!ex.kind) ex.kind = classifyExerciseKind(ex.name, ex.reps);
    }
  }
  return workout;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx vitest run src/services/exerciseKind.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/exerciseKind.ts api/src/services/exerciseKind.test.ts
git commit -m "feat: classifyExerciseKind + backfillWorkoutKinds"
```

---

### Task 2: Propagar `kind` no plano (schema + IA + backfill on-read)

**Files:**
- Modify: `api/src/models/Plan.ts` (exerciseSchema)
- Modify: `api/src/services/ai/planGenerator.ts` (formato JSON dos prompts + normalização após parse)
- Modify: `api/src/routes/plans.ts` (`serializePlan` backfill)
- Test: `api/src/services/ai/planGenerator.test.ts` (existente — adicionar caso) e `api/src/routes/plans.test.ts` (existente — adicionar caso)

**Interfaces:**
- Consumes: `backfillWorkoutKinds` (Task 1).
- Produces:
  - `exerciseSchema` (zod) aceita `kind?: "strength" | "cardio"`.
  - `normalizePlanData(plan: PlanData): PlanData` exportada de `planGenerator.ts` (aplica `backfillWorkoutKinds` no `plan.workout`).
  - Toda saída de `generatePlan`/`adjustPlan`/`importPlanFromText` e o retorno de `GET /plans/current` têm `kind` concreto em cada exercício.

- [ ] **Step 1: Adicionar `kind` ao schema do plano**

Em `api/src/models/Plan.ts`, no `exerciseSchema`, adicionar o campo (após `notes`):

```ts
const exerciseSchema = z.object({
  name: z.string(),
  sets: z.number().int().min(1).max(20),
  reps: z.string(),
  restSeconds: z.number().int().min(0).max(600),
  notes: z.string().default(""),
  kind: z.enum(["strength", "cardio"]).optional(),
});
```

- [ ] **Step 2: Escrever o teste que falha (normalizePlanData)**

Em `api/src/services/ai/planGenerator.test.ts`, adicionar (ajuste o import se o arquivo já importa de `./planGenerator.js`):

```ts
import { normalizePlanData } from "./planGenerator.js";

describe("normalizePlanData", () => {
  it("preenche kind ausente sem sobrescrever o que a IA mandou", () => {
    const plan = {
      summary: "s",
      workout: {
        split: "ABC",
        daysPerWeek: 3,
        sessions: [
          {
            day: "A",
            focus: "Geral",
            exercises: [
              { name: "Esteira", sets: 1, reps: "20 min", restSeconds: 0, notes: "" },
              { name: "Supino", sets: 4, reps: "8-12", restSeconds: 60, notes: "" },
              { name: "Agachamento", sets: 5, reps: "5", restSeconds: 120, notes: "", kind: "cardio" as const },
            ],
          },
        ],
      },
      diet: { dailyCalories: 2000, macros: { proteinG: 150, carbsG: 200, fatG: 60 }, meals: [{ name: "Café", timeHint: "", items: [{ food: "Ovos", quantity: "3" }] }], notes: "" },
      disclaimer: "d",
    };
    const out = normalizePlanData(plan);
    const ex = out.workout.sessions[0].exercises;
    expect(ex[0].kind).toBe("cardio"); // preenchido
    expect(ex[1].kind).toBe("strength"); // preenchido
    expect(ex[2].kind).toBe("cardio"); // preservado
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd api && npx vitest run src/services/ai/planGenerator.test.ts`
Expected: FAIL — `normalizePlanData` não existe.

- [ ] **Step 4: Implementar `normalizePlanData` + aplicar nos 3 pontos + atualizar prompts**

Em `api/src/services/ai/planGenerator.ts`:

1. Import no topo:
```ts
import { backfillWorkoutKinds } from "../exerciseKind.js";
```

2. Adicionar a função exportada (perto do topo, após os imports/constantes):
```ts
/** Garante `kind` em todo exercício do plano (fallback quando a IA omite). */
export function normalizePlanData(plan: PlanData): PlanData {
  backfillWorkoutKinds(plan.workout);
  return plan;
}
```

3. Trocar cada `return parseJson(raw, planDataSchema);` (nas 3 funções `generatePlan`, `adjustPlan`, `importPlanFromText`) por:
```ts
  return normalizePlanData(parseJson(raw, planDataSchema));
```

4. Atualizar o formato JSON nos prompts para pedir `kind`. Na constante `PLAN_JSON_FORMAT` e na cópia inline dentro de `buildSystemPrompt`, trocar a linha do exercício:
```
        "exercises": [ { "name": "string", "sets": number, "reps": "string", "restSeconds": number, "notes": "string", "kind": "strength" | "cardio" } ] }
```
E acrescentar uma regra ao `buildSystemPrompt` (na lista "REGRAS:"):
```
- Em cada exercício, defina "kind": "cardio" para esteira/corrida/bicicleta/elíptico/remo/pular corda/etc. e "strength" para exercícios de musculação com carga.
```

- [ ] **Step 5: Rodar e ver passar (normalizePlanData)**

Run: `cd api && npx vitest run src/services/ai/planGenerator.test.ts`
Expected: PASS.

- [ ] **Step 6: Backfill on-read no `/plans/current`**

Em `api/src/routes/plans.ts`:

1. Import no topo:
```ts
import { backfillWorkoutKinds } from "../services/exerciseKind.js";
```

2. Em `serializePlan`, aplicar o backfill no workout servido (planos antigos sem `kind`):
```ts
function serializePlan(plan: InstanceType<typeof Plan>) {
  const workout = backfillWorkoutKinds(plan.workout as { sessions: { exercises: { name: string; reps: string; kind?: "strength" | "cardio" }[] }[] });
  return {
    id: plan._id.toString(),
    version: plan.version,
    summary: plan.summary,
    workout,
    diet: plan.diet,
    disclaimer: plan.disclaimer,
    createdAt: plan.get("createdAt") as Date,
  };
}
```

- [ ] **Step 7: Teste de rota — `/plans/current` devolve kind em plano legado**

Em `api/src/routes/plans.test.ts`, adicionar um caso que cria um `Plan` diretamente (sem `kind` nos exercícios) e confere que `GET /plans/current` retorna `kind` preenchido. Use o padrão de auth já existente no arquivo (registro via `/auth/register` ou criação direta + token — siga o que o arquivo já faz). Esqueleto:

```ts
it("GET /plans/current preenche kind em planos sem o campo", async () => {
  // ...cria user + token no padrão do arquivo...
  await Plan.create({
    user: userId,
    version: 1,
    summary: "s",
    workout: { split: "A", daysPerWeek: 1, sessions: [{ day: "A", focus: "x", exercises: [
      { name: "Esteira", sets: 1, reps: "20 min", restSeconds: 0, notes: "" },
      { name: "Supino", sets: 4, reps: "8-12", restSeconds: 60, notes: "" },
    ] }] },
    diet: { dailyCalories: 2000, macros: { proteinG: 1, carbsG: 1, fatG: 1 }, meals: [], notes: "" },
    disclaimer: "d",
  });
  const res = await request(app).get("/plans/current").set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  const ex = res.body.plan.workout.sessions[0].exercises;
  expect(ex[0].kind).toBe("cardio");
  expect(ex[1].kind).toBe("strength");
});
```
(Confirme os nomes/imports observando os testes já existentes em `plans.test.ts`; ajuste a criação de user/token ao padrão do arquivo.)

- [ ] **Step 8: Rodar a suíte inteira**

Run: `cd api && npm test`
Expected: tudo verde (incluindo os novos casos).

- [ ] **Step 9: Commit**

```bash
git add api/src/models/Plan.ts api/src/services/ai/planGenerator.ts api/src/services/ai/planGenerator.test.ts api/src/routes/plans.ts api/src/routes/plans.test.ts
git commit -m "feat: kind por exercício (schema + IA + backfill on-read)"
```

---

### Task 3: Campos de cardio no check-in (`durationMin`/`distanceKm`)

**Files:**
- Modify: `api/src/models/WorkoutLog.ts`
- Test: `api/src/routes/checkins.test.ts` (existente — adicionar caso)

**Interfaces:**
- Produces:
  - `logEntrySchema` aceita `durationMin?: number` e `distanceKm?: number`.
  - O sub-documento `entries` do `WorkoutLog` persiste `durationMin` e `distanceKm` (default 0).

- [ ] **Step 1: Escrever o teste que falha (persistência de cardio)**

Em `api/src/routes/checkins.test.ts`, adicionar um caso que faz `POST /checkins` com uma entry de cardio e confere que duração/distância voltam no histórico. Siga o padrão de auth já usado no arquivo (`token` via `/auth/register`). Esqueleto:

```ts
it("persiste durationMin/distanceKm numa entry de cardio", async () => {
  // token já criado no setup do arquivo (auth() helper)
  const res = await auth(
    request(app).post("/checkins")
  ).send({
    sessionDay: "A",
    entries: [{ exerciseName: "Esteira", durationMin: 30, distanceKm: 5 }],
  });
  expect(res.status).toBe(201);

  const hist = await auth(request(app).get("/checkins"));
  const entry = hist.body.logs[0].entries[0];
  expect(entry.durationMin).toBe(30);
  expect(entry.distanceKm).toBe(5);
});
```
(Confirme o helper `auth`/endpoints observando o arquivo; a rota de histórico é `GET /checkins`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/routes/checkins.test.ts`
Expected: FAIL — `durationMin`/`distanceKm` não são aceitos/persistidos (undefined no retorno).

- [ ] **Step 3: Implementar**

Em `api/src/models/WorkoutLog.ts`:

1. Ampliar o `logEntrySchema` (zod):
```ts
export const logEntrySchema = z.object({
  exerciseName: z.string().min(1),
  weightKg: z.number().min(0).max(1000).optional(),
  reps: z.number().int().min(0).max(1000).optional(),
  durationMin: z.number().min(0).max(1440).optional(),
  distanceKm: z.number().min(0).max(1000).optional(),
});
```

2. Ampliar o sub-schema Mongoose de `entries`:
```ts
    entries: [
      {
        exerciseName: { type: String, required: true },
        weightKg: { type: Number, default: 0 },
        reps: { type: Number, default: 0 },
        durationMin: { type: Number, default: 0 },
        distanceKm: { type: Number, default: 0 },
        _id: false,
      },
    ],
```

Verifique que o `serializeLog` da rota (`api/src/routes/checkins.ts`) devolve `entries: log.entries` (já devolve o objeto inteiro — os novos campos passam automaticamente). Se o serialize montar campos manualmente, inclua `durationMin`/`distanceKm`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx vitest run src/routes/checkins.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/models/WorkoutLog.ts api/src/routes/checkins.test.ts
git commit -m "feat: durationMin/distanceKm nas entries de check-in"
```

---

### Task 4: Endpoint `GET /checkins/cardio-progress`

**Files:**
- Modify: `api/src/routes/checkins.ts`
- Test: `api/src/routes/checkins.test.ts` (existente — adicionar casos)

**Interfaces:**
- Produces: `GET /checkins/cardio-progress` → `{ exercises: [{ name, points: [{ date, durationMin, distanceKm }] }] }`, entries de cardio (`durationMin>0 || distanceKm>0`), mais treinados primeiro.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/src/routes/checkins.test.ts`, adicionar:

```ts
it("GET /checkins/cardio-progress agrega só entries de cardio, por exercício", async () => {
  await auth(request(app).post("/checkins")).send({
    sessionDay: "A",
    entries: [
      { exerciseName: "Esteira", durationMin: 30, distanceKm: 5 },
      { exerciseName: "Supino", weightKg: 40, reps: 10 }, // NÃO é cardio
    ],
  });
  await auth(request(app).post("/checkins")).send({
    sessionDay: "A",
    entries: [{ exerciseName: "Esteira", durationMin: 32, distanceKm: 5.5 }],
  });

  const res = await auth(request(app).get("/checkins/cardio-progress"));
  expect(res.status).toBe(200);
  const names = res.body.exercises.map((e: { name: string }) => e.name);
  expect(names).toContain("Esteira");
  expect(names).not.toContain("Supino");
  const esteira = res.body.exercises.find((e: { name: string }) => e.name === "Esteira");
  expect(esteira.points).toHaveLength(2);
  expect(esteira.points[0]).toMatchObject({ durationMin: 30, distanceKm: 5 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/routes/checkins.test.ts`
Expected: FAIL — rota 404.

- [ ] **Step 3: Implementar a rota**

Em `api/src/routes/checkins.ts`, adicionar (perto da rota `/progress`, seguindo o mesmo estilo):

```ts
// Evolução de cardio: séries de duração/distância por exercício (pace é derivado no app).
checkinsRouter.get(
  "/cardio-progress",
  asyncHandler(async (req, res) => {
    const logs = await WorkoutLog.find({ user: req.user!._id }).sort({ date: 1 });

    const byExercise = new Map<string, { date: Date; durationMin: number; distanceKm: number }[]>();
    for (const log of logs) {
      for (const e of log.entries) {
        const durationMin = e.durationMin ?? 0;
        const distanceKm = e.distanceKm ?? 0;
        if (durationMin <= 0 && distanceKm <= 0) continue; // não é cardio
        const points = byExercise.get(e.exerciseName) ?? [];
        points.push({ date: log.date, durationMin, distanceKm });
        byExercise.set(e.exerciseName, points);
      }
    }

    const exercises = [...byExercise.entries()]
      .map(([name, points]) => ({ name, points }))
      .sort((a, b) => b.points.length - a.points.length);

    res.json({ exercises });
  })
);
```

- [ ] **Step 4: Rodar e ver passar + suíte inteira**

Run: `cd api && npx vitest run src/routes/checkins.test.ts`
Expected: PASS.
Run: `cd api && npm test`
Expected: tudo verde (o teste de regressão do `/progress` continua passando).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/checkins.ts api/src/routes/checkins.test.ts
git commit -m "feat: GET /checkins/cardio-progress"
```

---

### Task 5: Generalizar o `LineChart` (`weightKg` → `value`)

**Files:**
- Modify: `app-android/src/components/LineChart.tsx`
- Modify: `app-android/src/screens/HistoryScreen.tsx` (único caller — manter compilando)

**Interfaces:**
- Produces:
  - `ChartPoint = { date: string; value: number }`.
  - `LineChart({ points, width, height?, formatValue? }: { points: ChartPoint[]; width: number; height?: number; formatValue?: (v: number) => string })`. `formatValue` default `(v) => String(Math.round(v))`; usado nos rótulos de eixo (máx/mín) e no rótulo direto do último ponto.

- [ ] **Step 1: Generalizar o componente**

Em `app-android/src/components/LineChart.tsx`:

1. Trocar a interface:
```ts
export interface ChartPoint {
  date: string;
  value: number;
}
```

2. Assinatura e uso do valor:
```ts
export function LineChart({
  points,
  width,
  height = 200,
  formatValue = (v: number) => String(Math.round(v)),
}: {
  points: ChartPoint[];
  width: number;
  height?: number;
  formatValue?: (v: number) => string;
}) {
```

3. Trocar todas as referências a `weightKg`/`w` por `value`:
   - `const values = points.map((p) => p.value);` (renomear `weights`→`values`, `min = Math.min(...values)`, `max = Math.max(...values)`).
   - `const coords = points.map((p, i) => ({ px: x(i), py: y(p.value), v: p.value }));`
   - `const last = coords[coords.length - 1];`
4. Trocar os rótulos que usavam número cru/`kg`:
   - Rótulos de eixo Y: `{formatValue(max)}` e `{formatValue(min)}` (no lugar de `{Math.round(max)}`/`{Math.round(min)}`).
   - Rótulo direto do último ponto: `{formatValue(last.v)}` (no lugar de `{last.w}kg`).

- [ ] **Step 2: Atualizar o caller de carga no HistoryScreen (manter compilando)**

Em `app-android/src/screens/HistoryScreen.tsx`, na seção de carga: onde hoje passa `points={current.points}` para o `LineChart`, mapear para `{ date, value }` e formatar em kg:

```tsx
<LineChart
  points={current.points.map((p) => ({ date: p.date, value: p.weightKg }))}
  width={chartWidth}
  formatValue={(v) => `${Math.round(v)}kg`}
/>
```
(O tipo `ExerciseProgress.points[].weightKg` continua vindo do backend; a conversão para `value` é local ao render.)

- [ ] **Step 3: Verificar typecheck**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app-android/src/components/LineChart.tsx app-android/src/screens/HistoryScreen.tsx
git commit -m "refactor: LineChart genérico (value + formatValue)"
```

---

### Task 6: Tipos no app (kind, cardio entry, cardio-progress)

**Files:**
- Modify: `app-android/src/api/plans.ts` (`Exercise`)
- Modify: `app-android/src/api/checkins.ts` (`CheckInEntry`, novo `CardioProgress` + `getCardioProgress`)

**Interfaces:**
- Produces:
  - `Exercise` ganha `kind?: "strength" | "cardio"`.
  - `CheckInEntry` ganha `durationMin?: number`, `distanceKm?: number`.
  - `interface CardioProgress { name: string; points: { date: string; durationMin: number; distanceKm: number }[] }`.
  - `getCardioProgress(token: string): Promise<{ exercises: CardioProgress[] }>`.

- [ ] **Step 1: Ampliar `Exercise`**

Em `app-android/src/api/plans.ts`, no `interface Exercise`:
```ts
export interface Exercise {
  name: string;
  sets: number;
  reps: string;
  restSeconds?: number;
  notes?: string;
  kind?: "strength" | "cardio";
}
```
(Adicione só o `kind` se `restSeconds`/`notes` já existirem; não remova campos.)

- [ ] **Step 2: Ampliar `CheckInEntry` + adicionar cardio-progress**

Em `app-android/src/api/checkins.ts`:

```ts
export interface CheckInEntry {
  exerciseName: string;
  weightKg?: number;
  reps?: number;
  durationMin?: number;
  distanceKm?: number;
}
```

E ao final do arquivo:
```ts
export interface CardioProgress {
  name: string;
  points: { date: string; durationMin: number; distanceKm: number }[];
}

export function getCardioProgress(token: string) {
  return apiFetch<{ exercises: CardioProgress[] }>("/checkins/cardio-progress", { token });
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app-android/src/api/plans.ts app-android/src/api/checkins.ts
git commit -m "feat: tipos de kind, cardio entry e cardio-progress no app"
```

---

### Task 7: Check-in com layout por tipo (`CheckInScreen`)

**Files:**
- Modify: `app-android/src/screens/CheckInScreen.tsx`

**Interfaces:**
- Consumes: `Exercise.kind` (Task 6), `CheckInEntry.durationMin/distanceKm` (Task 6).

- [ ] **Step 1: Row por tipo + estado**

Em `app-android/src/screens/CheckInScreen.tsx`:

1. Ampliar `Row` e `makeRows`:
```ts
interface Row {
  name: string;
  kind: "strength" | "cardio";
  target: string;
  done: boolean;
  weight: string;
  reps: string;
  duration: string;
  distance: string;
}

const makeRows = (): Row[] =>
  session.exercises.map((e) => ({
    name: e.name,
    kind: e.kind === "cardio" ? "cardio" : "strength", // fallback trivial se ausente
    target: `${e.sets} × ${e.reps}`,
    done: false,
    weight: "",
    reps: "",
    duration: "",
    distance: "",
  }));
```

2. Ampliar `updateField` para os novos campos:
```ts
function updateField(i: number, field: "weight" | "reps" | "duration" | "distance", value: string) {
  setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
}
```

3. Guarda no restore do rascunho (Row mudou de forma): ao aplicar `saved.rows`, complete campos ausentes. Trocar `if (sameSession) setRows(saved.rows);` por:
```ts
if (sameSession) {
  setRows(saved.rows.map((r) => ({
    duration: "",
    distance: "",
    ...r,
    kind: r.kind ?? "strength",
  })));
}
```

- [ ] **Step 2: Render por tipo + pace derivado**

Substituir o bloco `inputsRow` + o `<Text style={styles.hint}>...` dentro de cada card por um render condicional ao `row.kind`:

```tsx
{row.kind === "cardio" ? (
  <>
    <View style={styles.inputsRow}>
      <View style={styles.inputWrap}>
        <Text style={styles.inputLabel}>Duração (min)</Text>
        <TextInput
          style={styles.input}
          value={row.duration}
          onChangeText={(v) => updateField(i, "duration", v)}
          keyboardType="numeric"
          placeholder="—"
          placeholderTextColor={colors.textMuted}
        />
      </View>
      <View style={styles.inputWrap}>
        <Text style={styles.inputLabel}>Distância (km)</Text>
        <TextInput
          style={styles.input}
          value={row.distance}
          onChangeText={(v) => updateField(i, "distance", v)}
          keyboardType="numeric"
          placeholder="—"
          placeholderTextColor={colors.textMuted}
        />
      </View>
    </View>
    {paceLabel(row) ? <Text style={styles.hint}>Pace médio: {paceLabel(row)}</Text> : null}
  </>
) : (
  <View style={styles.inputsRow}>
    <View style={styles.inputWrap}>
      <Text style={styles.inputLabel}>Carga (kg)</Text>
      <TextInput
        style={styles.input}
        value={row.weight}
        onChangeText={(v) => updateField(i, "weight", v)}
        keyboardType="numeric"
        placeholder="—"
        placeholderTextColor={colors.textMuted}
      />
    </View>
    <View style={styles.inputWrap}>
      <Text style={styles.inputLabel}>Reps</Text>
      <TextInput
        style={styles.input}
        value={row.reps}
        onChangeText={(v) => updateField(i, "reps", v)}
        keyboardType="numeric"
        placeholder="—"
        placeholderTextColor={colors.textMuted}
      />
    </View>
  </View>
)}
```

Adicionar o helper `paceLabel` (fora do JSX, dentro do componente ou acima dele):
```ts
function paceLabel(row: { duration: string; distance: string }): string | null {
  const min = Number(row.duration);
  const km = Number(row.distance);
  if (!min || !km) return null;
  const pace = min / km; // min/km
  const mm = Math.floor(pace);
  const ss = Math.round((pace - mm) * 60);
  const ssStr = ss === 60 ? "00" : String(ss).padStart(2, "0");
  const mmAdj = ss === 60 ? mm + 1 : mm;
  return `${mmAdj}:${ssStr} /km`;
}
```

- [ ] **Step 3: `handleFinish` por tipo**

Trocar o `.map` que monta `entries` para ramificar pelo `kind`:
```ts
const entries: CheckInEntry[] = rows
  .filter((r) => r.done)
  .map((r) =>
    r.kind === "cardio"
      ? {
          exerciseName: r.name,
          ...(r.duration !== "" ? { durationMin: Number(r.duration) || 0 } : {}),
          ...(r.distance !== "" ? { distanceKm: Number(r.distance) || 0 } : {}),
        }
      : {
          exerciseName: r.name,
          ...(r.weight !== "" ? { weightKg: Number(r.weight) || 0 } : {}),
          ...(r.reps !== "" ? { reps: Number(r.reps) || 0 } : {}),
        }
  );
```

- [ ] **Step 4: Verificar typecheck**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add app-android/src/screens/CheckInScreen.tsx
git commit -m "feat: check-in com campos por tipo (cardio: duração/distância/pace)"
```

---

### Task 8: Evolução de cardio no `HistoryScreen` (toggle + métrica)

**Files:**
- Modify: `app-android/src/screens/HistoryScreen.tsx`

**Interfaces:**
- Consumes: `getCardioProgress`, `CardioProgress` (Task 6); `LineChart` genérico + `formatValue` (Task 5).

- [ ] **Step 1: Estado do modo + carga do cardio**

Em `app-android/src/screens/HistoryScreen.tsx`:

1. Imports: adicionar `getCardioProgress, type CardioProgress` ao import de `../api/checkins`.
2. Estado:
```ts
const [mode, setMode] = useState<"strength" | "cardio">("strength");
const [cardio, setCardio] = useState<CardioProgress[]>([]);
const [cardioSel, setCardioSel] = useState<string | null>(null);
const [metric, setMetric] = useState<"pace" | "distance" | "duration">("pace");
```
3. No `load`, buscar também o cardio (mantendo o resto):
```ts
const [prog, hist, card] = await Promise.all([
  getProgress(token!),
  getHistory(token!),
  getCardioProgress(token!),
]);
setExercises(prog.exercises);
setLogs(hist.logs);
setCardio(card.exercises);
setSelected((cur) => cur ?? prog.exercises[0]?.name ?? null);
setCardioSel((cur) => cur ?? card.exercises[0]?.name ?? null);
```

- [ ] **Step 2: Helpers de métrica (fora do componente)**

```ts
const METRICS = [
  { key: "pace" as const, label: "Pace" },
  { key: "distance" as const, label: "Distância" },
  { key: "duration" as const, label: "Duração" },
];

function metricValue(
  p: { durationMin: number; distanceKm: number },
  metric: "pace" | "distance" | "duration"
): number | null {
  if (metric === "duration") return p.durationMin > 0 ? p.durationMin : null;
  if (metric === "distance") return p.distanceKm > 0 ? p.distanceKm : null;
  // pace
  if (p.durationMin > 0 && p.distanceKm > 0) return p.durationMin / p.distanceKm;
  return null;
}

function fmtMetric(v: number, metric: "pace" | "distance" | "duration"): string {
  if (metric === "distance") return `${v.toFixed(1)}km`;
  if (metric === "duration") return `${Math.round(v)}min`;
  const mm = Math.floor(v);
  const ss = Math.round((v - mm) * 60);
  const ssStr = ss === 60 ? "00" : String(ss).padStart(2, "0");
  return `${ss === 60 ? mm + 1 : mm}:${ssStr}`;
}
```

- [ ] **Step 3: Toggle + render do modo cardio**

1. Logo após o `<Text style={styles.title}>` (ou substituindo-o), adicionar o toggle:
```tsx
<View style={styles.toggle}>
  {(["strength", "cardio"] as const).map((m) => (
    <TouchableOpacity
      key={m}
      style={[styles.toggleBtn, mode === m && styles.toggleOn]}
      onPress={() => setMode(m)}
    >
      <Text style={[styles.toggleText, mode === m && styles.toggleTextOn]}>
        {m === "strength" ? "Musculação" : "Cardio"}
      </Text>
    </TouchableOpacity>
  ))}
</View>
```

2. Envolver o bloco de carga existente em `{mode === "strength" && ( ... )}` e adicionar o bloco cardio `{mode === "cardio" && ( ... )}`:
```tsx
{mode === "cardio" && (
  cardio.length === 0 ? (
    <View style={styles.card}>
      <Text style={styles.emptyText}>
        Registre treinos de cardio com duração e distância para ver sua evolução. 🏃
      </Text>
    </View>
  ) : (
    <>
      {/* Seletor de exercício de cardio */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {cardio.map((e) => (
          <TouchableOpacity
            key={e.name}
            style={[styles.chip, cardioSel === e.name && styles.chipOn]}
            onPress={() => setCardioSel(e.name)}
          >
            <Text style={[styles.chipText, cardioSel === e.name && styles.chipTextOn]}>{e.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Seletor de métrica */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {METRICS.map((mt) => (
          <TouchableOpacity
            key={mt.key}
            style={[styles.chip, metric === mt.key && styles.chipOn]}
            onPress={() => setMetric(mt.key)}
          >
            <Text style={[styles.chipText, metric === mt.key && styles.chipTextOn]}>{mt.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {(() => {
        const cur = cardio.find((e) => e.name === cardioSel) ?? null;
        if (!cur) return null;
        const pts = cur.points
          .map((p) => ({ date: p.date, value: metricValue(p, metric) }))
          .filter((p): p is { date: string; value: number } => p.value !== null);
        return (
          <View style={styles.card}>
            <Text style={styles.headline}>{cur.name}</Text>
            {pts.length > 0 && (
              <Text style={styles.subtle}>
                {fmtMetric(pts[0].value, metric)} → {fmtMetric(pts[pts.length - 1].value, metric)}
                {" · "}{pts.length} registro(s)
              </Text>
            )}
            {pts.length === 0 ? (
              <Text style={styles.subtle}>Sem dados dessa métrica para este exercício.</Text>
            ) : pts.length > 1 ? (
              <LineChart points={pts} width={chartWidth} formatValue={(v) => fmtMetric(v, metric)} />
            ) : (
              <Text style={styles.subtle}>Registre mais vezes para ver a curva.</Text>
            )}
          </View>
        );
      })()}
    </>
  )
)}
```

3. Ajustar o título: trocar o texto fixo "Evolução de carga" por dinâmico:
```tsx
<Text style={styles.title}>{mode === "strength" ? "Evolução de carga" : "Evolução de cardio"}</Text>
```

- [ ] **Step 4: Estilos do toggle**

Adicionar ao `StyleSheet.create`:
```ts
toggle: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
toggleBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
toggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
toggleText: { color: colors.textMuted, fontWeight: "700" },
toggleTextOn: { color: colors.primaryText },
```
(Reutiliza `chip`/`chipOn`/`chipText`/`chipTextOn`/`headline`/`card`/`subtle`/`emptyText` já existentes.)

- [ ] **Step 5: Verificar typecheck + bundle web**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros.
Run: `cd app-android && npx expo export --platform web`
Expected: bundle compila (exit 0). Depois: `rm -rf dist`.

- [ ] **Step 6: Commit**

```bash
git add app-android/src/screens/HistoryScreen.tsx
git commit -m "feat: evolução de cardio no histórico (toggle + métrica)"
```

---

## Validação final (manual, pelo Asafe)

- Backend: `cd api && npm test` (tudo verde).
- App no emulador/web: gerar/abrir um plano com cardio → no check-in, exercício de cardio mostra Duração/Distância + Pace (sem kg/reps); musculação mostra kg/reps.
- Registrar alguns cardios com duração+distância → HistoryScreen → toggle "Cardio" → trocar métrica (Pace/Distância/Duração) e ver a curva.
- Confirmar que o modo "Musculação" continua igual e que o gráfico de carga não regrediu.

## Notas de verificação para o implementador

- `api/src/routes/plans.test.ts` e `checkins.test.ts`: use o padrão de criação de usuário/token já presente no arquivo (helper `auth`, `/auth/register`) — os esqueletos acima podem precisar ajustar nomes.
- `serializeLog` em `checkins.ts`: confirme que devolve `entries` inteiras (os campos novos passam automaticamente); se montar manualmente, inclua `durationMin`/`distanceKm`.
- `HistoryScreen`: confirme os nomes exatos dos estilos reutilizados (`chip`, `chipOn`, `chipText`, `chipTextOn`, `card`, `headline`, `subtle`, `emptyText`) antes de referenciá-los.
- App sem test runner: a lógica de métrica/pace não tem teste automatizado — reveja com cuidado no self-review.
