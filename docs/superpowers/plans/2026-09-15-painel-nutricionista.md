# Painel do nutricionista — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans`, tarefa a tarefa.
> Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** dar ao nutricionista um painel com as funções dele — ver a aderência à dieta,
ler a dieta corrente e prescrever a dieta — distinto do painel do coach, no mesmo domínio.

**Arquitetura:** o `ProfessionalLink` já guarda `papel`, e o painel decide o que mostrar por
ele. No backend, a guarda que hoje exige `escopo.treinos` para tudo passa a receber qual parte
a rota precisa; as rotas de nutrição exigem `escopo.dieta`. A prescrição de dieta espelha a de
treino: cria versão nova, preserva a outra metade do plano e avisa pela conversa.

**Stack:** Node 20 · Express · TypeScript strict · Mongoose · zod · vitest · Vite + React 19.

**Spec:** [`docs/superpowers/specs/2026-09-15-painel-nutricionista-design.md`](../specs/2026-09-15-painel-nutricionista-design.md)

## Restrições globais

- **Envelope `{ data, meta }`** em rota nova, e `metaDaJanela` no formato
  `{ dias, diasPedidos?, limitadoPor: "plano" }` quando houver janela.
- **Os dois lados chamam a MESMA função.** O painel do profissional nunca recalcula o que o
  app do aluno calcula — há teste comparando as duas respostas, e ele quebra se divergirem.
- **404 e 403 dizem coisas diferentes, e isso é requisito:** 404 "Este não é seu aluno" quando
  não há vínculo; 403 "Este aluno não abriu … para você" quando há vínculo e o escopo está
  fechado. A diferença entre *"não registrou"* e *"não me deixou ver"* é o que o profissional
  precisa saber.
- **Campo ausente, não campo vazio.** Bloco que o escopo não libera **não vem** na resposta —
  não vem zerado.
- **A prescrição CRIA VERSÃO do `Plan`**, nunca edita no lugar. A frente 2 depende da versão
  para saber qual meta valia em cada dia.
- **zod na borda**, antes da regra. Rota fina que delega ao service.
- **Teste de integração com Mongo em memória para todo endpoint novo.**
- **O painel `pro/` NÃO tem runner de teste e NÃO tem portão de CI.** O workflow deploya
  `pro/` sem checar nada. As tarefas de painel não têm passo de teste automatizado — não
  invente um — e o `npx tsc --noEmit` dentro de `pro/` tem de ser rodado **à mão**, porque
  ninguém vai rodar por você.
- **Nada de trava nova em rota de leitura do aluno** além do escopo. E nenhuma mudança em
  `POST /nutrition/logs` ou no `DiarioScreen`.
- Interface e texto em português do Brasil. Commits em Conventional Commits, em português.

---

# Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `api/src/routes/pro.ts` | **Modificar.** Guarda generalizada, ficha por escopo, 3 rotas novas |
| `api/src/routes/proNutricao.test.ts` | **Criar.** Integração das rotas de nutrição do painel |
| `api/src/routes/proEscopo.test.ts` | **Criar.** Integração da guarda por escopo |
| `api/src/routes/plans.ts` | **Modificar.** `recusarSeTemNutricionista` nas portas da dieta |
| `api/src/routes/travaDaDieta.test.ts` | **Criar.** Integração da trava de autoria |
| `api/src/services/ai/coach.ts` | **Modificar.** `adjust_diet` respeita a trava |
| `pro/src/api.ts` | **Modificar.** Cliente das rotas novas |
| `pro/src/pages/Aluno.tsx` | **Modificar.** Abas escolhidas pelo papel do vínculo |
| `pro/src/components/Nutricao.tsx` | **Criar.** A aba de aderência |
| `pro/src/components/PrescreverDieta.tsx` | **Criar.** O formulário de prescrição |
| `pro/src/pages/Alunos.tsx` | **Modificar.** Triagem do nutri por dias sem registro |

---

# Tarefa 1: a guarda passa a saber de qual parte se fala

Hoje `alunoComTreinosAbertos` (`api/src/routes/pro.ts:272`) exige `escopo.treinos === true` para
**toda** leitura do aluno. Um nutricionista cujo aluno abriu só a dieta leva 403 em todas as seis
rotas — nem abre a ficha.

**Arquivos:**
- Modificar: `api/src/routes/pro.ts` (a função e os seis pontos de chamada)
- Criar: `api/src/routes/proEscopo.test.ts`

**Interfaces produzidas:**
```ts
async function alunoDoProfissional(
  req: { user?: { _id: mongoose.Types.ObjectId }; params: Record<string, string> },
  id: string,
  opts?: { parte?: "treinos" | "dieta"; preferido?: PapelPro }
): Promise<{
  /** O vínculo escolhido para esta chamada. */
  link: LinkAtivo;
  /** TODOS os vínculos ativos desta dupla — quem é coach E nutri tem dois. */
  links: LinkAtivo[];
  clientId: mongoose.Types.ObjectId;
}>;
```

- [ ] **Passo 1: escrever o teste que falha**

Criar `api/src/routes/proEscopo.test.ts`. Abra `api/src/routes/pro.test.ts` (ou o arquivo de
teste do painel que existir) e **copie dele o preâmbulo** — como se registra um profissional,
como se concede a capacidade e como se cria um vínculo aceito. Não invente helpers novos.

Os casos:

```ts
describe("A ficha abre pelo vínculo, e cada bloco pelo escopo", () => {
  it("nutri com dieta aberta e treinos fechados ABRE a ficha", async () => {
    // Hoje isto é 403 e o profissional não vê nem o nome do aluno.
    const r = await comoNutri.get(`/pro/alunos/${alunoId}`).expect(200);
    expect(r.body.data.aluno.nome).toBeTruthy();
    expect(r.body.data.vinculo.papel).toBe("nutri");
  });

  it("com treinos fechados, os blocos de treino NÃO VÊM — e não vêm vazios", async () => {
    // Campo ausente é "não me deixou ver". Campo vazio seria "não treinou", que
    // é uma afirmação sobre a vida do aluno que nós não temos como fazer.
    const r = await comoNutri.get(`/pro/alunos/${alunoId}`).expect(200);
    expect(r.body.data.exercicios).toBeUndefined();
    expect(r.body.data.calendario).toBeUndefined();
    expect(r.body.data.constancia).toBeUndefined();
  });

  it("coach com treinos abertos continua vendo tudo que via", async () => {
    const r = await comoCoach.get(`/pro/alunos/${alunoId}`).expect(200);
    expect(r.body.data.exercicios).toBeDefined();
    expect(r.body.data.calendario).toBeDefined();
    expect(r.body.data.constancia).toBeDefined();
  });

  it("rota de dado de treino com escopo fechado ainda é 403, e diz por quê", async () => {
    const r = await comoNutri.get(`/pro/alunos/${alunoId}/grupos`).expect(403);
    expect(r.body.error).toMatch(/treinos/i);
  });

  it("quem não é profissional do aluno recebe 404, não 403", async () => {
    // 403 diria "existe um vínculo aqui" para quem não tem nenhum.
    await comoEstranho.get(`/pro/alunos/${alunoId}`).expect(404);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/routes/proEscopo.test.ts`
Esperado: FALHA — os dois primeiros casos dão 403.

- [ ] **Passo 3: generalizar a função**

Em `api/src/routes/pro.ts`, substituir `alunoComTreinosAbertos` por:

```ts
/**
 * O aluno é meu, e ele abriu esta parte da vida dele para mim?
 *
 * Sem `parte`, a pergunta é só "o aluno é meu": é o caso da ficha, que precisa
 * abrir para qualquer profissional do aluno e mostrar o que o escopo permitir.
 * Com `parte`, exige aquele escopo naquele vínculo.
 *
 * A escolha entre vínculos continua sendo a de antes, e pelo mesmo motivo: quem
 * acompanha a mesma pessoa como treinador E como nutricionista tem dois
 * vínculos ativos, com escopos diferentes. Pegar "um deles" negava acesso a
 * quem tinha, de forma intermitente — o pior jeito de um bug de permissão
 * aparecer.
 */
async function alunoDoProfissional(
  req: { user?: { _id: mongoose.Types.ObjectId }; params: Record<string, string> },
  id: string,
  opts: { parte?: "treinos" | "dieta"; preferido?: PapelPro } = {}
) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Aluno não encontrado.");

  const { parte, preferido } = opts;
  const clientId = new mongoose.Types.ObjectId(id);
  const links = await vinculosAtivos(clientId, req.user!._id);
  const abre = (l: (typeof links)[number]) => (parte ? l.escopo?.[parte] === true : true);

  const link =
    links.find((l) => l.papel === preferido && abre(l)) ??
    links.find(abre) ??
    links.find((l) => l.papel === preferido) ??
    links[0];

  if (!link) throw new HttpError(404, "Este não é seu aluno.");
  if (!abre(link)) {
    const oQue = parte === "dieta" ? "a dieta" : "os treinos";
    throw new HttpError(403, `Este aluno não abriu ${oQue} para você.`);
  }
  return { link, clientId };
}
```

- [ ] **Passo 4: apontar os pontos de chamada**

São seis, e cada um diz agora de que parte precisa. Todos ficam
`alunoDoProfissional(req, String(req.params.id), { parte: "treinos" })`, **menos a ficha**
(`GET /alunos/:id`, linha ~311), que passa a ser `alunoDoProfissional(req, String(req.params.id))`
— sem parte.

O `PUT /alunos/:id/treino` (linha ~824) mantém o papel preferido:
`alunoDoProfissional(req, String(req.params.id), { parte: "treinos", preferido: "coach" })`.

- [ ] **Passo 5: a ficha monta a resposta por escopo**

Ainda em `GET /alunos/:id`, trocar o bloco de dados por:

```ts
const podeTreinos = link.escopo?.treinos === true;

const [exercicios, calendario, datas] = podeTreinos
  ? await Promise.all([
      exerciciosDoUsuario(clientId, dias),
      calendarioDoUsuario(clientId, 365),
      Activity.find({ user: clientId }).select("startedAt").sort({ startedAt: -1 }).limit(400),
    ])
  : [undefined, undefined, undefined];

res.json({
  data: {
    aluno: { /* … como estava … */ },
    vinculo: { id: link._id.toString(), papel: link.papel, escopo: link.escopo, desde: link.aceitoEm },
    // Ausentes quando o escopo não abre: ausência é "não me deixou ver", e
    // zero seria uma afirmação sobre a vida do aluno.
    ...(podeTreinos
      ? { constancia: computeStats(datas!.map((a) => ({ date: a.startedAt }))), exercicios, calendario }
      : {}),
  },
  meta: { dias },
});
```

**A ficha NÃO ganha bloco de nutrição.** A spec fala em "cada bloco conforme o escopo", e o
bloco de nutrição é servido pela rota própria da Tarefa 2 — que é a mesma regra, cumprida por
outro caminho. Não acrescente um bloco de nutrição aqui: seriam dois lugares calculando a mesma
coisa, e um deles ficaria para trás.

- [ ] **Passo 6: a ficha devolve TODOS os vínculos**

Quem acompanha a mesma pessoa como coach **e** como nutricionista tem dois `ProfessionalLink`
ativos. O `vinculo` singular escolhe um, e o painel precisa dos dois para montar as abas dos
dois papéis. Acrescente ao lado dele, sem removê-lo:

```ts
vinculo: { id: link._id.toString(), papel: link.papel, escopo: link.escopo, desde: link.aceitoEm },
// Todos os vínculos ativos desta dupla. `vinculo` continua sendo um deles, para
// não quebrar o painel que já está no ar; `vinculos` é o que permite a quem é
// coach E nutri do mesmo aluno ver as abas dos dois papéis.
vinculos: links.map((l) => ({
  id: l._id.toString(), papel: l.papel, escopo: l.escopo, desde: l.aceitoEm,
})),
```

Para isso, `alunoDoProfissional` precisa devolver `links` junto — acrescente ao retorno dela:
`return { link, links, clientId };`

E um teste a mais em `proEscopo.test.ts`:

```ts
it("quem é coach E nutri do mesmo aluno recebe os dois vínculos", async () => {
  const r = await comoAmbos.get(`/pro/alunos/${alunoId}`).expect(200);
  expect(r.body.data.vinculos).toHaveLength(2);
  expect(r.body.data.vinculos.map((v: { papel: string }) => v.papel).sort()).toEqual(["coach", "nutri"]);
});
```

- [ ] **Passo 7: rodar e ver passar**

Rodar: `cd api && npx vitest run; echo "saida=$?"; npx tsc --noEmit`
Esperado: `saida=0`, sem linha `Errors`, typecheck limpo. **Os testes do painel do coach que já
existem têm de continuar passando** — se algum quebrar, a generalização mudou comportamento.

**Confira o CÓDIGO DE SAÍDA, não só a linha "Tests passed":** o vitest sai 1 com rejeição de
promise não tratada mesmo com tudo verde, e é isso que o portão do deploy lê.

- [ ] **Passo 8: commit**

```bash
git add api/src/routes/pro.ts api/src/routes/proEscopo.test.ts
git commit -m "refactor(api): a guarda do painel pergunta de qual parte se fala"
```

---

# Tarefa 2: a aderência à dieta, do lado do profissional

**Arquivos:**
- Modificar: `api/src/routes/pro.ts`
- Criar: `api/src/routes/proNutricao.test.ts`

**Interfaces consumidas:** `alunoDoProfissional` (Tarefa 1); `evolucaoDeNutricao(userId, dias)`
de `api/src/services/nutricao.ts`, que a frente 2 construiu.

**Contrato produzido:** `GET /pro/alunos/:id/nutricao?dias=30` →
`{ data: EvolucaoDeNutricao, meta: { dias } }`

- [ ] **Passo 1: escrever o teste que falha**

Criar `api/src/routes/proNutricao.test.ts`, copiando o preâmbulo de `proEscopo.test.ts`.

```ts
describe("GET /pro/alunos/:id/nutricao", () => {
  it("nutri com dieta aberta recebe a série", async () => {
    const r = await comoNutri.get(`/pro/alunos/${alunoId}/nutricao?dias=7`).expect(200);
    expect(r.body.data.dias).toHaveLength(7);
    expect(r.body.data.resumo.diasNaJanela).toBe(7);
  });

  it("dia sem registro chega null, e não zero — igual ao lado do aluno", async () => {
    const r = await comoNutri.get(`/pro/alunos/${alunoId}/nutricao?dias=7`).expect(200);
    expect(r.body.data.dias[0].kcal).toBeNull();
  });

  it("nutri SEM dieta aberta recebe 403 dizendo que é a dieta", async () => {
    const r = await comoNutriSemEscopo.get(`/pro/alunos/${alunoId}/nutricao`).expect(403);
    expect(r.body.error).toMatch(/dieta/i);
  });

  it("estranho recebe 404", async () => {
    await comoEstranho.get(`/pro/alunos/${alunoId}/nutricao`).expect(404);
  });

  it("A RESPOSTA É IDÊNTICA à que o próprio aluno recebe", async () => {
    // Regra do projeto: os dois lados chamam a MESMA função. Este teste é o que
    // quebra se alguém reimplementar o cálculo de um dos lados.
    const doAluno = await comoAluno.get("/nutrition/evolucao?dias=30").expect(200);
    const doPro = await comoNutri.get(`/pro/alunos/${alunoId}/nutricao?dias=30`).expect(200);
    expect(doPro.body.data).toEqual(doAluno.body.data);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/routes/proNutricao.test.ts`
Esperado: FALHA — 404, a rota não existe.

- [ ] **Passo 3: implementar**

Em `api/src/routes/pro.ts`, junto das outras rotas de leitura do aluno, e acrescentando
`import { evolucaoDeNutricao } from "../services/nutricao.js";` aos imports:

```ts
/**
 * A aderência à dieta do aluno, ao longo do tempo.
 *
 * Mesma função que responde ao próprio dono em `/nutrition/evolucao` — o
 * profissional vê o mesmo número que o aluno vê, e não uma segunda versão do
 * cálculo que poderia discordar dele na frente dos dois.
 *
 * Sem gate de plano, como as demais rotas do painel: o profissional não paga a
 * janela do aluno.
 */
proRouter.get(
  "/alunos/:id/nutricao",
  requirePro("coach", "nutri"),
  leituraDoAluno,
  asyncHandler(async (req, res) => {
    const { clientId } = await alunoDoProfissional(req, String(req.params.id), {
      parte: "dieta",
      preferido: "nutri",
    });
    const dias = janelaDoAluno.parse(req.query.dias);
    const data = await evolucaoDeNutricao(clientId, dias);
    res.json({ data, meta: { dias } });
  })
);
```

**Atenção ao `janelaDoAluno`:** ele aceita `0` como "tudo", e `evolucaoDeNutricao` devolve um
item por dia. Se `dias` for `0`, use `365` — um corpo de milhares de itens para desenhar um
gráfico que cabe numa tela não serve a ninguém. Escreva isso explicitamente:

```ts
const pedidos = janelaDoAluno.parse(req.query.dias);
const dias = pedidos === 0 ? 365 : pedidos;
```

E ajuste o teste da resposta idêntica para pedir a mesma janela dos dois lados.

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd api && npx vitest run src/routes/proNutricao.test.ts`
Esperado: PASSA (5 testes).

- [ ] **Passo 5: commit**

```bash
git add api/src/routes/pro.ts api/src/routes/proNutricao.test.ts
git commit -m "feat(api): o profissional ve a aderencia a dieta do aluno"
```

---

# Tarefa 3: a dieta corrente, e quem a escreveu

**Arquivos:**
- Modificar: `api/src/routes/pro.ts`
- Modificar: `api/src/routes/proNutricao.test.ts`

**Contrato produzido:** `GET /pro/alunos/:id/dieta` →
`{ data: { diet: DietData | null, version: number | null, createdBy: string | null, em: string | null }, meta: {} }`

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar a `proNutricao.test.ts`:

```ts
describe("GET /pro/alunos/:id/dieta", () => {
  it("devolve a dieta corrente e diz quem escreveu", async () => {
    await Plan.create({
      user: new mongoose.Types.ObjectId(alunoId), version: 1, summary: "plano",
      workout: null, disclaimer: "aviso", createdBy: nutriId,
      diet: { dailyCalories: 2000, macros: { proteinG: 150, carbsG: 200, fatG: 60 },
              meals: [{ name: "Café", timeHint: "", items: [{ food: "Ovos", quantity: "2" }] }], notes: "" },
    });

    const r = await comoNutri.get(`/pro/alunos/${alunoId}/dieta`).expect(200);

    expect(r.body.data.diet.dailyCalories).toBe(2000);
    expect(r.body.data.version).toBe(1);
    // Saber de quem é a dieta que está na tela: minha, de outro profissional,
    // ou da IA de antes de eu chegar.
    expect(r.body.data.createdBy).toBe(nutriId.toString());
  });

  it("aluno sem dieta devolve null, não 404", async () => {
    // 404 diria "aluno não encontrado". Aqui o aluno existe e não tem dieta.
    const r = await comoNutri.get(`/pro/alunos/${alunoSemDietaId}/dieta`).expect(200);
    expect(r.body.data.diet).toBeNull();
    expect(r.body.data.createdBy).toBeNull();
  });

  it("sem dieta aberta é 403", async () => {
    await comoNutriSemEscopo.get(`/pro/alunos/${alunoId}/dieta`).expect(403);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/routes/proNutricao.test.ts`
Esperado: FALHA — 404 nos três.

- [ ] **Passo 3: implementar**

```ts
/** A dieta que está valendo, e de quem ela é. */
proRouter.get(
  "/alunos/:id/dieta",
  requirePro("coach", "nutri"),
  leituraDoAluno,
  asyncHandler(async (req, res) => {
    const { clientId } = await alunoDoProfissional(req, String(req.params.id), {
      parte: "dieta",
      preferido: "nutri",
    });

    const plan = await Plan.findOne({ user: clientId }).sort({ version: -1 });

    res.json({
      data: {
        diet: (plan?.diet as unknown) ?? null,
        version: plan?.version ?? null,
        // `createdBy` null é "foi a IA, ou o próprio aluno" — é o que distingue
        // uma prescrição de um plano auto-atribuído.
        createdBy: plan?.createdBy?.toString() ?? null,
        em: plan?.createdAt?.toISOString() ?? null,
      },
      meta: {},
    });
  })
);
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd api && npx vitest run src/routes/proNutricao.test.ts`
Esperado: PASSA (8 testes no arquivo).

- [ ] **Passo 5: commit**

```bash
git add api/src/routes/pro.ts api/src/routes/proNutricao.test.ts
git commit -m "feat(api): a dieta corrente do aluno, com o autor dela"
```

---

# Tarefa 4: o nutricionista prescreve

Espelho do `PUT /pro/alunos/:id/treino` (`api/src/routes/pro.ts:820`). **Abra aquela rota e leia
antes de escrever esta** — a forma é a mesma, e os comentários dela explicam por quê.

**Arquivos:**
- Modificar: `api/src/routes/pro.ts`
- Modificar: `api/src/routes/proNutricao.test.ts`

**Contrato produzido:** `PUT /pro/alunos/:id/dieta` →
`201 { data: { id, version, createdBy, mensagem }, meta: {} }`

- [ ] **Passo 1: escrever o teste que falha**

```ts
describe("PUT /pro/alunos/:id/dieta", () => {
  const dieta = {
    dailyCalories: 1800,
    macros: { proteinG: 140, carbsG: 180, fatG: 50 },
    meals: [{ name: "Almoço", timeHint: "12h", items: [{ food: "Frango", quantity: "150g" }] }],
    notes: "",
  };

  it("cria VERSÃO NOVA e preserva o treino e a agenda", async () => {
    // A versão não é estética: o progresso de nutrição usa a versão do Plan para
    // saber qual meta valia em cada dia. Editar no lugar apagaria o histórico
    // de meta exatamente no caso em que ele mais importa.
    const antes = await Plan.findOne({ user: alunoObjId }).sort({ version: -1 });

    const r = await comoNutri
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "Ajustei para o seu volume de treino", diet: dieta })
      .expect(201);

    expect(r.body.data.version).toBe((antes?.version ?? 0) + 1);

    const depois = await Plan.findOne({ user: alunoObjId }).sort({ version: -1 });
    expect((depois!.diet as { dailyCalories: number }).dailyCalories).toBe(1800);
    // O treino é metade independente do plano. Prescrever comida não é motivo
    // para apagar treino — nem a agenda de dias que o aluno montou.
    expect(depois!.workout).toEqual(antes!.workout);
  });

  it("avisa o aluno pela conversa que já existe", async () => {
    await comoNutri
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "Ajustei a dieta", diet: dieta, recado: "Bebe mais água." })
      .expect(201);

    const msgs = await ProMessage.find({ link: linkNutriId }).sort({ createdAt: -1 });
    expect(msgs[0]!.texto).toMatch(/1800 kcal/);
    expect(msgs[0]!.texto).toMatch(/Bebe mais água/);
  });

  it("coach NÃO prescreve dieta", async () => {
    // Quem responde pela comida é o nutricionista, mesmo que a pessoa também
    // seja coach de alguém.
    await comoCoach
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "x", diet: dieta })
      .expect(403);
  });

  it("dieta inválida é recusada ANTES de gravar qualquer coisa", async () => {
    const antes = await Plan.countDocuments({ user: alunoObjId });
    await comoNutri
      .put(`/pro/alunos/${alunoId}/dieta`)
      .send({ summary: "x", diet: { ...dieta, dailyCalories: 10 } })
      .expect(400);
    expect(await Plan.countDocuments({ user: alunoObjId })).toBe(antes);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/routes/proNutricao.test.ts`
Esperado: FALHA — 404.

- [ ] **Passo 3: implementar**

Acrescentar, junto do `mensagemDaPrescricao` que já existe:

```ts
const prescricaoDeDietaSchema = z.object({
  summary: z.string().min(1).max(500),
  diet: dietSchema,
  /** O que o nutricionista quer dizer junto. Opcional: o aviso sai de qualquer jeito. */
  recado: z.string().max(1000).optional(),
});

/** O aviso que o aluno recebe quando a dieta muda. Mesma forma do treino. */
function mensagemDaDieta(
  diet: { dailyCalories?: number; meals?: { name: string }[] },
  summary: string,
  recado?: string
): string {
  const forma = [
    diet.dailyCalories ? `${diet.dailyCalories} kcal por dia` : "",
    diet.meals?.length ? `${diet.meals.length} refeições` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const linhas = [forma ? `Atualizei sua dieta: ${forma}.` : "Atualizei sua dieta.", summary.trim()];
  if (recado?.trim()) linhas.push(recado.trim());
  return linhas.filter(Boolean).join("\n\n");
}
```

E a rota, espelhando a de treino ponto a ponto:

```ts
/**
 * O nutricionista prescreve a dieta do aluno.
 *
 * Grava uma VERSÃO NOVA em vez de editar a atual, e aqui isso é requisito de
 * outra feature: o progresso de nutrição resolve o alvo de cada dia pela versão
 * do `Plan` ativa naquela data. Editar no lugar faria a meta de hoje ser
 * aplicada retroativamente a dias que foram vividos com outra.
 *
 * Não toca no treino: ele é metade independente do plano, e prescrever comida
 * não é motivo para apagar treino nem a agenda de dias que o aluno montou.
 */
proRouter.put(
  "/alunos/:id/dieta",
  requirePro("nutri"),
  asyncHandler(async (req, res) => {
    const { link, clientId } = await alunoDoProfissional(req, String(req.params.id), {
      parte: "dieta",
      preferido: "nutri",
    });
    if (link.papel !== "nutri") throw new HttpError(403, "Só o nutricionista prescreve dieta.");

    const { summary, diet, recado } = prescricaoDeDietaSchema.parse(req.body);

    // Montado e cortado ANTES de gravar: `texto` tem teto de 2000 no modelo, e
    // estourar a validação DEPOIS do plano existir faria o aluno receber dieta
    // nova sem aviso nenhum.
    const textoDoAviso = mensagemDaDieta(diet, summary, recado).slice(0, 2000);

    const atual = await Plan.findOne({ user: clientId }).sort({ version: -1 });
    const plan = await Plan.create({
      user: clientId,
      version: (atual?.version ?? 0) + 1,
      summary,
      workout: atual?.workout ?? null,
      diet,
      disclaimer: atual?.disclaimer ?? DISCLAIMER_DO_COACH,
      createdBy: req.user!._id,
    });

    const aviso = await ProMessage.create({
      link: link._id,
      autor: req.user!._id,
      texto: textoDoAviso,
      plan: plan._id,
    });

    void enviarPush(clientId, "mensagem_pro", {
      title: req.user!.name,
      body: "Atualizou a sua dieta",
      data: { tipo: "mensagem_pro", link: link._id.toString() },
    });

    res.status(201).json({
      data: {
        id: plan._id.toString(),
        version: plan.version,
        createdBy: req.user!._id.toString(),
        mensagem: aviso._id.toString(),
      },
      meta: {},
    });
  })
);
```

`dietSchema` já é exportado de `api/src/models/Plan.ts` — acrescente ao import existente.

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd api && npx vitest run; echo "saida=$?"; npx tsc --noEmit`
Esperado: `saida=0`, typecheck limpo.

- [ ] **Passo 5: commit**

```bash
git add api/src/routes/pro.ts api/src/routes/proNutricao.test.ts
git commit -m "feat(api): o nutricionista prescreve a dieta, criando versao"
```

---

# Tarefa 5: a trava de autoria da dieta

Espelho de `recusarSeTemTreinador` (`api/src/routes/plans.ts:140`). **Leia aquela função e o
comentário acima dela antes de escrever esta** — o racional é o mesmo, e está escrito lá.

Hoje a dieta está deliberadamente fora da trava, com este comentário em `plans.ts`: *"A dieta
não entra aqui: quem responde por ela é o nutricionista, e o vínculo dele é outro."* Agora o
vínculo dele existe de verdade.

**Arquivos:**
- Modificar: `api/src/routes/plans.ts`
- Modificar: `api/src/services/ai/coach.ts`
- Criar: `api/src/routes/travaDaDieta.test.ts`

- [ ] **Passo 1: escrever o teste que falha**

```ts
describe("Quem tem nutricionista não recebe dieta da IA", () => {
  it("POST /plans/diet recusa com 409 e manda falar com o profissional", async () => {
    const r = await comoAlunoComNutri.post("/plans/diet").send({}).expect(409);
    expect(r.body.error).toMatch(/nutricionista/i);
    expect(r.body.error).toMatch(/acompanhamento/i);
  });

  it("PUT /plans/current com dieta recusa", async () => {
    await comoAlunoComNutri.put("/plans/current").send({ diet: dietaValida }).expect(409);
  });

  it("PUT /plans/current só com treino CONTINUA passando", async () => {
    // A trava é sobre comida. Quem tem nutricionista e não tem treinador
    // continua dono do próprio treino.
    await comoAlunoComNutri.put("/plans/current").send({ workout: treinoValido }).expect(200);
  });

  it("aluno SEM nutricionista continua gerando dieta", async () => {
    await comoAlunoSozinho.post("/plans/diet").send({}).expect(201);
  });

  it("apagar a dieta é permitido quando ela NÃO tem autor", async () => {
    // Dieta feita pela IA pode ser zerada, senão quem tinha dieta antiga e
    // contratou nutricionista ficaria preso a ela.
    await comoAlunoComNutri.delete("/plans/current/diet").expect(200);
  });

  it("apagar a dieta é recusado quando ela foi prescrita", async () => {
    await Plan.updateOne({ user: alunoComNutriId }, { $set: { createdBy: nutriId } });
    await comoAlunoComNutri.delete("/plans/current/diet").expect(409);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/routes/travaDaDieta.test.ts`
Esperado: FALHA — as rotas hoje respondem 200/201.

- [ ] **Passo 3: implementar**

Em `api/src/routes/plans.ts`, junto de `recusarSeTemTreinador`:

```ts
/**
 * Quem tem nutricionista não recebe dieta da IA.
 *
 * Mesma regra e mesmo motivo do treino, e agora ela cabe: até esta frente o
 * vínculo de nutricionista não tinha função nenhuma, e por isso a dieta ficava
 * de fora. Uma dieta que troca sozinha é a pessoa descobrir de manhã que está
 * comendo outra coisa — e o nutricionista respondendo por números que ele nunca
 * escreveu.
 */
async function recusarSeTemNutricionista(userId: mongoose.Types.ObjectId): Promise<void> {
  if (await temProfissional(userId, "nutri")) {
    throw new HttpError(
      409,
      "Quem escreve a sua dieta é o seu nutricionista. Fale com ele pelo acompanhamento para mudar o plano."
    );
  }
}

/** A dieta corrente é de um profissional? Então ela não se apaga sozinha. */
async function recusarSeForDoNutricionista(userId: mongoose.Types.ObjectId): Promise<void> {
  const atual = await Plan.findOne({ user: userId }).sort({ version: -1 });
  if (atual?.createdBy) await recusarSeTemNutricionista(userId);
}
```

Aplicar em quatro pontos:

| Onde | O que acrescentar |
|---|---|
| `POST /plans/diet` (linha ~619, logo após o `requireAuth` do handler) | `await recusarSeTemNutricionista(req.user!._id);` |
| `PUT /plans/current` (linha ~317, junto da linha do treino) | `if (body.diet !== undefined) await recusarSeTemNutricionista(req.user!._id);` |
| `DELETE /plans/current` (linha ~679) | `await recusarSeForDoNutricionista(req.user!._id);` junto do que já existe |
| `DELETE /plans/current/:parte` (linha ~698) | `if (parte === "diet") await recusarSeForDoNutricionista(req.user!._id);` |

- [ ] **Passo 4: o chat do coach IA também respeita**

Em `api/src/routes/coach.ts` (a rota que consome `runCoachTurn`), onde hoje a `action`
`"adjust_diet"` dispara o ajuste, envolver com a mesma checagem: se
`temProfissional(userId, "nutri")`, não ajuste — devolva a resposta de texto do coach e
acrescente uma frase dizendo para falar com o nutricionista.

**Não** faça a trava dentro de `services/ai/coach.ts`: a camada de IA não conhece Mongo, e o
`CLAUDE.md` do projeto manda manter IA só dentro de `services/ai/`. A decisão é da rota.

- [ ] **Passo 5: `GET /plans/hoje` avisa o app**

Na linha ~402, ao lado de `podeEditarPlano`, acrescentar:

```ts
podeEditarDieta: !(await temProfissional(req.user!._id, "nutri")),
```

É aditivo: o APK instalado ignora o campo, e o app novo desabilita o botão em vez de deixar a
pessoa tentar e levar 409.

- [ ] **Passo 6: rodar e ver passar**

Rodar: `cd api && npx vitest run; echo "saida=$?"; npx tsc --noEmit`
Esperado: `saida=0`, typecheck limpo, e **os testes de plano que já existem continuam
passando**.

- [ ] **Passo 7: commit**

```bash
git add api/src/routes/plans.ts api/src/routes/coach.ts api/src/routes/travaDaDieta.test.ts
git commit -m "feat(api): quem tem nutricionista nao recebe dieta da IA"
```

---

# Tarefa 6: o cliente do painel

**Arquivos:**
- Modificar: `pro/src/api.ts`

> **Sem passo de teste: o painel `pro/` não tem runner.** A verificação é
> `cd pro && npx tsc --noEmit`, rodado **à mão** — o CI não checa `pro/`.

- [ ] **Passo 1: acrescentar tipos e funções**

Seguindo a forma das funções que já existem no arquivo (`buscarAluno`, `buscarCardio`):

```ts
export interface AlvoDiario {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Os totais são `null` no dia em que não houve registro — nunca zero. */
export interface DiaDeNutricao {
  dia: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  registros: number;
  alvo: AlvoDiario | null;
}

export interface EvolucaoDeNutricao {
  dias: DiaDeNutricao[];
  resumo: {
    diasComRegistro: number;
    diasNaJanela: number;
    mediaKcal: number | null;
    diasDentroDoAlvo: number;
  };
}

export interface ItemDaRefeicao { food: string; quantity: string }
export interface RefeicaoDaDieta { name: string; timeHint: string; items: ItemDaRefeicao[] }
export interface Dieta {
  dailyCalories: number;
  macros: { proteinG: number; carbsG: number; fatG: number };
  meals: RefeicaoDaDieta[];
  notes: string;
}

export const buscarNutricao = (token: string, id: string, dias = 30) =>
  api<{ data: EvolucaoDeNutricao; meta: { dias: number } }>(
    `/pro/alunos/${id}/nutricao?dias=${dias}`,
    { token }
  );

export const buscarDieta = (token: string, id: string) =>
  api<{ data: { diet: Dieta | null; version: number | null; createdBy: string | null; em: string | null } }>(
    `/pro/alunos/${id}/dieta`,
    { token }
  );

export const prescreverDieta = (
  token: string,
  id: string,
  corpo: { summary: string; diet: Dieta; recado?: string }
) =>
  api<{ data: { id: string; version: number } }>(`/pro/alunos/${id}/dieta`, {
    token,
    method: "PUT",
    body: corpo,
  });
```

O helper `api(caminho, { token, method?, body? })` já existe no arquivo (declarado por volta
da linha 57) e é o que `buscarAluno` usa. Não crie outro.

E, em `AlunoNaLista` e no tipo do perfil, confirme que `vinculo.papel` e `vinculo.escopo` já
existem (existem — linhas ~146 e ~175). Não redeclare.

- [ ] **Passo 2: typecheck**

Rodar: `cd pro && npx tsc --noEmit`
Esperado: limpo.

- [ ] **Passo 3: commit**

```bash
git add pro/src/api.ts
git commit -m "feat(pro): cliente das rotas de nutricao do painel"
```

---

# Tarefa 7: as abas saem do papel do vínculo

**Arquivos:**
- Modificar: `pro/src/pages/Aluno.tsx`

> Sem passo de teste: o painel não tem runner. Verificação é `npx tsc --noEmit` à mão.

- [ ] **Passo 1: as abas passam a ser derivadas**

Hoje `Aluno.tsx:44` tem `type Aba = "evolucao" | "treino" | "conversa"` e a nav em `:325-337` é
uma lista fixa. Passa a ser montada a partir de `perfil.vinculo.papel` e do escopo:

```tsx
type Aba = "evolucao" | "treino" | "nutricao" | "dieta" | "conversa";

/**
 * Que abas esta pessoa vê deste aluno.
 *
 * O papel do VÍNCULO decide, e não um seletor de modo: quem acompanha a mesma
 * pessoa como treinador e como nutricionista tem dois vínculos, e a lista de
 * alunos já sabe qual é qual. Pedir que ela lembre em que modo está seria
 * inventar um estado para ela errar.
 */
function abasDoVinculo(papel: "coach" | "nutri", escopo: Escopo): [Aba, string][] {
  const abas: [Aba, string][] = [];
  if (papel === "coach") {
    if (escopo.treinos) abas.push(["evolucao", "Evolução"]);
    abas.push(["treino", "Prescrever treino"]);
  }
  if (papel === "nutri") {
    if (escopo.dieta) abas.push(["nutricao", "Nutrição"], ["dieta", "Prescrever dieta"]);
  }
  abas.push(["conversa", "Conversa"]);
  return abas;
}
```

A aba inicial é a primeira da lista, e o `useState` inicial precisa esperar o perfil carregar —
hoje ele já é `useState<Aba>("evolucao")`. Troque para inicializar a partir das abas assim que
`perfil` existir, e garanta que uma aba não disponível nunca fique selecionada.

**Não altere nada dentro dos blocos `aba === "evolucao"`, `"treino"` e `"conversa"`** — eles são
o painel do coach que já está no ar.

- [ ] **Passo 2: os dois vínculos**

A Tarefa 1 fez a ficha devolver `vinculos` (array de todos os ativos) ao lado do `vinculo`
singular. **Monte as abas a partir do array**, unindo os papéis:

```tsx
const abas = perfil.vinculos.flatMap((v) => abasDoVinculo(v.papel, v.escopo));
// "Conversa" sai uma vez só, mesmo com dois vínculos.
const unicas = abas.filter(([id], i) => abas.findIndex(([x]) => x === id) === i);
```

Quem é coach e nutri do mesmo aluno vê `Evolução · Prescrever treino · Nutrição · Prescrever
dieta · Conversa`. Quem tem um papel só vê as do dele, como antes.

A `Conversa` usa `perfil.vinculo.id`, que continua existindo e continua sendo um vínculo
válido da dupla — a conversa é a mesma pessoa falando com a mesma pessoa.

- [ ] **Passo 3: typecheck**

Rodar: `cd pro && npx tsc --noEmit`
Esperado: limpo.

- [ ] **Passo 4: commit**

```bash
git add pro/src/pages/Aluno.tsx
git commit -m "feat(pro): as abas do aluno saem do papel do vinculo"
```

---

# Tarefa 8: a aba de nutrição

**Arquivos:**
- Criar: `pro/src/components/Nutricao.tsx`
- Modificar: `pro/src/pages/Aluno.tsx` (renderizar a aba)

**Interfaces consumidas:** `buscarNutricao` (Tarefa 6).

> Sem passo de teste: o painel não tem runner.

- [ ] **Passo 1: o componente**

Criar `pro/src/components/Nutricao.tsx`, seguindo a forma do `Grafico.tsx` que já existe
(recharts, carregado com `lazy` em `Aluno.tsx`).

Ordem dos blocos:

1. **Cabeçalho honesto** — a média por dia registrado **sempre ao lado** de
   `"{diasComRegistro} de {diasNaJanela} dias registrados"`, e `"{diasDentroDoAlvo} de {…}
   dias dentro da meta"`. A média nunca aparece sozinha: uma média de 12 dias apresentada como
   se fosse de 30 é a mentira que esta tela existe para evitar.
2. **Gráfico de kcal** — série de `dias.map(d => ({ dia: d.dia, kcal: d.kcal }))`, **sem
   filtrar os nulos**. O recharts desenha lacuna em `null` por padrão (`connectNulls` é
   `false`); **não** ligue `connectNulls`, porque ligar a linha por cima do buraco afirma um
   consumo que ninguém registrou.
3. **Estado vazio** — quando `resumo.diasComRegistro === 0`, um texto dizendo que o aluno ainda
   não registrou nada nesta janela. Sem isso o gráfico fica em branco e parece defeito.
4. **Chips de janela** — 7 · 30 · 90 dias, recarregando.

**Nenhum texto pode julgar o aluno.** O guardrail do projeto (`docs/VISAO.md`) proíbe punir quem
saiu da dieta, e vale igual do lado do profissional: o painel descreve o que houve, não acusa.

- [ ] **Passo 2: ligar em `Aluno.tsx`**

```tsx
{aba === "nutricao" && (
  <div className="painel">
    <Nutricao token={token} alunoId={perfil.aluno.id} />
  </div>
)}
```

- [ ] **Passo 3: typecheck**

Rodar: `cd pro && npx tsc --noEmit`

- [ ] **Passo 4: commit**

```bash
git add pro/src/components/Nutricao.tsx pro/src/pages/Aluno.tsx
git commit -m "feat(pro): a aba de nutricao, com o buraco dos dias sem registro"
```

---

# Tarefa 9: o formulário de prescrição

**Arquivos:**
- Criar: `pro/src/components/PrescreverDieta.tsx`
- Modificar: `pro/src/pages/Aluno.tsx`

**Interfaces consumidas:** `buscarDieta`, `prescreverDieta` (Tarefa 6).

> Sem passo de teste: o painel não tem runner.

- [ ] **Passo 1: o componente**

Criar `pro/src/components/PrescreverDieta.tsx`, seguindo a forma de
`pro/src/components/Prescrever.tsx` (o de treino) — **abra-o antes de escrever**.

O formulário cobre exatamente o `dietSchema`:

- calorias diárias (número, 800 a 6000 — os limites do schema);
- macros: proteína, carbo e gordura em gramas;
- refeições: nome, horário sugerido, e itens com alimento e quantidade (quantidade é **texto
  livre**: "100g", "1 unidade" — o schema é assim);
- um `summary` obrigatório (até 500 caracteres) e um `recado` opcional (até 1000).

Ao abrir, carrega a dieta corrente com `buscarDieta` e **pré-preenche o formulário com ela**:
prescrever quase sempre é ajustar a anterior, e obrigar a redigitar cinco refeições é o caminho
mais curto para o nutricionista não usar o painel. Mostre também quem escreveu a dieta que está
ali (`createdBy` e `em`), para ele saber se está ajustando a própria ou a de outro.

Ao salvar, chama `prescreverDieta` e depois recarrega a ficha (a mesma prop `aoSalvar` que o
`Prescrever` de treino já recebe).

- [ ] **Passo 2: ligar em `Aluno.tsx`**

```tsx
{aba === "dieta" && (
  <div className="painel">
    <PrescreverDieta token={token} alunoId={perfil.aluno.id} aoSalvar={carregar} />
  </div>
)}
```

- [ ] **Passo 3: typecheck**

Rodar: `cd pro && npx tsc --noEmit`

- [ ] **Passo 4: commit**

```bash
git add pro/src/components/PrescreverDieta.tsx pro/src/pages/Aluno.tsx
git commit -m "feat(pro): o formulario de prescricao de dieta"
```

---

# Tarefa 10: a triagem do nutricionista

**Arquivos:**
- Modificar: `pro/src/pages/Alunos.tsx`
- Modificar: `api/src/routes/pro.ts` (`GET /pro/alunos`)
- Modificar: `api/src/routes/proNutricao.test.ts`

Hoje `Alunos.tsx:17` tem `situacao()`, que classifica pelo último treino: `sumido` (≥7 dias),
`atencao` (≥4), `ok`. Para o nutricionista o sinal não é "sumiu do treino" — é **"parou de
registrar comida"**.

- [ ] **Passo 1: escrever o teste que falha**

Em `proNutricao.test.ts`:

```ts
it("a lista do nutri traz dias sem registro de comida, e a do coach não muda", async () => {
  const doNutri = await comoNutri.get("/pro/alunos?papel=nutri").expect(200);
  // Para o nutri, "precisa de mim" é ter parado de registrar comida.
  expect(doNutri.body.data[0].nutricao).toEqual(
    expect.objectContaining({ ultimoRegistroEm: expect.anything() })
  );

  const doCoach = await comoCoach.get("/pro/alunos?papel=coach").expect(200);
  // O lado do coach segue idêntico: o painel dele está no ar.
  expect(doCoach.body.data[0].treinos).toBeDefined();
  expect(doCoach.body.data[0].nutricao).toBeUndefined();
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/routes/proNutricao.test.ts`

- [ ] **Passo 3: implementar no backend**

Em `GET /pro/alunos` (linha ~186), onde hoje o bloco `treinos: { ultimoEm, naSemana }` é
montado **só quando `escopo.treinos`**, acrescentar o irmão: quando `link.papel === "nutri"` e
`escopo.dieta`, incluir `nutricao: { ultimoRegistroEm, diasComRegistroNaSemana }`, lendo o
`FoodLog` do aluno. Mantenha a simetria: bloco ausente quando o escopo não abre.

- [ ] **Passo 4: implementar no painel**

Em `Alunos.tsx`, `situacao()` passa a olhar `nutricao.ultimoRegistroEm` quando o vínculo é de
nutri, e `treinos.ultimoEm` quando é de coach. Os mesmos limiares (≥7 sumido, ≥4 atenção).

- [ ] **Passo 5: verificar**

Rodar: `cd api && npx vitest run; echo "saida=$?"; npx tsc --noEmit`
Rodar: `cd pro && npx tsc --noEmit`

- [ ] **Passo 6: commit**

```bash
git add api/src/routes/pro.ts pro/src/pages/Alunos.tsx api/src/routes/proNutricao.test.ts
git commit -m "feat: para o nutri, quem precisa dele e quem parou de registrar"
```

---

# Tarefa 11: revisão e entrega

- [ ] **Passo 1: tudo, com o código de saída**

```bash
cd api && npx vitest run; echo "saida=$?"; npx tsc --noEmit
cd ../pro && npx tsc --noEmit
cd ../app-android && npx tsc --noEmit && npm run checar-cores
```

`saida=0` e todos limpos. Se o vitest disser `Errors: N` com todos os testes verdes, há promise
solta — não ignore, é isso que derruba o deploy.

**O `checar-cores` exige Node 22.** Se a sua máquina tiver Node 20, ele falha com
`node: bad option` — isso é ambiente, não código.

- [ ] **Passo 2: revisores do projeto, em paralelo, no diff pronto**

O `CLAUDE.md` exige. `fitsocial-compatibilidade` é **obrigatório** (mexe em guarda de
permissão, em contrato de rota e em regra de plano), mais `fitsocial-backend`. Dê a eles o
contexto do que a mudança tenta resolver, não só "revise". Confira cada achado antes de aplicar.

- [ ] **Passo 3: merge**

Merge na `main` dispara o deploy pelo GitHub Actions. Confirme pelo campo `commit` do
deployment — `/health` responde 200 mesmo com build quebrado.

**Atenção:** o workflow **não tem portão para `pro/`** — ele deploya o painel sem checar nada.
Rode o `npx tsc --noEmit` de `pro/` à mão antes do merge, porque ninguém vai rodar por você.

---

# Fora deste plano

- **Peso, medidas e fotos de progresso** — é o que dá conteúdo a `escopo.medidas` e
  `escopo.fotos`, hoje vazios.
- **Colar a dieta e a IA estruturar** — e só com revisão obrigatória antes de salvar.
- **O diário dia a dia do aluno** — dado íntimo em volume, merece decisão própria.
- **Chat entre coach e nutri do mesmo aluno** — frente 4 do épico Pro.
- **`POST /plans/diet` não criar versão** — decisão de produto pendente. Esta frente não
  depende dela: a prescrição do nutri cria versão por conta própria.
- **O painel `pro/` não ter portão de CI** — achado real, tarefa própria.
