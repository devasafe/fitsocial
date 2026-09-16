# Treino duplicado e CRUD do próprio treino — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development
> para implementar tarefa a tarefa. Os passos usam caixa (`- [ ]`) para acompanhamento.

**Objetivo:** impedir que o mesmo treino seja gravado duas vezes, e dar à pessoa como apagar e
corrigir os próprios treinos sem deixar recorde fantasma nem post órfão.

**Arquitetura:** a proteção contra repetição vive no servidor, no único ponto por onde os três
caminhos de criação passam (`services/activities.ts`), porque a tela não alcança recarregamento
de navegador nem restauração de app. O CRUD **já existe** em `routes/activities.ts` e está
errado: apagar não remove o post ligado nem reconstrói os recordes, e editar só entende treino
de força. O app não chama nenhuma das duas rotas.

**Stack:** Node 20, Express, TypeScript strict, Mongoose, zod, vitest; Expo/React Native com
react-native-web.

**Spec:** `docs/superpowers/specs/2026-09-16-treino-duplicado-e-crud-design.md`

## Restrições globais

- **Existe um APK 1.2.0 instalado que não atualiza sozinho.** Nenhum campo novo pode ser
  obrigatório, nenhum campo existente pode sumir da resposta, e nenhuma rota pode passar a
  recusar o que hoje aceita. Cliente que não manda a chave continua funcionando.
- **Nunca dado de saúde, token ou e-mail em log.**
- Envelope `{data, meta}` nas respostas. Rota fina que delega ao service. Zod na borda.
- Índice para toda query nova.
- Fuso `America/Sao_Paulo` só através de `api/src/utils/dia.ts`.
- `docs/VISAO.md`: nenhum texto pode julgar a pessoa. Vale para as confirmações de apagar.
- Conventional Commits em português.
- **Conferir o CÓDIGO DE SAÍDA da suíte** (`npx vitest run; echo "saida=$?"`), nunca a linha
  "Tests passed": o vitest sai 1 com rejeição de promise não tratada mesmo com tudo verde, e é
  o código de saída que o portão do deploy lê.
- O `pro/` e o `app-android/` **não têm runner de teste** para telas. Não invente teste de tela;
  diga no relatório que não há runner em vez de fingir que rodou.

---

# Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `api/src/models/Activity.ts` | ganha `clientKey` e `impressao`, com os índices |
| `api/src/services/impressaoDoTreino.ts` (novo) | impressão digital estável do conteúdo de um treino |
| `api/src/services/activities.ts` | reconhecer repetição antes de criar; expor `apagarAtividade` e `editarAtividade` |
| `api/src/routes/activities.ts` | `PATCH` e `DELETE` passam a delegar ao service |
| `api/src/routes/checkins.ts` | repassa a chave |
| `app-android/src/api/activities.ts` | `apagarAtividade`, `editarAtividade`, e a chave no envio |
| `app-android/src/lib/chaveDoTreino.ts` (novo) | gera e guarda a chave enquanto o treino está em andamento |
| `app-android/src/screens/ActivityDetailScreen.tsx` | entradas de editar e apagar, com a confirmação |
| `app-android/src/screens/EditarTreinoScreen.tsx` (novo) | o formulário de correção |

---

# Tarefa 1: a impressão digital de um treino

**Arquivos:**
- Criar: `api/src/services/impressaoDoTreino.ts`
- Testar: `api/src/services/impressaoDoTreino.test.ts`

**Produz:** `impressaoDoTreino(input: { kind, sportId, durationSec, payload }): string`

A rede curta precisa responder "este treino é o mesmo conteúdo daquele?". Comparar o `payload`
inteiro com `JSON.stringify` não serve: a ordem das chaves de um objeto vindo do cliente não é
estável, e campos derivados (slugs preenchidos no servidor, `lido` do WOD) mudam sem o treino
mudar.

- [ ] **Passo 1: o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { impressaoDoTreino } from "./impressaoDoTreino.js";

describe("impressão digital do treino", () => {
  it("não muda com a ordem das chaves", () => {
    const a = impressaoDoTreino({ kind: "strength", sportId: "musculacao", durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } });
    const b = impressaoDoTreino({ kind: "strength", sportId: "musculacao", durationSec: 3600,
      payload: { exercises: [{ sets: [{ reps: 8, weightKg: 80 }], name: "Supino" }] } });
    expect(a).toBe(b);
  });

  it("muda quando um número do treino muda", () => {
    const base = { kind: "strength" as const, sportId: "musculacao", durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } };
    const outro = { ...base,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 82.5, reps: 8 }] }] } };
    expect(impressaoDoTreino(base)).not.toBe(impressaoDoTreino(outro));
  });

  it("muda quando o esporte muda, mesmo com o conteúdo igual", () => {
    const p = { kind: "class" as const, durationSec: 3600, payload: { modality: "boxe" } };
    expect(impressaoDoTreino({ ...p, sportId: "boxe" }))
      .not.toBe(impressaoDoTreino({ ...p, sportId: "muay_thai" }));
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

`cd api && npx vitest run src/services/impressaoDoTreino.test.ts` — espera erro de módulo não
encontrado.

- [ ] **Passo 3: implementar**

Ordenar as chaves recursivamente antes de serializar, e passar por `createHash("sha256")`,
devolvendo hex. Ignorar `undefined` e `null` para que ausência e nulo não produzam impressões
diferentes. **Escreva no comentário do arquivo por que a ordenação existe** — sem isso, a
próxima pessoa troca por `JSON.stringify` e a rede passa a não pegar nada, em silêncio.

- [ ] **Passo 4: rodar e ver passar.** Depois `npx tsc --noEmit`.

- [ ] **Passo 5: commit** — `feat(api): impressao digital estavel do conteudo de um treino`

---

# Tarefa 2: o modelo guarda a chave e a impressão

**Arquivos:**
- Modificar: `api/src/models/Activity.ts`
- Testar: `api/src/routes/atividadeRepetida.test.ts` (criar; cresce nas tarefas 3 e 4)

**Consome:** `impressaoDoTreino` (Tarefa 1).

- [ ] **Passo 1: o teste que falha**

```ts
it("duas atividades do mesmo usuário não podem ter a mesma clientKey", async () => {
  const base = { user: userId, sportId: "musculacao", kind: "strength" as const,
    startedAt: new Date(), durationSec: 60, visibility: "private" as const,
    payload: {}, metrics: {}, disclaimer: undefined };
  await Activity.create({ ...base, clientKey: "k1" });
  await expect(Activity.create({ ...base, clientKey: "k1" })).rejects.toThrow();
});

it("atividades SEM clientKey continuam podendo coexistir", async () => {
  // Todo treino que já existe em produção não tem chave. Um índice único que
  // não seja esparso recusaria o segundo deles.
  const base = { user: userId, sportId: "musculacao", kind: "strength" as const,
    startedAt: new Date(), durationSec: 60, visibility: "private" as const,
    payload: {}, metrics: {} };
  await Activity.create(base);
  await expect(Activity.create(base)).resolves.toBeTruthy();
});
```

- [ ] **Passo 2: rodar e ver falhar** — o primeiro passa (não há índice), o segundo passa. Só
depois de criar o índice o primeiro vira verde de verdade. **Confirme que o primeiro falha
antes**: se ele já passar, o teste não está provando nada — investigue antes de seguir.

- [ ] **Passo 3: implementar**

```ts
    /**
     * Identidade do ENVIO, gerada pelo app quando o treino COMEÇA.
     *
     * Começar acontece uma vez; salvar é o que se repete — a tela pode ser
     * recarregada pelo navegador ou restaurada pelo sistema, e aí o mesmo
     * treino é enviado de novo. Opcional porque todo treino já gravado não
     * tem chave, e porque o APK instalado não a manda.
     */
    clientKey: { type: String, default: undefined },
    /** Resumo estável do conteúdo — ver `services/impressaoDoTreino.ts`. */
    impressao: { type: String, default: undefined, index: true },
```

E os índices:

```ts
// Esparso de propósito: sem isso, o segundo treino SEM chave (ou seja, todos os
// que já existem) seria recusado por "duplicata de null".
activitySchema.index({ user: 1, clientKey: 1 }, { unique: true, sparse: true });
// Serve a janela curta da rede contra repetição.
activitySchema.index({ user: 1, impressao: 1, createdAt: -1 });
```

- [ ] **Passo 4: rodar e ver passar.** A suíte INTEIRA, porque índice novo afeta escrita em
todo teste que cria atividade. `npx tsc --noEmit`.

- [ ] **Passo 5: commit** — `feat(api): Activity guarda a chave do envio e a impressao do conteudo`

---

# Tarefa 3: o servidor reconhece o mesmo treino

**Arquivos:**
- Modificar: `api/src/services/activities.ts`
- Modificar: `api/src/routes/activities.ts`, `api/src/routes/checkins.ts` (aceitar e repassar)
- Testar: `api/src/routes/atividadeRepetida.test.ts`

**Consome:** `impressaoDoTreino` (T1), os campos do modelo (T2).
**Produz:** `createActivity` passa a devolver `{ activity, post, newPRs, repetido: boolean }`.

`createActivity` é o ponto por onde os três caminhos passam (`POST /activities` nas duas
variantes e `POST /checkins`) — a proteção vai aí, e não em cada rota.

- [ ] **Passo 1: os testes que falham**

```ts
it("o mesmo envio duas vezes cria UM treino, e o segundo devolve o primeiro", async () => {
  const corpo = { sportId: "musculacao", kind: "strength", durationSec: 3600,
    clientKey: "sessao-1",
    payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } };

  const um = await como(token).post("/activities").send(corpo).expect(201);
  const dois = await como(token).post("/activities").send(corpo).expect(200);

  expect(dois.body.data.id).toBe(um.body.data.id);
  expect(dois.body.meta.repetido).toBe(true);
  expect(await Activity.countDocuments({ user: userId })).toBe(1);
});

it("sem chave, o mesmo conteúdo em menos de 10 minutos também não duplica", async () => {
  // É o caso do APK instalado, que não manda chave nenhuma.
  const corpo = { sportId: "musculacao", kind: "strength", durationSec: 3600,
    payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } };

  await como(token).post("/activities").send(corpo).expect(201);
  const dois = await como(token).post("/activities").send(corpo).expect(200);

  expect(dois.body.meta.repetido).toBe(true);
  expect(await Activity.countDocuments({ user: userId })).toBe(1);
});

it("`mesmoAssim` grava o segundo, para quem treinou duas vezes de verdade", async () => {
  const corpo = { sportId: "musculacao", kind: "strength", durationSec: 3600,
    payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } };

  await como(token).post("/activities").send(corpo).expect(201);
  await como(token).post("/activities").send({ ...corpo, mesmoAssim: true }).expect(201);

  expect(await Activity.countDocuments({ user: userId })).toBe(2);
});

it("conteúdo diferente no mesmo minuto grava os dois", async () => {
  // A rede compara CONTEÚDO, não horário: dois treinos diferentes seguidos são
  // dois treinos, e recusá-los seria pior que a duplicata que ela evita.
  const base = { sportId: "musculacao", kind: "strength", durationSec: 3600 };
  await como(token).post("/activities")
    .send({ ...base, payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } })
    .expect(201);
  await como(token).post("/activities")
    .send({ ...base, payload: { exercises: [{ name: "Agachamento", sets: [{ weightKg: 100, reps: 5 }] }] } })
    .expect(201);

  expect(await Activity.countDocuments({ user: userId })).toBe(2);
});

it("o mesmo conteúdo DEPOIS da janela grava normalmente", async () => {
  const corpo = { sportId: "musculacao", kind: "strength", durationSec: 3600,
    payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } };
  const um = await como(token).post("/activities").send(corpo).expect(201);
  await Activity.updateOne({ _id: um.body.data.id },
    { $set: { createdAt: new Date(Date.now() - 20 * 60_000) } }, { timestamps: false });

  await como(token).post("/activities").send(corpo).expect(201);
  expect(await Activity.countDocuments({ user: userId })).toBe(2);
});

it("a repetição NÃO cria um segundo post no feed", async () => {
  const corpo = { sportId: "musculacao", kind: "strength", durationSec: 3600,
    clientKey: "sessao-2", share: true, caption: "bora",
    payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } };
  await como(token).post("/activities").send(corpo).expect(201);
  await como(token).post("/activities").send(corpo).expect(200);
  expect(await Post.countDocuments({ author: userId })).toBe(1);
});

it("a chave é por PESSOA: mesma chave de outra conta não colide", async () => {
  const corpo = { sportId: "musculacao", kind: "strength", durationSec: 3600,
    clientKey: "mesma", payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } };
  await como(token).post("/activities").send(corpo).expect(201);
  await como(tokenDeOutro).post("/activities").send(corpo).expect(201);
  expect(await Activity.countDocuments({})).toBe(2);
});
```

- [ ] **Passo 2: rodar e ver falhar.** Todos, menos o de conteúdo diferente e o de fora da
janela, que já deviam passar.

- [ ] **Passo 3: implementar**

Em `createActivity`, **antes** de qualquer trabalho caro (interpretar WOD, processar GPS,
detectar recorde):

```ts
  // Reconhecer repetição vem ANTES de interpretar o WOD e processar o GPS: o
  // trabalho caro não deve ser feito para ser jogado fora, e `processTrack`
  // sobre um percurso longo não é barato.
  const repetida = await acharRepeticao(userId, input);
  if (repetida) return { activity: repetida, post: null, newPRs: [], repetido: true };
```

E o service:

```ts
const JANELA_DA_REDE_MS = 10 * 60_000;

/**
 * Este treino já foi gravado?
 *
 * Duas perguntas, nesta ordem. A CHAVE é a resposta certa: ela vem do app e
 * identifica o ENVIO, então não depende de adivinhar intenção. A IMPRESSÃO é
 * rede para quem não a manda — o APK instalado, que não atualiza sozinho.
 *
 * A rede só pega conteúdo idêntico numa janela de dez minutos. Para engolir um
 * treino legítimo, a pessoa teria de registrar dois treinos com exatamente os
 * mesmos exercícios, pesos e repetições em menos de dez minutos — o que não é
 * "treinei duas vezes", é o mesmo treino enviado duas vezes. `mesmoAssim`
 * existe para o caso em que ela diz que foi outro.
 */
async function acharRepeticao(userId, input) {
  if (input.mesmoAssim) return null;

  if (input.clientKey) {
    return Activity.findOne({ user: userId, clientKey: input.clientKey });
  }

  return Activity.findOne({
    user: userId,
    impressao: impressaoDoTreino(input),
    createdAt: { $gte: new Date(Date.now() - JANELA_DA_REDE_MS) },
  });
}
```

Grave `clientKey` e `impressao` no `Activity.create`. A impressão é calculada sobre o `input`
**cru**, antes dos enriquecimentos do servidor — é o que o cliente mandou que define se é o
mesmo envio.

**Corrida:** dois envios simultâneos com a mesma chave passam os dois pelo `findOne` e chegam
os dois no `create`; o índice único faz o segundo estourar com E11000. Trate esse erro
devolvendo o que já existe, em vez de deixar virar 500 — é o mesmo resultado, por outro
caminho.

Nas rotas: acrescente `clientKey: z.string().min(8).max(100).optional()` e
`mesmoAssim: z.boolean().optional()` aos schemas de criação (`POST /activities` nas duas
variantes e `POST /checkins`), e responda `200` quando `repetido`, `201` quando não, com
`meta.repetido`.

- [ ] **Passo 4: rodar e ver passar.** Suíte INTEIRA + `npx tsc --noEmit`.

- [ ] **Passo 5: commit** — `feat(api): o servidor reconhece o mesmo treino enviado duas vezes`

---

# Tarefa 4: apagar de verdade

**Arquivos:**
- Modificar: `api/src/services/activities.ts` (novo `apagarAtividade`), `api/src/routes/activities.ts`
- Testar: `api/src/routes/apagarTreino.test.ts` (criar)

**O defeito que existe hoje:** `DELETE /activities/:id` faz `Activity.deleteOne` e nada mais.
O post ligado sobrevive apontando para um treino que não existe, e o recorde que só existia por
causa daquele treino continua no quadro de PRs — a pessoa apaga o treino e o recorde dele fica.

- [ ] **Passo 1: os testes que falham**

```ts
it("apagar o treino apaga o post ligado, com curtidas e comentários", async () => {
  // Post que conta um treino que não aconteceu é mentira no feed dos outros.
  await como(token).delete(`/activities/${atividadeId}`).expect(200);
  expect(await Post.countDocuments({ activity: atividadeId })).toBe(0);
  expect(await Comment.countDocuments({ post: postId })).toBe(0);
  expect(await Like.countDocuments({ post: postId })).toBe(0);
});

it("apagar o treino derruba o recorde que só existia por causa dele", async () => {
  // Antes: o treino sumia e o recorde ficava. A pessoa via um PR de 100kg de um
  // treino que ela mesma apagou, sem nenhum jeito de tirar.
  expect(await PersonalRecord.countDocuments({ user: userId })).toBeGreaterThan(0);
  await como(token).delete(`/activities/${atividadeId}`).expect(200);
  expect(await PersonalRecord.countDocuments({ user: userId })).toBe(0);
});

it("o recorde de OUTRO treino sobrevive", async () => {
  // `recomputeUserPRs` reconstrói do zero: o teste acima passaria mesmo se a
  // implementação apagasse tudo. Este prende a diferença.
  await como(token).delete(`/activities/${treinoLeveId}`).expect(200);
  const prs = await PersonalRecord.find({ user: userId });
  expect(prs.length).toBe(1);
  expect(prs[0]!.valor).toBe(100);
});

it("não dá para apagar o treino de outra pessoa, e a resposta é 404", async () => {
  // 403 confirmaria que aquele treino existe.
  await como(tokenDeOutro).delete(`/activities/${atividadeId}`).expect(404);
  expect(await Activity.countDocuments({ _id: atividadeId })).toBe(1);
});

it("apagar continua livre para quem tem treinador", async () => {
  // O treino é da pessoa; o profissional acompanha, não é dono. Diferente da
  // dieta, onde a trava existe porque lá o profissional ESCREVE.
  await vincular(coach.token, aluno.token, { treinos: true }, "coach");
  await como(aluno.token).delete(`/activities/${doAlunoId}`).expect(200);
});
```

- [ ] **Passo 2: rodar e ver falhar.** Os dois primeiros e o terceiro falham; os dois últimos
já passam.

- [ ] **Passo 3: implementar** — `apagarAtividade(userId, activityId)` no service, nesta ordem:
apaga `Comment` e `Like` dos posts daquele treino, apaga os `Post`, apaga o `Activity`, e chama
`recomputeUserPRs(userId)`. A rota vira três linhas delegando.

Constância, streak, total, calendário e gráficos **não precisam de nada**: são derivados na
leitura. Escreva isso no comentário, senão alguém acrescenta um recontador que não faz falta.

- [ ] **Passo 4: rodar e ver passar.** Suíte INTEIRA + `npx tsc --noEmit`.

- [ ] **Passo 5: commit** — `fix(api): apagar treino leva junto o post e o recorde dele`

---

# Tarefa 5: editar de verdade

**Arquivos:**
- Modificar: `api/src/services/activities.ts` (novo `editarAtividade`), `api/src/routes/activities.ts`
- Testar: `api/src/routes/editarTreino.test.ts` (criar)

**Os defeitos de hoje:** o `updateSchema` aceita `payload: strengthPayloadSchema` — só força, e
usa `computeStrengthMetrics` direto, então editar uma corrida ou um WOD é impossível. Não
recalcula recorde: baixar o peso deixa o PR antigo de pé. Não permite mudar `startedAt`, que é
o caso "registrei no dia errado".

- [ ] **Passo 1: os testes que falham**

```ts
it("corrigir o peso para menos derruba o recorde que ele criou", async () => {
  await como(token).patch(`/activities/${id}`)
    .send({ payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } })
    .expect(200);
  const pr = await PersonalRecord.findOne({ user: userId });
  expect(pr!.valor).toBe(80);
});

it("corrigir o peso para mais cria o recorde", async () => {
  await como(token).patch(`/activities/${id}`)
    .send({ payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 120, reps: 8 }] }] } })
    .expect(200);
  expect((await PersonalRecord.findOne({ user: userId }))!.valor).toBe(120);
});

it("dá para corrigir a data de um treino registrado no dia errado", async () => {
  const ontem = new Date(Date.now() - 24 * 3600_000).toISOString();
  const r = await como(token).patch(`/activities/${id}`).send({ startedAt: ontem }).expect(200);
  expect(new Date(r.body.data.startedAt).toDateString()).toBe(new Date(ontem).toDateString());
});

it("editar uma corrida funciona — não só treino de força", async () => {
  await como(token).patch(`/activities/${corridaId}`)
    .send({ payload: { distanceM: 10_000 } }).expect(200);
  const a = await Activity.findById(corridaId);
  expect((a!.metrics as { distanceKm: number }).distanceKm).toBe(10);
});

it("não dá para trocar o tipo nem o esporte do treino", async () => {
  // Transformar força em corrida não é editar, é outro treino — e deixaria o
  // payload incoerente com o tipo, que é dado impossível de interpretar depois.
  await como(token).patch(`/activities/${id}`).send({ kind: "endurance" }).expect(400);
  await como(token).patch(`/activities/${id}`).send({ sportId: "corrida" }).expect(400);
});

it("não dá para editar o treino de outra pessoa, e a resposta é 404", async () => {
  await como(tokenDeOutro).patch(`/activities/${id}`).send({ title: "meu" }).expect(404);
});

it("o resumo de recorde gravado no treino acompanha a edição", async () => {
  // É denormalizado para o cartão de compartilhar não consultar o banco. Se
  // ficar para trás, o cartão anuncia um recorde que não existe mais.
  await como(token).patch(`/activities/${id}`)
    .send({ payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 40, reps: 8 }] }] } })
    .expect(200);
  const a = await Activity.findById(id);
  expect((a!.metrics as { prs?: unknown[] }).prs ?? []).toHaveLength(0);
});
```

- [ ] **Passo 2: rodar e ver falhar.**

- [ ] **Passo 3: implementar**

`editarAtividade(userId, id, patch)`:
- recusa `kind` e `sportId` com 400 e uma frase que diga o porquê;
- aceita `startedAt` (com `z.coerce.date()`, e teto de hoje — não dá para registrar no futuro);
- quando o `payload` muda, passa pelo **mesmo caminho do `createActivity`**:
  `preencherSlugs` para força, `interpretarBlocos(normalizarWod(...))` para WOD, e
  `computeMetrics` para todos — **reaproveitando as funções**, não reescrevendo. O `payload`
  aceito é o do `kind` daquele treino, resolvido por um mapa `kind → schema`;
- depois, `recomputeUserPRs(userId)` e regrava o resumo denormalizado no treino.
  **Atenção à ordem:** o resumo vive em `metrics.prs` (não num campo `prs` no topo — ver
  `services/activities.ts`, `activity.set("metrics", { ...activity.metrics, prs: resumo })`), e
  `computeMetrics` **substitui** o objeto `metrics` inteiro. Recalcular as métricas apaga o
  resumo de recorde; ele tem de ser regravado DEPOIS, nunca antes;
- `markModified("payload")` e `markModified("metrics")`, que o código atual já faz e é
  necessário porque os dois são `Mixed`.

- [ ] **Passo 4: rodar e ver passar.** Suíte INTEIRA + `npx tsc --noEmit`.

- [ ] **Passo 5: commit** — `fix(api): editar treino alcanca todos os tipos e refaz os recordes`

---

# Tarefa 6: o app manda a chave

**Arquivos:**
- Criar: `app-android/src/lib/chaveDoTreino.ts`
- Modificar: `app-android/src/api/activities.ts`, e as telas que salvam treino
- Sem teste: o `app-android/` não tem runner para isto.

**Consome:** `clientKey` e `mesmoAssim` (T3).

- [ ] **Passo 1: o helper**

`chaveDoTreino(contexto: string)` devolve uma chave estável **enquanto o treino está em
andamento**, guardada em `AsyncStorage` sob uma chave derivada do contexto (ex.: o dia da
sessão do plano, ou a tela de registro). Gerada com `crypto.randomUUID()` quando não existe.
`limparChaveDoTreino(contexto)` apaga, e é chamada **depois** do salvamento dar certo, junto do
rascunho que o `CheckInScreen` já limpa.

O ponto que faz isto funcionar: a chave nasce quando o treino **começa**. Se ela fosse gerada
no clique de salvar, cada clique teria a sua, e dois cliques continuariam virando dois treinos.

- [ ] **Passo 2: ligar nas telas que salvam**

`CheckInScreen` e as demais telas de registro passam `clientKey` no envio e limpam a chave no
sucesso, exatamente onde já limpam o rascunho.

- [ ] **Passo 3: `cd app-android && npx tsc --noEmit`** (código de saída 0) e
`npm run checar-cores` — **este passo exige Node 22**, porque usa
`node --experimental-strip-types`.

- [ ] **Passo 4: commit** — `feat(app): a chave do treino nasce quando ele comeca`

---

# Tarefa 7: apagar e editar na tela

**Arquivos:**
- Modificar: `app-android/src/api/activities.ts`, `app-android/src/screens/ActivityDetailScreen.tsx`
- Criar: `app-android/src/screens/EditarTreinoScreen.tsx`
- Modificar: `app-android/src/navigation/RootNavigator.tsx` e `types.ts`

**Consome:** `DELETE` (T4) e `PATCH` (T5).

- [ ] **Passo 1: o cliente de API** — `apagarAtividade(token, id)` e
`editarAtividade(token, id, patch)` em `api/activities.ts`, seguindo a forma das funções
vizinhas.

- [ ] **Passo 2: as entradas na tela de detalhe** — só para o dono. "Editar" e "Apagar".

- [ ] **Passo 3: a confirmação de apagar, que precisa DIZER o que vai junto**

Se o treino tiver post com interação, a confirmação nomeia: "O post deste treino, com 4
comentários, também será apagado." É irreversível, e a pessoa precisa saber **antes**. Sem
número inventado: se não houver post, a frase não fala em post.

Nenhum texto pode julgar — nada de "tem certeza que quer perder seu progresso?". Descreva o que
acontece e pare.

- [ ] **Passo 4: a tela de edição** — os campos do envelope (título, data, duração, esforço,
sensação, notas, privacidade) e os números, no formato do tipo daquele treino. Reaproveite os
componentes de formulário das telas de registro em vez de escrever campos novos.

- [ ] **Passo 5: typecheck e cores** como na Tarefa 6.

- [ ] **Passo 6: commit** — `feat(app): apagar e corrigir o proprio treino`

---

# Tarefa 8: revisão e entrega

- [ ] Suíte inteira, **código de saída**: `cd api && npx vitest run; echo "saida=$?"`
- [ ] `npx tsc --noEmit` em `api/` e em `app-android/`
- [ ] `cd app-android && npm run checar-cores` (Node 22)
- [ ] Revisão de compatibilidade: a pergunta é o que isto faz com o **APK 1.2.0 instalado**.
      Em especial: a resposta `200` (em vez de `201`) numa repetição — o app antigo trata?
      Ele lê `res.status === 201` em algum lugar para decidir o que fazer depois?
      **Este é o maior risco desta frente** e precisa ser conferido no código do app, não
      presumido.
- [ ] Revisão ampla da branch

---

# Fora deste plano

- Achar qual caminho da UI produziu o duplicado relatado. A idempotência protege independente
  da resposta; a telemetria de quantas repetições a chave e a rede barram, por caminho, aponta
  o defeito com evidência depois.
- Lixeira/desfazer. Apagar é irreversível por decisão.
- As outras cinco frentes pedidas no mesmo dia: hierarquia da home (que sobe só depois de
  aprovação visual), meta no gráfico de calorias, editar a ficha, e os alunos do papel revogado.
