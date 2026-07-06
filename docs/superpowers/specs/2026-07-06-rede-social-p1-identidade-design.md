# Rede social usável — Parte 1: Identidade — Design

**Data:** 2026-07-06
**Status:** Desenho aprovado. Aguardando revisão da spec.
**Branch:** `feat/rede-social` (novo, a partir da main já com vídeos+cardio mergeados)

## Contexto

A rede social já tem fundação: modelos `Post`, `Follow`, `Like`, `Comment`; rotas `/social/*` (feed de quem você segue, perfil por id, follow/unfollow, comentários); app com `FeedScreen`, `ProfileScreen`, `PostCard`, `CreatePostScreen`. **Faltam** para deixá-la usável no estilo Instagram: **nome de usuário (@handle)**, **busca de pessoas**, **avatar** e um **perfil editável**. O follow por id já existe.

O trabalho total (username + avatar + busca + aba Explorar + redesign Instagram) foi dividido em 3 partes sequenciais. Esta spec cobre a **Parte 1 — Identidade**, a fundação que as outras usam:

- **Parte 1 (esta):** username, avatar, bio, edição de perfil, gate obrigatório p/ usuários antigos, endpoint de busca de pessoas.
- **Parte 2 (futura):** aba "Buscar/Explorar" (barra de busca + grade explorar de fotos).
- **Parte 3 (futura):** redesign Instagram (feed com cards de foto, perfil em grade, avatar nos comentários).

## Objetivo (Parte 1)

Todo usuário passa a ter um `@username` único (escolhido no cadastro; usuários antigos definem numa tela obrigatória), uma foto de perfil (avatar) e uma bio, editáveis a qualquer momento. Um endpoint de busca de pessoas por username/nome fica disponível para a Parte 2.

## Backend (`api/`)

### 1. Modelo `User`
`api/src/models/User.ts` ganha três campos:
```ts
username: { type: String, unique: true, sparse: true, lowercase: true, trim: true, minlength: 3, maxlength: 20 },
avatarUrl: { type: String, default: "" },
bio: { type: String, default: "", maxlength: 160 },
```
- **`sparse: true`** é essencial: usuários antigos ainda sem `username` não violam o índice único (o índice ignora documentos sem o campo). Assim que definem, a unicidade vale.
- `publicUser(user)` passa a devolver `username` (ou `null`), `avatarUrl`, `bio`.

### 2. Validação de username (reutilizável)
`api/src/utils/username.ts` — `usernameSchema` (zod): string, 3–20 chars, regex `^[a-z0-9._]+$`, sem ponto no início/fim e sem dois pontos seguidos. Helper `normalizeUsername(s)` faz `trim().toLowerCase()` antes de validar. Usado no cadastro e no PATCH.

### 3. Cadastro com username (opcional na API, coletado pelo app)
`api/src/routes/auth.ts` — `registerSchema` ganha `username` **opcional** (via `usernameSchema.optional()`). Se enviado: normaliza, checa unicidade (`findOne`) → **409** "Esse nome de usuário já está em uso." se tomado; se ausente: cria sem username (o **gate obrigatório** exige antes de usar o app).

**Por que opcional e não obrigatório:** o gate já é o ponto único de enforcement ("todo usuário tem username antes de usar o app"), então exigir no schema do cadastro seria redundante — e quebraria os ~14 registros dos testes existentes (que não enviam username). O app **coleta** o username no `RegisterScreen` (novo usuário já sai com handle, sem passar pelo gate); a opcionalidade só afeta chamadas diretas à API.

### 4. `PATCH /auth/me`
`api/src/routes/auth.ts` (protegido por `requireAuth`) — body parcial `{ username?, name?, bio?, avatarUrl? }` (todos opcionais; zod). Atualiza só os campos enviados:
- `username`: normaliza + valida + checa unicidade (excluindo o próprio); 409 se tomado. **Pode trocar sempre.**
- `bio`: máx 160; `name`: 2–80; `avatarUrl`: string (URL do upload).
Retorna `{ user: publicUser(updated) }`. Serve tanto ao gate obrigatório quanto à edição de perfil.

### 5. `GET /auth/check-username?username=`
Protegido. Normaliza+valida; responde `{ available: boolean }` (disponível = ninguém além de você usa). Feedback ao vivo na escolha do handle. Username inválido → `{ available: false }` (o app mostra a regra separadamente).

### 6. Busca de pessoas — `GET /social/search?q=`
`api/src/routes/social.ts` (já tem `router.use(requireAuth)`). `q` (1–50 chars). Acha usuários onde `username` **ou** `name` contêm `q` (substring, case-insensitive, com a `q` escapada para uso seguro em regex), exclui o próprio, limita 20. Retorna `{ users: [{ id, name, username, avatarUrl, isFollowing }] }` (isFollowing via `Follow.exists`). `q` vazio → `{ users: [] }`.

### 7. Perfil e posts expõem identidade
- `GET /social/users/:id`: o `select("name")` vira `select("name username avatarUrl bio")`; o objeto `user` da resposta inclui `username`, `avatarUrl`, `bio`.
- `serializePost` (social.ts): o `populate("author", "name")` vira `populate("author", "name username avatarUrl")` e o autor serializado inclui `username`/`avatarUrl` (dados prontos para o redesign da Parte 3; sem uso visual novo agora).

## App (`app-android/`)

### 8. AuthContext
O tipo de `user` (e `publicUser` consumido) ganha `username: string | null`, `avatarUrl: string`, `bio: string`. `refreshUser` já existe e recarrega `/auth/me`.

### 9. RegisterScreen
Adiciona campo **`@username`** (abaixo do nome): input com prefixo "@", minúsculas forçadas, dica da regra, e checagem de disponibilidade ao sair do campo (via `check-username`). Envia `username` no cadastro. Erro 409 → mensagem inline.

### 10. Gate obrigatório de username
`api/.../RootNavigator.tsx` já usa `needsOnboarding={!user?.onboardingComplete}`. Acrescenta-se um gate análogo: se logado e `!user?.username` → renderiza `ChooseUsernameScreen` (antes das abs). A tela: campo @username com checagem ao vivo (`check-username`, debounce), botão "Continuar" salva via `PATCH /auth/me` + `refreshUser`. Bloqueia o app até definir. (Onboarding e username são gates independentes; se ambos faltarem, username primeiro por ser identidade.)

### 11. EditProfileScreen
Nova tela (acessível pelo botão "Editar perfil" no próprio perfil):
- **Avatar:** toca → `expo-image-picker` → `POST /uploads` (multipart, já existe) → guarda a `url` em `avatarUrl`. Mostra preview; fallback inicial-em-círculo quando vazio.
- **@username** (editável, com feedback de disponibilidade), **bio** (multiline, contador até 160), **nome**.
- "Salvar" → `PATCH /auth/me` + `refreshUser` → volta. Erros (409 username) inline.

### 12. ProfileScreen
Passa a mostrar: avatar (ou fallback inicial), `@username` sob o nome, bio, contadores (posts/seguidores/seguindo, já existem). No próprio perfil: botão **"Editar perfil"** → `EditProfileScreen`. (A grade de fotos é Parte 3; aqui a lista de posts atual permanece.)

### 13. Client de API
`app-android/src/api/` — `updateMe(token, patch)` → `PATCH /auth/me`; `checkUsername(token, username)` → `/auth/check-username`; `searchUsers(token, q)` → `/social/search`. Componente `Avatar` reutilizável (foto ou inicial-em-círculo colorido) para uso aqui e nas próximas partes.

## Fluxo de dados
```
Cadastro (novo) → escolhe @username → User com username
Usuário antigo (sem username) → login → gate ChooseUsernameScreen → PATCH /auth/me → refreshUser → entra
Editar perfil → avatar via /uploads + @username/bio/nome → PATCH /auth/me → refreshUser
Busca (P2) → GET /social/search?q= → lista de pessoas (+isFollowing)
```

## Tratamento de erros / degradação
- Username tomado (cadastro ou PATCH) → 409 PT-BR, mostrado inline; o app não avança.
- `check-username` com valor inválido → `{ available:false }`; a regra de formato é mostrada à parte.
- Upload de avatar falhando → aviso, não bloqueia salvar o resto (avatar continua o anterior).
- Avatar vazio em qualquer lugar → componente `Avatar` cai no fallback inicial-em-círculo (nunca imagem quebrada).
- Índice único `sparse` garante que os usuários antigos sem username coexistam até definirem.

## Testes
Backend (Vitest + mongodb-memory-server):
- `usernameSchema`: aceita válidos, rejeita maiúsculas/espaços/símbolos/curto/longo/ponta-com-ponto.
- Cadastro: cria com username; segundo cadastro com mesmo username → 409; cadastro **sem** username também funciona (fica p/ o gate).
- `PATCH /auth/me`: atualiza bio/nome/avatar; troca username; username tomado por outro → 409; troca para o próprio username atual → ok.
- `GET /auth/check-username`: disponível vs. tomado vs. o próprio (disponível).
- `GET /social/search`: casa por username e por nome, case-insensitive, exclui o próprio, respeita limite; `q` vazio → lista vazia; inclui `isFollowing`.
- `GET /social/users/:id`: resposta inclui username/avatarUrl/bio.

App: `npx tsc --noEmit` limpo + `npx expo export --platform web` compila. Validação visual pelo Asafe (inclui o gate e a edição).

## Fora de escopo (P1, YAGNI)
- Aba "Buscar/Explorar" e grade explorar → Parte 2.
- Redesign do feed (cards de foto) e do perfil (grade) e avatar nos comentários → Parte 3.
- Verificação de e-mail, troca de senha, contas privadas, bloquear/silenciar → não planejado.
- Recorte/crop de avatar no cliente → usa a imagem como veio do picker.
