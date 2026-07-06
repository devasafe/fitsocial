# Cardio no check-in + evolução de cardio — Design

**Data:** 2026-07-05
**Status:** Desenho aprovado. Aguardando revisão da spec.
**Branch:** `feat/videos-exercicios` (ainda não mergeada; mesma tela de check-in, segue junto)

## Problema

No check-in ao vivo (`CheckInScreen`), **todo** exercício mostra os campos "Carga (kg)" e "Reps" — inclusive cardio (esteira, corrida, bike), onde carga/reps não fazem sentido. Além disso, a evolução (`HistoryScreen`) só plota carga e **ignora cardio** — não há como acompanhar progresso de cardio.

## Objetivo

1. No check-in, mostrar os campos **certos por tipo de exercício**: musculação → carga + reps; cardio → duração + distância (com **pace médio** derivado). 
2. Adicionar um **gráfico de evolução de cardio separado**, com seletor de métrica (pace / distância / duração).

## Decisão de arquitetura

**O backend é o dono da classificação** (tem Vitest; o app não tem test runner). O app apenas **lê** `exercise.kind` — nenhuma heurística fica no app sem cobertura de teste.

## Backend (`api/`)

### 1. Tipo do exercício no plano
`api/src/models/Plan.ts` — `exerciseSchema` ganha:
```ts
kind: z.enum(["strength", "cardio"]).optional(),
```
Opcional na saída da IA; preenchido pela normalização (abaixo) quando ausente.

### 2. Classificador (testado)
`api/src/services/exerciseKind.ts` — `classifyExerciseKind(name: string, reps?: string): "strength" | "cardio"`:
- Heurística por palavra-chave no nome (normalizado sem acento/caixa): `esteira, corrida, correr, caminhada, caminhar, bike, bicicleta, ciclismo, spinning, eliptico, transport, remo, remador, escada, stair, pular corda, corda, hiit, cardio, natacao, nadar, aerobico`.
- E por formato do `reps`: contém `min`, `km`, `m ` de metros, ou `:` (tempo) ou padrão `\d+\s*s` (segundos) → indica cardio.
- Default: `"strength"`.

### 3. Normalização do plano (um único ponto, testado)
`api/src/services/ai/planGenerator.ts` (ou helper próprio) — `normalizePlanData(plan: PlanData): PlanData`:
- Para cada exercício de cada sessão: `ex.kind = ex.kind ?? classifyExerciseKind(ex.name, ex.reps)`. **Só preenche quando falta** — confia no valor que a IA mandar.
- Chamada em: `generatePlan`, `importPlanFromText`, `adjustPlan` (após `parseJson`, antes de retornar/salvar).
- Chamada também em `GET /plans/current` (`api/src/routes/plans.ts`) para planos **antigos** sem `kind`, de modo que a API sempre devolve `kind` concreto. (Backfill on-read; sem migração.)

### 4. Prompt da IA
`planGenerator.ts` — o `PLAN_JSON_FORMAT` e as instruções passam a pedir `"kind": "strength" | "cardio"` em cada exercício (marque cardio para esteira/corrida/bike/etc.). Planos novos já vêm corretos; a normalização é rede de segurança.

### 5. Entradas de cardio no check-in
`api/src/models/WorkoutLog.ts`:
- `logEntrySchema` (zod) ganha `durationMin: z.number().min(0).max(1440).optional()` e `distanceKm: z.number().min(0).max(1000).optional()`.
- O sub-schema Mongoose de `entries` ganha `durationMin: { type: Number, default: 0 }` e `distanceKm: { type: Number, default: 0 }` (`_id: false` mantém).
- **Pace não é guardado** — é derivado (`durationMin / distanceKm`).

### 6. Endpoint de progresso de cardio
`api/src/routes/checkins.ts` — novo `GET /checkins/cardio-progress` (irmão do `/progress`, que **permanece** só de carga):
- Varre `WorkoutLog` do usuário ordenado por data. Uma entrada é "cardio" se `durationMin > 0 || distanceKm > 0`.
- Agrupa por `exerciseName`: `points: [{ date, durationMin, distanceKm }]`.
- Ordena por mais treinados primeiro (nº de pontos), igual ao `/progress`.
- Resposta: `{ exercises: [{ name, points }] }`.
- O pace é derivado no app; o endpoint entrega os dados brutos (uma série alimenta as 3 métricas).

## App (`app-android/`)

### 7. Check-in por tipo — `CheckInScreen.tsx`
- `Row` ganha `kind: "strength" | "cardio"` e os campos `duration: string` e `distance: string` (além de `weight`/`reps`). `makeRows` lê `e.kind` do exercício (garantido presente pela API).
- Render por `row.kind`:
  - **strength:** "Carga (kg)" + "Reps" (como hoje).
  - **cardio:** "Duração (min)" + "Distância (km)"; abaixo, **"Pace médio: X:XX /km"** derivado (`duration/distance`), oculto quando distância vazia/0. **Sem** carga/reps. Remove o aviso genérico "Cardio? É só marcar ✓".
- `handleFinish` monta a entry conforme `kind`:
  - strength → `{ exerciseName, weightKg?, reps? }` (como hoje).
  - cardio → `{ exerciseName, durationMin?, distanceKm? }`.
- Autosave/rascunho: `Row` mudou de forma; ao restaurar um rascunho antigo, os novos campos ausentes default para `""` (guardar por `?? ""`), sem quebrar.

### 8. Tipos
- `app-android/src/api/checkins.ts`: `CheckInEntry` ganha `durationMin?: number`, `distanceKm?: number`. Novo `CardioProgress`/`CardioPoint` e `getCardioProgress(token)` → `GET /checkins/cardio-progress`.
- O tipo de exercício nos params de navegação (`navigation/types.ts`) ganha `kind?: "strength" | "cardio"`.

### 9. Gráfico genérico
`app-android/src/components/LineChart.tsx`: `ChartPoint` passa de `{ date, weightKg }` para `{ date, value }` (numérico genérico); o componente plota `p.value`. Único caller atual (seção de carga do `HistoryScreen`) passa a mapear `value: p.weightKg`.

### 10. Evolução com toggle — `HistoryScreen.tsx`
- **Toggle no topo: "Musculação | Cardio"** (segmented). Mantém os gráficos separados.
- **Musculação (modo atual):** chips de exercício + gráfico de carga + delta — inalterado (agora passando `value: weightKg` ao `LineChart`).
- **Cardio:** carrega `getCardioProgress`; chips de exercício de cardio + **chips de métrica (Pace / Distância / Duração)** + `LineChart` da métrica escolhida + delta.
  - Mapeamento de métrica → `value`: `distancia = distanceKm`; `duracao = durationMin`; `pace = durationMin / distanceKm` (min/km).
  - Pontos sem `distanceKm > 0` são excluídos quando a métrica é **pace** ou **distância** (pace indefinido / distância zero).
  - Estado vazio próprio: "Registre treinos de cardio com duração e distância para ver sua evolução. 🏃".

## Fluxo de dados

```
Plano (IA marca kind | normalizePlanData preenche o que falta; /current backfill p/ legado)
  → session.exercises[].kind chega ao CheckInScreen
     → layout por kind; cardio salva durationMin/distanceKm
        → WorkoutLog
           → GET /checkins/cardio-progress agrega entries cardio por exercício
              → HistoryScreen (modo Cardio): métrica escolhida → LineChart
```

## Tratamento de erros / degradação
- `kind` sempre presente na API (normalização + backfill); se ainda assim vier ausente, o app trata `undefined` como `"strength"` (fallback trivial, sem heurística).
- `getCardioProgress` falhando não quebra o modo Musculação (cargas independentes); estado vazio quando não há dados de cardio.
- Pace com distância 0 → não exibido (evita divisão por zero).

## Testes
Backend (Vitest + mongodb-memory-server, padrão do repo):
- `classifyExerciseKind`: casos de cardio por nome ("Esteira", "Corrida 5km", "Bike 30 min") e por formato de reps; strength por padrão ("Supino", "Agachamento").
- `normalizePlanData`: preenche `kind` só quando ausente; **não** sobrescreve `kind` que a IA mandou; cobre todas as sessões/exercícios.
- `createLogSchema`/`logEntrySchema`: aceita `durationMin`/`distanceKm`; persiste no `WorkoutLog`.
- `GET /checkins/cardio-progress`: filtra só entries de cardio, agrupa por exercício, ordena por mais treinados; ignora entries de carga.
- `GET /checkins/progress`: teste de regressão — continua só carga, inalterado.

App: typecheck (`npx tsc --noEmit`). Sem runner — validação visual pelo Asafe (inclui web: `expo export -p web`).

## Fora de escopo (YAGNI)
- Pace não é persistido (derivado).
- Sem tela nova: cardio entra no `HistoryScreen` via toggle.
- Sem métricas extras de cardio (fc, calorias) por ora.
