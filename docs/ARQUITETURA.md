# FitSocial — Arquitetura

> Fonte de verdade **técnica**. Para o produto e o porquê, veja [`VISAO.md`](./VISAO.md).
> Segurança e rotação de segredos: [`SECURITY.md`](./SECURITY.md).
>
> Este documento descreve **o que existe hoje** e **o alvo** das próximas fases. Onde algo
> ainda não foi construído, está marcado como _(alvo — Fase N)_. Não invente estrutura fora
> do que está aqui; se algo estiver errado ou faltando, corrija o documento antes de codar.

## 1. Stack real (hoje)

Monorepo em `D:\PROJETOS\FitSocial`, repo GitHub `devasafe/fitsocial`.

```
FitSocial/
├─ api/          Backend — Node 20+ · Express · TypeScript (strict) · MongoDB/Mongoose
└─ app-android/  App — React Native (Expo). Roda também como web (Expo export).
```

- **Backend**: Express + Mongoose. Entrypoint `api/src/index.ts` (→ `createApp()` em
  `api/src/app.ts`). ESM com imports `.js` (NodeNext). Validação com **zod**.
- **Dependências de runtime**: express, mongoose, zod, multer, bcryptjs, jsonwebtoken, cors,
  dotenv, @aws-sdk/client-s3, sharp. **Não há** Redis, BullMQ nem processo worker. Um único
  processo web. O MinIO existe como serviço na VPS, não como dependência do processo.
- **Testes**: vitest + supertest + `mongodb-memory-server` (Mongo em memória).
- **App**: Expo / React Native. Estrutura em `app-android/src/`:
  `api/ · components/ · context/ · navigation/ · screens/ · theme.ts · config.ts`.

### Deploy atual

Tudo roda na **VPS via Coolify** (projeto `FitSocial`, environment `production`).
Detalhes operacionais, coordenadas e armadilhas: [`INFRA.md`](./INFRA.md).

- **API** → `https://fitapi.satriz.club` (Dockerfile em `api/Dockerfile`).
- **Web (Expo export)** → `https://fit.satriz.club` (Dockerfile em `app-android/Dockerfile`).
- **Fotos** → MinIO, leitura pública em `https://fitcdn.satriz.club/fotos`.
- **Banco** → MongoDB self-hosted na própria VPS, **fechado para a internet** (só rede Docker).
- **IA** → Google Gemini free tier (`gemini-2.5-flash` é o modelo que funciona no free tier).

> **Migração executada em 09/09/2026.** Render e Vercel foram aposentados; o Atlas deixou de
> ser a origem dos dados (88 documentos migrados). O domínio `satriz.club` é **provisório** —
> quando houver domínio próprio, basta trocar DNS + as env `CORS_ORIGIN`,
> `MEDIA_PUBLIC_BASE_URL` e `EXPO_PUBLIC_API_URL`. Nenhum código muda.

## 2. Estrutura do backend (real)

Organização **flat por tipo**, não por módulo:

```
api/src/
├─ index.ts            bootstrap (connect + listen)
├─ app.ts              montagem do Express, registro de rotas, 404, errorHandler
├─ config/             env.ts (env tipado), db.ts (connect)
├─ middleware/         auth (requireAuth), error, rateLimit (janela em memória)
├─ models/             Mongoose + schemas zod colados ao modelo
├─ routes/             cada arquivo = um router; hoje concentram validação + regra + acesso a dados
├─ services/           regra de negócio já extraída de alguns domínios
│   ├─ ai/             camada de IA desacoplada (ver §4)
│   ├─ adherence.ts    streak/semana/total a partir de WorkoutLog
│   ├─ badges.ts       cálculo de badges
│   └─ planGenerator.ts, coach.ts, knowledgeBase.ts, exerciseKind.ts, exerciseVideo.ts
└─ utils/              asyncHandler, httpError
```

Observações honestas sobre o estado atual (não são bugs, são o ponto de partida):
- **Rotas fazem tudo** em vários domínios (ex.: `routes/social.ts` valida com zod, aplica
  regra e chama Mongoose direto). Não há camada `repository` nem `controller`.
- **Envelope de resposta é ad-hoc** (`{ posts: [...] }`, `{ user, counts, ... }`), não
  padronizado.
- **Paginação por `limit`/`sort(createdAt)`**, não por cursor.
- A camada de **IA já é bem isolada** (`services/ai/`, interface `AIProvider`) — manter.

## 3. Convenção para código NOVO

Não vamos reescrever o que já funciona só por consistência (YAGNI). Mas todo **módulo novo**
(a partir da Fase 2) segue um padrão pragmático de camadas:

```
model      Mongoose model + tipos
schema     schemas zod (entrada validada ANTES da regra)
service    regra de negócio; é onde vive a lógica testável
routes     finas: validam com o schema, chamam o service, serializam a resposta
test       teste de integração do endpoint (Mongo em memória)
```

Regras:
- **Rota não contém regra de negócio** — delega ao service. (Retrofit de rotas antigas só
  quando forem tocadas por uma feature.)
- **Toda entrada validada por zod** antes de chegar à regra.
- **Envelope padronizado** `{ data, meta }` / `{ error: { code, message } }` **em endpoints
  novos**. Endpoints antigos migram quando forem alterados, não em massa.
- **Paginação por cursor** em listas que podem crescer (feed, atividades). Endpoints estáveis
  pequenos podem seguir com `limit`.
- **TypeScript strict, zero `any`** sem comentário justificando.
- **Teste de integração para todo endpoint novo.** Teste é a âncora de memória entre sessões:
  é o que impede uma fase futura de quebrar uma anterior em silêncio.
- **IDs de esporte são strings estáveis** (`'musculacao'`, `'corrida'`, `'jiu_jitsu'`), nunca
  ObjectId. Dinheiro sempre em centavos (inteiro). Datas em UTC no banco; conversão para
  `America/Sao_Paulo` só na borda.

## 4. Camada de IA

Isolada atrás da interface `AIProvider` (`api/src/services/ai/`). `getAIProvider()` é um
singleton escolhido por env (`AI_PROVIDER`, default `gemini`); `setAIProvider()` injeta mock
nos testes; `parseJson()` limpa cercas ```` ```json ```` e valida contra zod, lançando
`AIError` com mensagem clara.

**Regra**: nunca chamar o SDK/HTTP do Gemini fora de `services/ai/`. Trocar de LLM = nova
implementação de `AIProvider` + apontar o factory. A IA não é treinada/fine-tunada: aterra em
conhecimento curado (`knowledgeBase.ts`) + prompt, e valida a saída com zod.

## 5. Modelo de dados

### 5.1 Modelos existentes (hoje)

- **User** — name, email, passwordHash, `username` (unique/sparse), avatarUrl, bio,
  `tier` (`free`|`premium`), onboardingComplete.
- **Profile** — a ficha (1:1 com User): goal, sex, age, heightCm, weightKg, experienceLevel,
  daysPerWeek, sessionMinutes, dietaryRestrictions[], injuriesConditions[], notes.
- **Plan** — versionado por user; `workout` e `diet` como `Mixed` (validados por
  `planDataSchema` na saída da IA). Workout = split + sessions[] (day/focus/exercises[]).
- **WorkoutLog** — check-in de uma sessão: user, planVersion, `sessionDay`, entries[]
  (`exerciseName`, weightKg, reps, durationMin, distanceKm), notes. Alimenta adesão e o
  gráfico de progresso.
- **Post** — social: author, text, imageUrl, likeCount/commentCount (denormalizados).
- **Follow**, **Like**, **Comment** — relações sociais (índices únicos compostos).
- **CoachMessage** — histórico do chat com o coach.
- **ExerciseVideo** — cache de vídeos de execução (YouTube).

### 5.2 Domínio `Activity` _(alvo — Fase 2, decisão central do pivô)_

Hoje um treino registrado é sempre um `WorkoutLog` (assume musculação/cardio) e um
compartilhamento é sempre um `Post`. Para multiesporte + GPS, introduzimos **`Activity`**: uma
**sessão de treino registrada de qualquer esporte**.

**Decisão**: `Activity` é um modelo novo, **polimórfico por `kind`**. Não enfiamos multiesporte
dentro de `Post` nem de `WorkoutLog`, e **não** fazemos migração destrutiva. `WorkoutLog` é
absorvido por `Activity(kind: "strength")` de forma reversível (ver §5.3).

Forma proposta (a detalhar no spec da Fase 2):

```
Activity {
  user            ref User
  sport           string estável ('musculacao' | 'corrida' | 'ciclismo' | 'jiu_jitsu' | 'crossfit' | 'outro')
  kind            'strength' | 'distance' | 'class' | 'wod' | 'generic'   // define o payload
  startedAt       Date
  durationMin     number
  payload         (polimórfico por kind):
      strength → entries[]{ exerciseName, sets, weightKg, reps }
      distance → distanceKm, movingTimeSec, avgPaceSecPerKm, elevationGainM,
                 route? (GeoJSON LineString)                     // GPS — Fase 3
      class    → notes (presença/aula)
      wod      → description, resultType ('time'|'reps'|'rounds'), resultValue
      generic  → title, notes
  planLink?       { planVersion, sessionDay }   // liga à adesão do plano (papel do WorkoutLog)
  visibility      'private' | 'followers' | 'public'
  feedPostId?     ref Post                       // se compartilhada, o Post que a referencia
  notes?          string
}
```

- **Adesão**: `adherence`/progresso passam a ler `Activity` (via `planLink`) em vez de
  `WorkoutLog`.
- **Feed**: `Post` ganha um campo opcional `activity` (ref). Um Post ou embrulha uma Activity
  (compartilhamento) ou é avulso (foto/texto). Likes/comments continuam apontando para `Post`.
- **GPS** (Fase 3): `route` como GeoJSON LineString. Índice `2dsphere` só se/quando houver
  consulta geoespacial (ex.: "atividades perto de mim") — atrás de decisão, não por padrão.

### 5.3 Migração WorkoutLog → Activity (reversível)

Estratégia evolutiva, sem big-bang:
1. Criar `Activity` e passar a **escrever** novos check-ins como `Activity(kind:"strength")`.
2. **Backfill** dos `WorkoutLog` existentes em `Activity` por script idempotente, preservando
   ids de referência. Script de **rollback** documentado no mesmo PR.
3. Migrar a leitura (adesão, progresso, histórico) para `Activity`.
4. Só então aposentar o caminho de escrita do `WorkoutLog`.

## 6. Infraestrutura evolutiva

Entra por necessidade de feature, nunca antecipada:

| Peça | Quando entra | Motivo |
|---|---|---|
| **Object storage** (MinIO na VPS/Coolify) | Fase 1 ✅ **no ar** | As fotos sobrevivem a redeploy (volume persistente). Ver §6.1. |
| **Migração de deploy p/ VPS** | ✅ **concluída em 09/09/2026** | API + web + MinIO + Mongo na VPS/Coolify. Render e Vercel aposentados. Ver `INFRA.md`. |
| **Fila + worker** (ex.: BullMQ/Redis) | Quando houver job assíncrono real | Processar rota de GPS, fan-out de push, cron de reajuste semanal. Não antes. |
| **Índice geoespacial 2dsphere** | Se houver consulta geo | "Atividades/pessoas perto de mim". Só quando a feature existir. |

### 6.1 Storage de imagens (Fase 1 — implementado)

Camada plugável em `api/src/services/storage/`, espelhando o padrão de `services/ai/`:
interface `StorageProvider`, factory `getStorageProvider()` por env `STORAGE_PROVIDER`,
`setStorageProvider()` para testes. Duas implementações:

- **`disk`** (default) — salva em `./uploads`; usado só em desenvolvimento.
- **`s3`** — compatível com S3/R2/**MinIO** via `@aws-sdk/client-s3` (`forcePathStyle`).
  **É o provider de produção** (`STORAGE_PROVIDER=s3`).

> **Cuidado ao mexer em `storage/disk.ts`:** o módulo cria o diretório de uploads já no
> import, mesmo quando o provider é `s3`. É por isso que `api/Dockerfile` precisa criar
> `/app/uploads` com dono `node` — sem isso o processo morre no boot com `EACCES`.

O upload (`POST /uploads`) usa `multer.memoryStorage()` → **`processImage`** (sharp:
reencoda p/ JPEG **removendo EXIF** e reduz p/ ≤1600px) → `storage.save()`. URLs relativas
do disco viram absolutas pelo host da requisição; URLs do S3 já são absolutas
(`MEDIA_PUBLIC_BASE_URL`).

**Decisão**: destino de produção = **MinIO self-hosted no Coolify (VPS do Asafe)**. Como o
MinIO fala a API do S3, o mesmo código serve para R2/S3 depois — só trocar env, sem lock-in.
Com a API rodando na **mesma VPS** (decisão VPS-only, §1), o `S3_ENDPOINT` pode ser o endereço
**interno** do MinIO na rede Docker do Coolify; só o `MEDIA_PUBLIC_BASE_URL` (leitura das fotos)
precisa de domínio público + HTTPS.

**Como está ligado hoje** (feito em 09/09/2026):

1. MinIO roda na VPS com **volume persistente** montado em `/data`.
2. Bucket `fotos`: objetos com leitura anônima; **listagem do bucket é negada**.
3. A API usa uma credencial dedicada (`fitsocial-api`), restrita ao bucket `fotos` —
   não é a credencial root do MinIO, e não pode criar buckets.
4. `S3_ENDPOINT=http://minio-fitsocial:9000` — tráfego interno na rede Docker; as chaves
   nunca saem da VPS. Só `MEDIA_PUBLIC_BASE_URL` é público.

Imagens anteriores à migração (`onrender.com/uploads/...`) foram perdidas com o disco
efêmero e dão 404. Pré-lançamento: aceitável.

## 7. Roadmap (fases)

Cada fase é um ciclo próprio: brainstorm → spec (`docs/superpowers/specs/`) → plano →
implementação → verificação.

| Fase | Tema |
|---|---|
| 0 | Fundação: estes documentos + `CLAUDE.md` + higiene de segredos ✅ |
| 1 | Object storage (fotos persistentes) — código ✅ (ligar = ops) |
| 2 | Domínio `Activity` (multiesporte) — decomposto abaixo |
| 3 | GPS / rota (captura no app, geo no banco, resumo, mapa) |
| 4 | Desafios em grupo |
| 5 | Engajamento & monetização (push, RevenueCat real, gamificação expandida) |

**Decomposição da Fase 2** (a spec completa dos esportes/payloads é `docs/ESPORTES.md`):

| Fatia | Escopo | Estado |
|---|---|---|
| 2a | Modelo `Activity` + **strength** + seed dos 21 `sportId` + migração reversível do WorkoutLog + share no feed + adesão (qualquer treino conta) + CRUD `/activities` | ✅ feito |
| 2b | Formatos `endurance` (manual), `class`, `generic` (nível rápido) | pendente |
| 2c | Motor de detecção de PR + métricas | pendente |
| 2d | Formato `wod` + seed de movimentos/benchmarks | pendente |
| 2e | Bibliotecas de seed (exercícios, calistenia, LPO, swim drills, gradings) | pendente |
| 2.1 | `climb` + `match` | pendente |

Dependências: 2b–2e e as Fases 3/4 dependem da 2a. A 2a fez o **cutover do check-in**: `/checkins`
mantém o contrato, mas persiste `Activity(strength)`; `WorkoutLog` fica só como fonte da
migração (`npm run migrate:activities` / `:rollback`) até ser aposentado numa limpeza futura.

## 8. Protocolo de trabalho

Para cada fatia de implementação:

```
1. PLANO       → arquivos a criar/alterar + testes a escrever. Parar e esperar "ok".
2. EXECUÇÃO    → implementar, com os testes junto (não depois).
3. VERIFICAÇÃO → rodar lint + typecheck + testes; colar a saída REAL, não um resumo.
4. ENTREGA     → o que mudou, como testar manualmente, o que ficou pendente/frágil.
```

Percebeu que o plano estava errado no meio da execução? **Pare e avise** — não improvise uma
solução diferente da combinada.
