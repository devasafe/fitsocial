# FitSocial

Rede social fitness com **coach de treino e dieta por IA**. Une, num só app, o
acompanhamento personalizado (treino + nutrição gerados por IA) e uma comunidade
onde as pessoas compartilham a evolução — fechando um ciclo de retenção.

> Documento de decisões e escopo: veja o plano do MVP em
> `C:\Users\00asa\.claude\plans\` (fora do repo).

## Estrutura (monorepo)

```
FitSocial/
├─ api/          Backend — Node.js + Express + MongoDB + TypeScript
└─ app-android/  App — React Native (Expo). iOS em Swift virá em fase futura.
```

## Backend (`api/`)

Requisitos: Node 20+ e um MongoDB (local ou Atlas).

```bash
cd api
cp .env.example .env      # ajuste JWT_SECRET, MONGODB_URI, ANTHROPIC_API_KEY
npm install
npm run dev               # sobe em http://localhost:4000
npm test                  # testes de integração (Mongo em memória)
```

Endpoints da Fatia 1 (Auth):

| Método | Rota             | Descrição                          |
|--------|------------------|------------------------------------|
| GET    | `/health`        | Healthcheck                        |
| POST   | `/auth/register` | Cadastro (retorna token + usuário) |
| POST   | `/auth/login`    | Login (retorna token + usuário)    |
| GET    | `/auth/me`       | Usuário autenticado (Bearer token) |

Fatia 2 (Onboarding com IA — requer Bearer token):

| Método | Rota                   | Descrição                                        |
|--------|------------------------|--------------------------------------------------|
| GET    | `/onboarding/greeting` | Mensagem inicial do coach                        |
| POST   | `/onboarding/message`  | Um turno da conversa; ao concluir, salva a ficha |

Fatia 3 (Geração de plano — requer Bearer token):

| Método | Rota               | Descrição                                         |
|--------|--------------------|---------------------------------------------------|
| POST   | `/plans/generate`  | Gera treino+dieta a partir da ficha (nova versão) |
| GET    | `/plans/current`   | Retorna o plano mais recente                      |

Fatia 4 (Rede social — requer Bearer token):

| Método | Rota                         | Descrição                          |
|--------|------------------------------|------------------------------------|
| POST   | `/social/posts`              | Cria post (texto + imageUrl opc.)  |
| GET    | `/social/feed`               | Feed (quem você segue + você)      |
| POST   | `/social/posts/:id/like`     | Curtir                             |
| DELETE | `/social/posts/:id/like`     | Descurtir                          |
| POST   | `/social/users/:id/follow`   | Seguir                             |
| DELETE | `/social/users/:id/follow`   | Deixar de seguir                   |
| GET    | `/social/users/:id`          | Perfil + contagens + posts         |

Fatia 5 (Freemium):

| Método | Rota                    | Descrição                                          |
|--------|-------------------------|----------------------------------------------------|
| POST   | `/plans/generate`       | Grátis gera 1x; regenerar exige premium (402)      |
| POST   | `/billing/webhook`      | Webhook do RevenueCat (atualiza tier)              |
| POST   | `/billing/dev-upgrade`  | Upgrade de DEV (alterna free/premium; off em prod) |

**Assinatura real:** integração via **RevenueCat + Google Play Billing** (o
`dev-upgrade` é só para demonstração). Configure o RevenueCat usando o `_id` do
usuário como `app_user_id` e aponte o webhook para `/billing/webhook`
(opcionalmente proteja com `REVENUECAT_WEBHOOK_AUTH`).

### IA (camada desacoplada)

A IA fica isolada atrás da interface `AIProvider` (`src/services/ai/`). Hoje usa
**Google Gemini** (grátis) via REST. Trocar de LLM = nova implementação da
interface + apontar o factory em `src/services/ai/index.ts`. Configure
`GEMINI_API_KEY` no `.env` (grátis em https://aistudio.google.com/apikey).

Teste as integrações reais com: `npm run try:gemini` (onboarding) e
`npm run try:plan` (geração de plano).

## App (`app-android/`)

```bash
cd app-android
npm install
npm run android           # requer emulador Android ou o app Expo Go
```

Por padrão o app aponta para `http://10.0.2.2:4000` (host no emulador Android).
Para dispositivo físico, defina `EXPO_PUBLIC_API_URL` com o IP da sua máquina.

## Status das fatias

- [x] **Fatia 1 — Fundação + Auth** (backend + app base com login/cadastro)
- [x] **Fatia 2 — Onboarding conversacional (IA)** (Gemini; falta plugar a chave p/ teste real)
- [x] **Fatia 3 — Geração de plano por IA** (treino+dieta em JSON; telas de plano no app)
- [x] **Fatia 4 — Rede social** (posts, feed, seguir, curtir; abas + perfil no app)
- [x] **Fatia 5 — Freemium** (gating 402 + webhook RevenueCat + tela Premium; upgrade de teste)
- [x] **Fatia 6 — Polimento + guardrails** (rate limit na IA, 404, aviso de saúde, erro de rede)

### v2
- [x] **v2.1 — Check-in de treino + reajuste** (log carga/reps, streak/progresso, coach reajusta o plano por adesão)
- [x] **v2.2 — Gamificação** (badges por conquistas no perfil + ranking entre seguidos)
- [x] **v2.3 — Upload real de fotos** (galeria/câmera → upload → post com imagem)
- [x] **v2.4 — Comentários nos posts** (comentar, listar, contagem; tela de detalhe do post)

Endpoints v2.2–v2.4 (Bearer token):

| Método | Rota                              | Descrição                          |
|--------|-----------------------------------|------------------------------------|
| GET    | `/gamification/users/:id`         | Badges de um usuário               |
| GET    | `/gamification/leaderboard`       | Ranking entre seguidos (7 dias)    |
| POST   | `/uploads`                        | Upload de imagem (multipart)       |
| POST   | `/social/posts/:id/comments`      | Comentar em um post                |
| GET    | `/social/posts/:id/comments`      | Listar comentários                 |

### v2.1 — Check-in de treino + reajuste (requer Bearer token)

| Método | Rota               | Descrição                                             |
|--------|--------------------|-------------------------------------------------------|
| POST   | `/checkins`        | Registra treino feito (carga/reps; post opcional)     |
| GET    | `/checkins/stats`  | Streak, treinos na semana e total                     |
| GET    | `/checkins`        | Histórico recente de treinos                          |
| POST   | `/plans/adjust`    | Reajuste do plano pela IA com base na adesão (premium)|

## Guardrails

- **Rate limiting** nos endpoints de IA (por usuário) para conter custo/abuso.
- **Aviso de saúde** visível no onboarding e no plano ("não substitui profissional").
- Triagem de lesões/condições no onboarding, respeitada na geração do plano.
- Erros da IA viram `502` amigável; falha de rede no app vira mensagem clara.
