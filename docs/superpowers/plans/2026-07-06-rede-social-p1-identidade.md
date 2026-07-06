# Rede social P1 — Identidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a todo usuário um `@username` único (coletado no cadastro; usuários antigos definem num gate obrigatório), avatar e bio editáveis, e um endpoint de busca de pessoas.

**Architecture:** Backend adiciona `username`/`avatarUrl`/`bio` ao `User` (username único *sparse*), `PATCH /auth/me` (edição), `GET /auth/check-username` (disponibilidade), `GET /social/search` (busca). App coleta username no cadastro, força um `ChooseUsernameScreen` via gate no `RootNavigator` para quem não tem, e ganha `EditProfileScreen` (avatar via upload existente) + um componente `Avatar` reutilizável.

**Tech Stack:** Node + Express + TypeScript + Mongoose + Zod (backend ESM, imports `.js`); Vitest + mongodb-memory-server + supertest (testes backend); React Native/Expo + expo-image-picker (app).

## Global Constraints

- Backend é ESM: **todo import relativo termina em `.js`**.
- Testes backend usam **Vitest** + mongodb-memory-server + supertest.
- App **não tem test runner**: verificação é `cd app-android && npx tsc --noEmit` (limpo) e, nas tasks de navegação/tela, também `cd app-android && npx expo export --platform web` (exit 0, depois `rm -rf dist`).
- `username`: minúsculas, 3–20 chars, regex `^[a-z0-9._]+$`, sem ponto no início/fim nem dois pontos seguidos. Único (índice *sparse*). **Pode trocar sempre.**
- `username` é **opcional** na API de cadastro; o app coleta e o **gate** (`!user.username`) é o enforcement.
- Mensagens ao usuário em **PT-BR**.
- Rodar após cada task backend: `cd api && npm test` (verde). Após cada task app: as verificações acima.

---

### Task 1: Campos de identidade no User + validação de username

**Files:**
- Modify: `api/src/models/User.ts`
- Create: `api/src/utils/username.ts`
- Create: `api/src/utils/username.test.ts`

**Interfaces:**
- Produces:
  - `User` com `username?` (unique sparse lowercase, 3–20), `avatarUrl` (default ""), `bio` (default "", max 160).
  - `publicUser(user)` retorna também `username: string | null`, `avatarUrl: string`, `bio: string`.
  - `normalizeUsername(s: string): string` (trim + lowercase).
  - `usernameSchema: z.ZodString` (valida formato) em `api/src/utils/username.ts`.

- [ ] **Step 1: Escrever os testes de validação (falham)**

Criar `api/src/utils/username.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { usernameSchema, normalizeUsername } from "./username.js";

describe("usernameSchema", () => {
  it("aceita usernames válidos", () => {
    for (const u of ["asafe", "joao_silva", "ze.dev", "user123"]) {
      expect(usernameSchema.safeParse(u).success).toBe(true);
    }
  });
  it("rejeita inválidos", () => {
    for (const u of ["ab", "a".repeat(21), "João", "com espaco", "-hifen", ".comeca", "termina.", "dois..pontos", "sinal!"]) {
      expect(usernameSchema.safeParse(u).success).toBe(false);
    }
  });
});

describe("normalizeUsername", () => {
  it("apara e coloca em minúsculas", () => {
    expect(normalizeUsername("  Asafe_DEV ")).toBe("asafe_dev");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/utils/username.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o util**

Criar `api/src/utils/username.ts`:

```ts
import { z } from "zod";

/** Normaliza um username para armazenamento/comparação: apara e minúsculas. */
export function normalizeUsername(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Regras do @username: 3–20 chars, apenas [a-z0-9._], sem ponto no início/fim
 * e sem dois pontos seguidos. (Aplique normalizeUsername antes de validar.)
 */
export const usernameSchema = z
  .string()
  .min(3, "Mínimo de 3 caracteres")
  .max(20, "Máximo de 20 caracteres")
  .regex(/^[a-z0-9._]+$/, "Use apenas letras minúsculas, números, ponto e sublinhado")
  .refine((s) => !s.startsWith(".") && !s.endsWith("."), "Não pode começar nem terminar com ponto")
  .refine((s) => !s.includes(".."), "Não use dois pontos seguidos");
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx vitest run src/utils/username.test.ts`
Expected: PASS.

- [ ] **Step 5: Adicionar os campos ao modelo `User`**

Em `api/src/models/User.ts`, no `userSchema` (após `passwordHash`):

```ts
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
    },
    avatarUrl: { type: String, default: "" },
    bio: { type: String, default: "", maxlength: 160 },
```

E em `publicUser`:
```ts
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    avatarUrl: user.avatarUrl ?? "",
    bio: user.bio ?? "",
    tier: user.tier,
    onboardingComplete: user.onboardingComplete,
  };
```

- [ ] **Step 6: Verificar typecheck + suíte**

Run: `cd api && npm test`
Expected: tudo verde (os testes existentes não enviam username; `sparse` permite ausência).

- [ ] **Step 7: Commit**

```bash
git add api/src/models/User.ts api/src/utils/username.ts api/src/utils/username.test.ts
git commit -m "feat: username/avatarUrl/bio no User + usernameSchema"
```

---

### Task 2: Cadastro com username opcional + check-username

**Files:**
- Modify: `api/src/routes/auth.ts`
- Test: `api/src/routes/auth.test.ts` (adicionar casos)

**Interfaces:**
- Consumes: `usernameSchema`, `normalizeUsername` (Task 1).
- Produces:
  - `POST /auth/register` aceita `username?` opcional (valida + unicidade → 409 se tomado).
  - `GET /auth/check-username?username=` (protegido) → `{ available: boolean }`.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/src/routes/auth.test.ts`, adicionar (dentro do `describe("Auth", ...)`):

```ts
it("cadastra com username e rejeita username duplicado", async () => {
  const a = await request(app).post("/auth/register").send({ name: "Ana", email: "ana@test.com", password: "senha12345", username: "ana" });
  expect(a.status).toBe(201);
  expect(a.body.user.username).toBe("ana");

  const b = await request(app).post("/auth/register").send({ name: "Ana2", email: "ana2@test.com", password: "senha12345", username: "ANA" });
  expect(b.status).toBe(409);
});

it("cadastra sem username (fica para o gate)", async () => {
  const res = await request(app).post("/auth/register").send({ name: "Sem", email: "sem@test.com", password: "senha12345" });
  expect(res.status).toBe(201);
  expect(res.body.user.username).toBeNull();
});

it("GET /auth/check-username diz se está disponível", async () => {
  const reg = await request(app).post("/auth/register").send({ name: "Chk", email: "chk@test.com", password: "senha12345", username: "chkuser" });
  const token = reg.body.token;
  const taken = await request(app).get("/auth/check-username?username=chkuser").set("Authorization", `Bearer ${token}`);
  expect(taken.body.available).toBe(false);
  const free = await request(app).get("/auth/check-username?username=livre123").set("Authorization", `Bearer ${token}`);
  expect(free.body.available).toBe(true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/routes/auth.test.ts`
Expected: FAIL — register ignora username / rota check-username 404.

- [ ] **Step 3: Implementar**

Em `api/src/routes/auth.ts`:

1. Import:
```ts
import { usernameSchema, normalizeUsername } from "../utils/username.js";
```

2. `registerSchema` ganha o campo como string crua opcional (a normalização+validação forte é no handler, para que "ANA" vire "ana" e caia em 409 de duplicado, não 400 de formato):
```ts
const registerSchema = z.object({
  name: z.string().min(2, "Nome muito curto").max(80),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres"),
  username: z.string().optional(),
});
```

3. No handler de `/register`, após checar e-mail e antes de `User.create`, resolver o username (normalizar ANTES de validar):
```ts
    let username: string | undefined;
    if (req.body.username != null && String(req.body.username).trim() !== "") {
      const norm = normalizeUsername(String(req.body.username));
      const parsed = usernameSchema.safeParse(norm);
      if (!parsed.success) {
        throw new HttpError(400, `Nome de usuário inválido: ${parsed.error.issues[0].message}`);
      }
      username = parsed.data;
      const taken = await User.findOne({ username });
      if (taken) throw new HttpError(409, "Esse nome de usuário já está em uso.");
    }

    const user = await User.create({
      name,
      email,
      passwordHash: await hashPassword(password),
      ...(username ? { username } : {}),
    });
```
(`registerSchema.parse(req.body)` continua devolvendo `name/email/password`; o `username` é tratado à parte a partir de `req.body.username`.)

4. Nova rota (após `/me`):
```ts
authRouter.get(
  "/check-username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = usernameSchema.safeParse(normalizeUsername(String(req.query.username ?? "")));
    if (!parsed.success) return res.json({ available: false });
    const existing = await User.findOne({ username: parsed.data });
    const available = !existing || existing._id.toString() === req.user!._id.toString();
    res.json({ available });
  })
);
```

- [ ] **Step 4: Rodar e ver passar + suíte**

Run: `cd api && npx vitest run src/routes/auth.test.ts`
Expected: PASS.
Run: `cd api && npm test`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/auth.ts api/src/routes/auth.test.ts
git commit -m "feat: cadastro aceita username opcional + GET /auth/check-username"
```

---

### Task 3: PATCH /auth/me (editar perfil)

**Files:**
- Modify: `api/src/routes/auth.ts`
- Test: `api/src/routes/auth.test.ts` (adicionar casos)

**Interfaces:**
- Consumes: `usernameSchema`, `normalizeUsername` (Task 1), `publicUser` (Task 1).
- Produces: `PATCH /auth/me` (protegido) — body parcial `{ username?, name?, bio?, avatarUrl? }` → `{ user }` (publicUser). 409 se username tomado por outro.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/src/routes/auth.test.ts`, adicionar:

```ts
it("PATCH /auth/me atualiza bio/nome/avatar e troca username", async () => {
  const reg = await request(app).post("/auth/register").send({ name: "Edt", email: "edt@test.com", password: "senha12345", username: "edt" });
  const token = reg.body.token;
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

  const res = await auth(request(app).patch("/auth/me")).send({ name: "Editado", bio: "sou fit", avatarUrl: "http://x/a.jpg", username: "novoedt" });
  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe("Editado");
  expect(res.body.user.bio).toBe("sou fit");
  expect(res.body.user.avatarUrl).toBe("http://x/a.jpg");
  expect(res.body.user.username).toBe("novoedt");

  // trocar para o próprio username atual deve ser permitido
  const same = await auth(request(app).patch("/auth/me")).send({ username: "novoedt" });
  expect(same.status).toBe(200);
});

it("PATCH /auth/me rejeita username já usado por outro (409)", async () => {
  await request(app).post("/auth/register").send({ name: "Dono", email: "dono@test.com", password: "senha12345", username: "dono" });
  const reg = await request(app).post("/auth/register").send({ name: "Outro", email: "outro@test.com", password: "senha12345", username: "outro" });
  const token = reg.body.token;
  const res = await request(app).patch("/auth/me").set("Authorization", `Bearer ${token}`).send({ username: "dono" });
  expect(res.status).toBe(409);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/routes/auth.test.ts`
Expected: FAIL — rota PATCH 404.

- [ ] **Step 3: Implementar**

Em `api/src/routes/auth.ts`, adicionar (após `check-username`):

```ts
const patchMeSchema = z.object({
  name: z.string().min(2, "Nome muito curto").max(80).optional(),
  bio: z.string().max(160, "Bio muito longa").optional(),
  avatarUrl: z.string().max(500).optional(),
  username: usernameSchema.optional(),
});

authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = patchMeSchema.parse(
      req.body?.username !== undefined
        ? { ...req.body, username: normalizeUsername(String(req.body.username)) }
        : req.body
    );
    const user = req.user!;

    if (body.username !== undefined && body.username !== user.username) {
      const taken = await User.findOne({ username: body.username });
      if (taken) throw new HttpError(409, "Esse nome de usuário já está em uso.");
      user.username = body.username;
    }
    if (body.name !== undefined) user.name = body.name;
    if (body.bio !== undefined) user.bio = body.bio;
    if (body.avatarUrl !== undefined) user.avatarUrl = body.avatarUrl;

    await user.save();
    res.json({ user: publicUser(user) });
  })
);
```

- [ ] **Step 4: Rodar e ver passar + suíte**

Run: `cd api && npx vitest run src/routes/auth.test.ts`
Expected: PASS.
Run: `cd api && npm test`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/auth.ts api/src/routes/auth.test.ts
git commit -m "feat: PATCH /auth/me (editar username/nome/bio/avatar)"
```

---

### Task 4: Busca de pessoas + perfil/posts expõem identidade

**Files:**
- Modify: `api/src/routes/social.ts`
- Test: `api/src/routes/social.test.ts` (adicionar casos)

**Interfaces:**
- Produces:
  - `GET /social/search?q=` → `{ users: [{ id, name, username, avatarUrl, isFollowing }] }`.
  - `GET /social/users/:id` inclui `username`, `avatarUrl`, `bio` no objeto `user`.
  - `serializePost` inclui `username`/`avatarUrl` no autor.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/src/routes/social.test.ts`, adicionar (usar o padrão de criação de usuário/token já presente no arquivo — provavelmente há 2 usuários; ajuste os nomes conforme o helper existente):

```ts
it("GET /social/search acha por username e por nome, excluindo você", async () => {
  // supõe 2 tokens já criados no setup do arquivo: tokenA (você) e um user "Bruno" @bruno
  // se o setup não tiver, registre-os aqui via /auth/register com usernames distintos.
  const byUser = await request(app).get("/social/search?q=brun").set("Authorization", `Bearer ${tokenA}`);
  expect(byUser.status).toBe(200);
  expect(byUser.body.users.some((u: { username: string }) => u.username === "bruno")).toBe(true);
  expect(byUser.body.users.every((u: { id: string }) => u.id !== meAId)).toBe(true); // não inclui você

  const empty = await request(app).get("/social/search?q=").set("Authorization", `Bearer ${tokenA}`);
  expect(empty.body.users).toEqual([]);
});
```
(Confirme os nomes `tokenA`/`meAId`/o segundo usuário no setup do arquivo; se necessário registre dois usuários com `username` no começo do teste. Inclua também um assert de `isFollowing` se já houver relação de follow no setup.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run src/routes/social.test.ts`
Expected: FAIL — rota search 404.

- [ ] **Step 3: Implementar**

Em `api/src/routes/social.ts`:

1. Rota de busca (adicionar perto do topo das rotas, após o `router.use(requireAuth)`):
```ts
socialRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json({ users: [] });
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escapa regex
    const rx = new RegExp(safe, "i");
    const me = req.user!._id;
    const users = await User.find({
      _id: { $ne: me },
      $or: [{ username: rx }, { name: rx }],
    })
      .select("name username avatarUrl")
      .limit(20);

    const followingIds = new Set(
      (await Follow.find({ follower: me, following: { $in: users.map((u) => u._id) } }).select("following"))
        .map((f) => f.following.toString())
    );

    res.json({
      users: users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        username: u.username ?? null,
        avatarUrl: u.avatarUrl ?? "",
        isFollowing: followingIds.has(u._id.toString()),
      })),
    });
  })
);
```
(Confirme que `User` e `Follow` já estão importados no arquivo; se não, adicione `import { User } from "../models/User.js";`.)

2. No handler `GET /users/:id`, trocar `select("name")` por `select("name username avatarUrl bio")` e incluir os campos na resposta:
```ts
    const user = await User.findById(req.params.id).select("name username avatarUrl bio");
    // ...
    res.json({
      user: {
        id: user._id.toString(),
        name: user.name,
        username: user.username ?? null,
        avatarUrl: user.avatarUrl ?? "",
        bio: user.bio ?? "",
      },
      // ...counts/isFollowing/isMe/posts iguais...
    });
```

3. Em `serializePost`, ampliar o populate do autor e a saída. Onde os posts são buscados com `.populate("author", "name")`, trocar por `.populate("author", "name username avatarUrl")`. E no `serializePost`, incluir no autor:
```ts
    author: {
      id: author._id.toString(),
      name: author.name,
      username: author.username ?? null,
      avatarUrl: author.avatarUrl ?? "",
    },
```
(Ajuste o tipo `PopulatedAuthor` para incluir `username?: string` e `avatarUrl?: string`. Faça o mesmo populate em TODOS os pontos que serializam posts: feed, perfil, criação de post, detalhe — procure por `populate("author"` no arquivo.)

- [ ] **Step 4: Rodar e ver passar + suíte**

Run: `cd api && npx vitest run src/routes/social.test.ts`
Expected: PASS.
Run: `cd api && npm test`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/social.ts api/src/routes/social.test.ts
git commit -m "feat: GET /social/search + username/avatar/bio no perfil e posts"
```

---

### Task 5: Tipos e client do app (AppUser, updateMe, checkUsername, searchUsers)

**Files:**
- Modify: `app-android/src/api/auth.ts`
- Modify: `app-android/src/api/social.ts`
- Modify: `app-android/src/context/AuthContext.tsx`

**Interfaces:**
- Produces:
  - `AppUser` ganha `username: string | null`, `avatarUrl: string`, `bio: string`.
  - `registerRequest(name, email, password, username?)`.
  - `updateMe(token, patch: { username?; name?; bio?; avatarUrl? }): Promise<{ user: AppUser }>`.
  - `checkUsername(token, username): Promise<{ available: boolean }>`.
  - `searchUsers(token, q): Promise<{ users: SearchUser[] }>` com `SearchUser = { id; name; username: string | null; avatarUrl: string; isFollowing: boolean }`.
  - `AuthContext.register` passa a aceitar `username?`.

- [ ] **Step 1: Ampliar `AppUser` + funções de auth**

Em `app-android/src/api/auth.ts`:
```ts
export interface AppUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  avatarUrl: string;
  bio: string;
  tier: "free" | "premium";
  onboardingComplete: boolean;
}

export function registerRequest(name: string, email: string, password: string, username?: string) {
  return apiFetch<AuthResponse>("/auth/register", {
    method: "POST",
    body: { name, email, password, ...(username ? { username } : {}) },
  });
}

export function updateMe(token: string, patch: { username?: string; name?: string; bio?: string; avatarUrl?: string }) {
  return apiFetch<{ user: AppUser }>("/auth/me", { method: "PATCH", token, body: patch });
}

export function checkUsername(token: string, username: string) {
  return apiFetch<{ available: boolean }>(`/auth/check-username?username=${encodeURIComponent(username)}`, { token });
}
```

- [ ] **Step 2: `searchUsers` em social.ts**

Em `app-android/src/api/social.ts`, adicionar:
```ts
export interface SearchUser {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string;
  isFollowing: boolean;
}

export function searchUsers(token: string, q: string) {
  return apiFetch<{ users: SearchUser[] }>(`/social/search?q=${encodeURIComponent(q)}`, { token });
}
```

- [ ] **Step 3: AuthContext aceita username no register**

Em `app-android/src/context/AuthContext.tsx`, na interface `AuthState` e no `register`:
```ts
  register: (name: string, email: string, password: string, username?: string) => Promise<void>;
```
E no corpo:
```ts
  const register = useCallback(
    async (name: string, email: string, password: string, username?: string) => {
      const { token, user } = await registerRequest(name, email, password, username);
      await persist(token, user);
    },
    [persist]
  );
```
(Ajuste a lista de dependências/args conforme o código atual.)

- [ ] **Step 4: Verificar typecheck**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros. (Se o `UserProfile`/tipos que consomem o perfil precisarem de `username/avatarUrl/bio`, adicione-os agora — ver Task 10; mas o mínimo aqui é compilar.)

- [ ] **Step 5: Commit**

```bash
git add app-android/src/api/auth.ts app-android/src/api/social.ts app-android/src/context/AuthContext.tsx
git commit -m "feat: tipos/clients de identidade no app (updateMe, checkUsername, searchUsers)"
```

---

### Task 6: Componente `Avatar` reutilizável

**Files:**
- Create: `app-android/src/components/Avatar.tsx`

**Interfaces:**
- Produces: `Avatar({ uri, name, size }: { uri?: string | null; name: string; size?: number })` — mostra a imagem se `uri` não vazio; senão a inicial do nome num círculo colorido determinístico.

- [ ] **Step 1: Criar o componente**

Criar `app-android/src/components/Avatar.tsx`:

```tsx
import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { colors } from "../theme";

// Paleta determinística para o fundo do fallback (inicial).
const BG = ["#7C4DFF", "#00BFA5", "#FF7043", "#29B6F6", "#EC407A", "#66BB6A"];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return BG[h % BG.length];
}

export function Avatar({ uri, name, size = 44 }: { uri?: string | null; name: string; size?: number }) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[dim, styles.img]} />;
  }
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <View style={[dim, styles.fallback, { backgroundColor: colorFor(name) }]}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: colors.surfaceAlt },
  fallback: { alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontWeight: "800" },
});
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app-android/src/components/Avatar.tsx
git commit -m "feat: componente Avatar (foto ou inicial em círculo)"
```

---

### Task 7: Campo @username no cadastro

**Files:**
- Modify: `app-android/src/screens/RegisterScreen.tsx`

**Interfaces:**
- Consumes: `register(name, email, password, username?)` (Task 5), `checkUsername` (Task 5) — mas no cadastro o usuário ainda não tem token; portanto NÃO chame `checkUsername` aqui (é protegido). A validação de disponibilidade no cadastro é feita pelo backend (409); mostre o erro inline.

- [ ] **Step 1: Adicionar o campo e enviar no cadastro**

Em `app-android/src/screens/RegisterScreen.tsx`:
1. Estado: `const [username, setUsername] = useState("");`
2. Um `TextInput` novo (abaixo do nome), com prefixo visual "@", `autoCapitalize="none"`, `onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ""))}`, placeholder "seu_usuario", e uma dica: "3–20 caracteres: letras minúsculas, números, . e _".
3. No submit, passar `username` (só se preenchido) para `register(name, email, password, username || undefined)`.
4. Erro 409 (username tomado) do backend já vem como `ApiHttpError` com mensagem — exibir na área de erro existente da tela.

Não chame `checkUsername` aqui (endpoint protegido; sem token no cadastro).

- [ ] **Step 2: Verificar typecheck**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app-android/src/screens/RegisterScreen.tsx
git commit -m "feat: campo @username no cadastro"
```

---

### Task 8: Gate obrigatório de username (ChooseUsernameScreen)

**Files:**
- Create: `app-android/src/screens/ChooseUsernameScreen.tsx`
- Modify: `app-android/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `checkUsername`, `updateMe` (Task 5); `refreshUser` (AuthContext).
- Produces: gate — se `token` e `!user.username`, mostra `ChooseUsernameScreen` antes de tudo.

- [ ] **Step 1: Criar a tela**

Criar `app-android/src/screens/ChooseUsernameScreen.tsx`:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import { useAuth } from "../context/AuthContext";
import { checkUsername, updateMe } from "../api/auth";
import { PrimaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme";

export function ChooseUsernameScreen() {
  const { token, refreshUser } = useAuth();
  const [username, setUsername] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const valid = /^[a-z0-9._]{3,20}$/.test(username) && !username.startsWith(".") && !username.endsWith(".") && !username.includes("..");

  useEffect(() => {
    setAvailable(null);
    if (timer.current) clearTimeout(timer.current);
    if (!valid) return;
    setChecking(true);
    timer.current = setTimeout(async () => {
      try {
        const { available } = await checkUsername(token!, username);
        setAvailable(available);
      } catch {
        setAvailable(null);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [username, valid, token]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await updateMe(token!, { username });
      await refreshUser();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Escolha seu @usuário</Text>
      <Text style={styles.sub}>É como as pessoas vão te encontrar. Pode trocar depois.</Text>
      <View style={styles.inputRow}>
        <Text style={styles.at}>@</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ""))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="seu_usuario"
          placeholderTextColor={colors.textMuted}
        />
        {checking ? <ActivityIndicator color={colors.textMuted} /> : null}
      </View>
      <Text style={styles.hint}>3–20 caracteres: letras minúsculas, números, . e _</Text>
      {valid && available === false ? <Text style={styles.err}>Esse nome já está em uso.</Text> : null}
      {valid && available === true ? <Text style={styles.ok}>Disponível ✓</Text> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <PrimaryButton title="Continuar" onPress={handleSave} loading={saving} disabled={!valid || available !== true} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: "center", gap: spacing.sm },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.textMuted, marginBottom: spacing.md },
  inputRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  at: { color: colors.textMuted, fontSize: 16 },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: spacing.md, paddingHorizontal: spacing.xs },
  hint: { color: colors.textMuted, fontSize: 12 },
  ok: { color: colors.primary, fontWeight: "700" },
  err: { color: colors.danger, fontWeight: "600" },
});
```
(Confirme que `PrimaryButton` aceita `disabled`; se não, condicione o `onPress` a `valid && available===true` e cinza via estilo. Confirme `colors.danger` existe — existe no theme.)

- [ ] **Step 2: Ligar o gate no RootNavigator**

Em `app-android/src/navigation/RootNavigator.tsx`:
1. Import: `import { ChooseUsernameScreen } from "../screens/ChooseUsernameScreen";`
2. No `RootNavigator`, quando logado, decidir o gate ANTES do AppFlow:
```tsx
      {token ? (
        !user?.username ? (
          <AppStack.Navigator screenOptions={{ headerShown: false }}>
            <AppStack.Screen name="ChooseUsername" component={ChooseUsernameScreen} />
          </AppStack.Navigator>
        ) : (
          <AppFlow needsOnboarding={!user?.onboardingComplete} />
        )
      ) : (
        <AuthFlow />
      )}
```
3. Adicionar `ChooseUsername: undefined;` ao `AppStackParams` em `navigation/types.ts`.

- [ ] **Step 3: Verificar typecheck + bundle web**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros.
Run: `cd app-android && npx expo export --platform web`
Expected: exit 0. Depois: `rm -rf dist`.

- [ ] **Step 4: Commit**

```bash
git add app-android/src/screens/ChooseUsernameScreen.tsx app-android/src/navigation/RootNavigator.tsx app-android/src/navigation/types.ts
git commit -m "feat: gate obrigatório de @username (ChooseUsernameScreen)"
```

---

### Task 9: EditProfileScreen (avatar + username + bio + nome)

**Files:**
- Create: `app-android/src/screens/EditProfileScreen.tsx`
- Modify: `app-android/src/navigation/RootNavigator.tsx` (registrar rota)
- Modify: `app-android/src/navigation/types.ts` (`EditProfile: undefined`)

**Interfaces:**
- Consumes: `updateMe`, `checkUsername` (Task 5); `uploadImage` (`../api/uploads`); `expo-image-picker`; `Avatar` (Task 6); `refreshUser`.

- [ ] **Step 1: Criar a tela**

Criar `app-android/src/screens/EditProfileScreen.tsx` com: preview do `Avatar` (uri = avatarUrl atual), botão "Trocar foto" que faz o mesmo fluxo de `CreatePostScreen.pickImage` (expo-image-picker → `FormData` campo "image", web usa blob / native usa `{uri,name,type}` → `uploadImage(token, form)` → set `avatarUrl`); campos `@username` (com checagem via `checkUsername`, igual à Task 8), `bio` (multiline, contador 0/160), `nome`; botão "Salvar" → `updateMe(token, { username, name, bio, avatarUrl })` → `refreshUser()` → `nav.goBack()`. Erros (409) inline.

Reutilize o bloco de `pickImage` exatamente como em `app-android/src/screens/CreatePostScreen.tsx` (linhas ~30–66), trocando `setImageUrl` por `setAvatarUrl`. Importe `Platform, Alert` de react-native e `* as ImagePicker from "expo-image-picker"`.

Estrutura mínima (adapte estilos ao tema, reutilizando padrões do CreatePostScreen):
```tsx
import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Platform, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../context/AuthContext";
import { updateMe } from "../api/auth";
import { uploadImage } from "../api/uploads";
import { Avatar } from "../components/Avatar";
import { PrimaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme";

export function EditProfileScreen() {
  const nav = useNavigation();
  const { user, token, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function pickImage() {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permissão necessária", "Autorize o acesso às fotos."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(asset.uri)).blob();
        form.append("image", blob, asset.fileName ?? "avatar.jpg");
      } else {
        form.append("image", { uri: asset.uri, name: asset.fileName ?? "avatar.jpg", type: asset.mimeType ?? "image/jpeg" } as unknown as Blob);
      }
      const { url } = await uploadImage(token!, form);
      setAvatarUrl(url);
    } catch (e) {
      Alert.alert("Não foi possível enviar a foto", (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true); setError("");
    try {
      await updateMe(token!, { name, username, bio, avatarUrl });
      await refreshUser();
      nav.goBack();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.avatarRow}>
        <Avatar uri={avatarUrl} name={name || "?"} size={84} />
        <TouchableOpacity onPress={pickImage} disabled={uploading}>
          <Text style={styles.change}>{uploading ? "Enviando…" : "Trocar foto"}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.label}>@usuário</Text>
      <TextInput style={styles.input} value={username} autoCapitalize="none" onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ""))} placeholder="seu_usuario" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Nome</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Seu nome" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Bio ({bio.length}/160)</Text>
      <TextInput style={[styles.input, styles.bio]} value={bio} onChangeText={(v) => setBio(v.slice(0, 160))} placeholder="Fale de você" placeholderTextColor={colors.textMuted} multiline />
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <PrimaryButton title="Salvar" onPress={handleSave} loading={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm },
  avatarRow: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  change: { color: colors.primary, fontWeight: "700" },
  label: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, color: colors.text, fontSize: 16 },
  bio: { height: 90, textAlignVertical: "top" },
  err: { color: colors.danger, fontWeight: "600" },
});
```

- [ ] **Step 2: Registrar a rota**

Em `navigation/types.ts`: adicionar `EditProfile: undefined;` ao `AppStackParams`.
Em `RootNavigator.tsx`: importar `EditProfileScreen` e adicionar dentro do bloco de telas do `AppFlow`:
```tsx
          <AppStack.Screen
            name="EditProfile"
            component={EditProfileScreen}
            options={{ headerShown: true, title: "Editar perfil", ...headerStyle }}
          />
```

- [ ] **Step 3: Verificar typecheck + bundle web**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros.
Run: `cd app-android && npx expo export --platform web`
Expected: exit 0. Depois: `rm -rf dist`.

- [ ] **Step 4: Commit**

```bash
git add app-android/src/screens/EditProfileScreen.tsx app-android/src/navigation/RootNavigator.tsx app-android/src/navigation/types.ts
git commit -m "feat: EditProfileScreen (avatar + username + bio + nome)"
```

---

### Task 10: ProfileScreen mostra avatar/@username/bio + Editar perfil

**Files:**
- Modify: `app-android/src/screens/ProfileScreen.tsx`
- Modify: `app-android/src/api/social.ts` (tipo `UserProfile`)

**Interfaces:**
- Consumes: `Avatar` (Task 6); `EditProfile` route (Task 9); `UserProfile` com `username/avatarUrl/bio`.

- [ ] **Step 1: Ampliar o tipo `UserProfile`**

Em `app-android/src/api/social.ts`, no `interface UserProfile` (objeto `user`), garantir os campos:
```ts
  user: { id: string; name: string; username: string | null; avatarUrl: string; bio: string };
```
(Ajuste ao formato atual do tipo; adicione `username/avatarUrl/bio`.)

- [ ] **Step 2: Renderizar avatar/@username/bio + botão Editar**

Em `app-android/src/screens/ProfileScreen.tsx`, no cabeçalho do perfil (onde hoje mostra nome/contadores):
1. Import: `import { Avatar } from "../components/Avatar";`
2. Mostrar o `Avatar` (uri = `data.user.avatarUrl`, name = `data.user.name`, size ~84), o nome, `@${data.user.username}` (se houver) e a `bio` (se houver).
3. Quando for o próprio perfil (`data.isMe`), um botão "Editar perfil" → `nav.navigate("EditProfile")`. (O botão de follow para outros perfis permanece.)

Exemplo do cabeçalho:
```tsx
<View style={styles.headerCard}>
  <Avatar uri={data.user.avatarUrl} name={data.user.name} size={84} />
  <Text style={styles.name}>{data.user.name}</Text>
  {data.user.username ? <Text style={styles.handle}>@{data.user.username}</Text> : null}
  {data.user.bio ? <Text style={styles.bio}>{data.user.bio}</Text> : null}
  {/* linha de stats existente */}
  {data.isMe ? (
    <TouchableOpacity style={styles.editBtn} onPress={() => nav.navigate("EditProfile")}>
      <Text style={styles.editText}>Editar perfil</Text>
    </TouchableOpacity>
  ) : null /* botão follow/unfollow existente para outros */}
</View>
```
Adicionar estilos `name`/`handle`/`bio`/`editBtn`/`editText` coerentes com o tema (handle em `colors.textMuted`, editBtn com borda `colors.border`). Preserve a lista de posts e a lógica de follow existentes.

- [ ] **Step 3: Verificar typecheck + bundle web**

Run: `cd app-android && npx tsc --noEmit`
Expected: sem erros.
Run: `cd app-android && npx expo export --platform web`
Expected: exit 0. Depois: `rm -rf dist`.

- [ ] **Step 4: Commit**

```bash
git add app-android/src/screens/ProfileScreen.tsx app-android/src/api/social.ts
git commit -m "feat: perfil mostra avatar/@username/bio + botão Editar perfil"
```

---

## Validação final (manual, pelo Asafe)
- Backend: `cd api && npm test` (tudo verde).
- App: cadastrar novo usuário com @username → entra direto (sem gate). Logar com usuário antigo (sem username) → cai no ChooseUsernameScreen → define → entra.
- Editar perfil: trocar foto (upload), username, bio, nome → salvar → ver refletido no perfil.
- Buscar (via chamada à API ou quando a Parte 2 existir): `/social/search?q=` retorna pessoas.

## Notas de verificação para o implementador
- `api/src/routes/social.test.ts`: use o padrão de usuários/tokens já presente no arquivo (2 usuários). Se não houver usernames no setup, registre dois usuários com `username` no início do novo teste.
- `serializePost`/`populate("author"`: há vários pontos que serializam posts (feed, perfil, criar, detalhe) — atualize TODOS os `populate("author", "name")` para incluir `username avatarUrl`, senão o autor virá sem os campos em alguns lugares.
- `PrimaryButton`: confirme se aceita `disabled`; se não, trate o desabilitado condicionando o `onPress` + estilo.
- Confirme `colors.danger`, `colors.surfaceAlt` existem no `theme.ts` (existem).
- `RegisterScreen`: NÃO chame `checkUsername` (endpoint protegido; sem token no cadastro) — confie no 409 do backend.
