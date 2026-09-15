# Progresso de nutrição — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** mostrar a aderência da pessoa à dieta ao longo do tempo, com o dia sem
registro aparecendo como buraco honesto em vez de zero ou de omissão.

**Arquitetura:** espelha `services/evolucao.ts` — agregação no Mongo, janela obrigatória,
gate de plano que corta em vez de recusar, rota fina que delega ao service. Nenhuma coleção
nova: tudo sai do `FoodLog` que já existe. O painel do nutricionista (frente 3) vai chamar
as mesmas funções.

**Stack:** Node 20 · Express · TypeScript strict · Mongoose · zod · vitest ·
Expo/React Native.

**Spec:** [`docs/superpowers/specs/2026-09-15-progresso-nutricao-design.md`](../specs/2026-09-15-progresso-nutricao-design.md)

## Restrições globais

- **Envelope `{ data, meta }`** em rota nova. O `meta` de janela segue o formato que já
  existe: `{ dias, diasPedidos?, limitadoPor: "plano" }`. *(A spec dizia
  `limitadoPeloPlano` — estava errada; vale o formato real do `routes/evolucao.ts`.)*
- **Macros em inglês:** `proteinG`, `carbsG`, `fatG`. É o que `FoodLog` e
  `GET /nutrition/day` já falam.
- **Dia sem registro é `null`, nunca `0`.** Em toda camada: agregação, contrato e gráfico.
- **Fuso:** `America/Sao_Paulo`, sempre via `utils/dia.ts`. Nunca aritmética de −3.
- **zod na borda**, antes da regra. Rota não contém regra de negócio.
- **Teste de integração com Mongo em memória para todo endpoint novo.**
- **O app NÃO tem runner de teste.** Só `npx tsc --noEmit` e `npm run checar-cores`. As
  tarefas de app não têm passo de teste automatizado — não invente um.
- **Nada de regressão no `DiarioScreen`:** ele grava em qualquer data passada hoje, e
  continua gravando. Nenhuma trava nova no servidor.
- Commits em Conventional Commits, em português.

---

# Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `api/src/services/janela.ts` | **Criar.** Gate de plano da janela, extraído de `routes/evolucao.ts` para ser compartilhado |
| `api/src/services/nutricao.ts` | **Criar.** Agregação do `FoodLog` por dia e resolução do alvo por dia |
| `api/src/services/nutricao.test.ts` | **Criar.** Unitários da resolução de alvo |
| `api/src/models/FoodLog.ts` | **Modificar.** Índice composto `{ user, date }` |
| `api/src/routes/nutrition.ts` | **Modificar.** Rota `GET /evolucao` |
| `api/src/routes/nutricaoEvolucao.test.ts` | **Criar.** Integração da rota |
| `api/src/routes/evolucao.ts` | **Modificar.** Passa a importar o gate em vez de declará-lo |
| `app-android/src/api/nutricao.ts` | **Criar.** Cliente e tipos |
| `app-android/src/components/LineChart.tsx` | **Modificar.** Aceita `value: null` e quebra a linha |
| `app-android/src/screens/NutricaoProgressoScreen.tsx` | **Criar.** A tela |
| `app-android/src/screens/ProgressoScreen.tsx` | **Modificar.** Nível `Treino · Nutrição` |
| `app-android/src/components/QuickFoodAdd.tsx` | **Modificar.** Aceita data |

---

# Tarefa 1: extrair o gate de janela

Hoje `janelaPermitida` e `metaDaJanela` são funções privadas de `routes/evolucao.ts`.
Nutrição precisa das duas. Copiar seria duas regras de freemium divergindo em silêncio.

**Arquivos:**
- Criar: `api/src/services/janela.ts`
- Criar: `api/src/services/janela.test.ts`
- Modificar: `api/src/routes/evolucao.ts` (remover as locais, importar as novas)

**Interfaces produzidas:**
```ts
export const JANELA_DO_GRATIS = 7;
export function janelaPermitida(user: UserDoc, pedidos: number): number;
export function metaDaJanela(pedidos: number, dias: number):
  { dias: number; diasPedidos?: number; limitadoPor?: "plano" };
```

- [ ] **Passo 1: escrever o teste que falha**

Criar `api/src/services/janela.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { janelaPermitida, metaDaJanela, JANELA_DO_GRATIS } from "./janela.js";
import type { UserDoc } from "../models/User.js";

// `calcularPlan` le `user.email` (via isFounder) antes de olhar o plano: sem
// email o teste estoura com "Cannot read properties of undefined". Verificado
// rodando o entitlement de verdade, nao deduzido.
const comPlano = (plan: string) =>
  ({ plan, tier: "premium", email: "quem@paga.com" }) as unknown as UserDoc;
const gratis = () => ({ plan: "free", tier: "free", email: "gratis@teste.com" }) as unknown as UserDoc;

describe("Até onde o plano deixa enxergar", () => {
  it("quem paga pede o que quiser", () => {
    expect(janelaPermitida(comPlano("pro"), 365)).toBe(365);
  });

  it("o grátis é cortado, não recusado", () => {
    expect(janelaPermitida(gratis(), 90)).toBe(JANELA_DO_GRATIS);
  });

  it("zero significa tudo, e é o caso que mais precisa de corte", () => {
    expect(janelaPermitida(gratis(), 0)).toBe(JANELA_DO_GRATIS);
  });

  it("o meta só fala em corte quando houve corte", () => {
    expect(metaDaJanela(30, 30)).toEqual({ dias: 30 });
    expect(metaDaJanela(90, 7)).toEqual({ dias: 7, diasPedidos: 90, limitadoPor: "plano" });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/services/janela.test.ts`
Esperado: FALHA com "Cannot find module './janela.js'".

- [ ] **Passo 3: criar o service**

Criar `api/src/services/janela.ts` movendo o corpo das funções de
`routes/evolucao.ts` **sem alterar a lógica**, junto com os comentários que explicam por que
corta em vez de recusar:

```ts
import { calcularPlan } from "./entitlement.js";
import type { UserDoc } from "../models/User.js";

/**
 * Até onde o plano grátis enxerga o próprio passado.
 *
 * Uma semana é o bastante para responder "como foi a semana" — que é o que faz
 * a pessoa voltar amanhã — e curta o bastante para a falta doer em quem já tem
 * histórico.
 */
export const JANELA_DO_GRATIS = 7;

/**
 * A janela que esta pessoa pode pedir, cortada se for o caso.
 *
 * CORTA, e não recusa. Um 402 faria o aplicativo instalado navegar para a tela
 * de assinatura a partir de um gráfico que nunca foi ligado a isso. Cortado, o
 * cliente velho mostra sete dias e o novo lê `meta.limitadoPor`.
 */
export function janelaPermitida(user: UserDoc, pedidos: number): number {
  if (calcularPlan(user) !== "free") return pedidos;
  if (pedidos === 0) return JANELA_DO_GRATIS;
  return Math.min(pedidos, JANELA_DO_GRATIS);
}

/** O `meta` das rotas de janela, dizendo se cortou e por quê. */
export function metaDaJanela(pedidos: number, dias: number) {
  return {
    dias,
    ...(dias !== pedidos ? { diasPedidos: pedidos, limitadoPor: "plano" as const } : {}),
  };
}
```

- [ ] **Passo 4: apontar `routes/evolucao.ts` para o novo service**

Em `api/src/routes/evolucao.ts`: apagar as declarações locais de `JANELA_DO_GRATIS`,
`janelaPermitida` e `metaDaJanela`, e acrescentar aos imports:

```ts
import { janelaPermitida, metaDaJanela } from "../services/janela.js";
```

Remover também o import de `calcularPlan` e o de `UserDoc` **se ficarem sem uso** (o
typecheck acusa).

- [ ] **Passo 5: rodar tudo**

Rodar: `cd api && npx vitest run && npx tsc --noEmit`
Esperado: PASSA, incluindo os testes de `evolucao` que já existiam. Se algum deles quebrar,
a extração alterou comportamento — reverta e refaça movendo o corpo literalmente.

- [ ] **Passo 6: commit**

```bash
git add api/src/services/janela.ts api/src/services/janela.test.ts api/src/routes/evolucao.ts
git commit -m "refactor: o gate de janela vira service, para nutricao usar o mesmo"
```

---

# Tarefa 2: o alvo que valia em cada dia

A parte mais sutil. Sem isso, o nutricionista apertar a meta hoje pinta o passado de
vermelho.

**Arquivos:**
- Criar: `api/src/services/nutricao.ts`
- Criar: `api/src/services/nutricao.test.ts`

**Interfaces produzidas:**
```ts
export interface AlvoDiario { kcal: number; proteinG: number; carbsG: number; fatG: number }
export async function alvosPorDia(
  userId: mongoose.Types.ObjectId,
  dias: string[]
): Promise<Map<string, AlvoDiario | null>>;
```

- [ ] **Passo 1: escrever o teste que falha**

Criar `api/src/services/nutricao.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Plan } from "../models/Plan.js";
import { alvosPorDia } from "./nutricao.js";

let mongod: MongoMemoryServer;
const user = new mongoose.Types.ObjectId();

const dieta = (kcal: number) => ({
  dailyCalories: kcal,
  macros: { proteinG: 150, carbsG: 200, fatG: 60 },
  meals: [{ name: "Café", timeHint: "", items: [{ food: "Ovos", quantity: "2" }] }],
  notes: "",
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Plan.deleteMany({});
});

describe("O alvo que valia em cada dia", () => {
  it("dia anterior a qualquer dieta nao tem alvo", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: new Date("2026-09-10T12:00:00Z"),
    });

    const alvos = await alvosPorDia(user, ["2026-09-08", "2026-09-11"]);

    expect(alvos.get("2026-09-08")).toBeNull();
    expect(alvos.get("2026-09-11")?.kcal).toBe(2000);
  });

  it("meta que mudou no meio da janela nao reescreve o passado", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    await Plan.create({
      user, version: 2, summary: "plano", workout: null, diet: dieta(1700),
      disclaimer: "aviso", createdAt: new Date("2026-09-10T12:00:00Z"),
    });

    const alvos = await alvosPorDia(user, ["2026-09-05", "2026-09-10", "2026-09-12"]);

    // O dia 5 foi vivido com meta de 2000: julgá-lo por 1700 seria inventar uma
    // falha que nao aconteceu.
    expect(alvos.get("2026-09-05")?.kcal).toBe(2000);
    expect(alvos.get("2026-09-10")?.kcal).toBe(1700);
    expect(alvos.get("2026-09-12")?.kcal).toBe(1700);
  });

  it("plano sem dieta nao conta como troca de alvo", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    // Prescricao de treino: cria versao nova e PRESERVA a dieta (routes/pro.ts).
    await Plan.create({
      user, version: 2, summary: "plano", workout: { split: "AB", daysPerWeek: 2, sessions: [] },
      diet: null, disclaimer: "aviso", createdAt: new Date("2026-09-05T12:00:00Z"),
    });

    expect((await alvosPorDia(user, ["2026-09-07"])).get("2026-09-07")?.kcal).toBe(2000);
  });

  it("nao enxerga a dieta de outra pessoa", async () => {
    await Plan.create({
      user: new mongoose.Types.ObjectId(), version: 1, summary: "plano", workout: null,
      diet: dieta(3000), disclaimer: "aviso", createdAt: new Date("2026-09-01T12:00:00Z"),
    });

    expect((await alvosPorDia(user, ["2026-09-07"])).get("2026-09-07")).toBeNull();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/services/nutricao.test.ts`
Esperado: FALHA com "Cannot find module './nutricao.js'".

- [ ] **Passo 3: implementar**

Criar `api/src/services/nutricao.ts`:

```ts
import mongoose from "mongoose";
import { Plan } from "../models/Plan.js";
import { chaveDoDia } from "../utils/dia.js";

/** A meta de um dia. Macros em inglês, como o resto do domínio de nutrição. */
export interface AlvoDiario {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

interface DietaDoPlano {
  dailyCalories?: number;
  macros?: { proteinG?: number; carbsG?: number; fatG?: number };
}

/**
 * Qual meta valia em cada dia pedido.
 *
 * O `Plan` é versionado: cada geração, reajuste, importação ou prescrição cria
 * uma versão nova. O alvo de um dia é o da última versão COM DIETA criada até o
 * fim daquele dia — comparar o passado inteiro contra a meta de hoje faria uma
 * troca de dieta pintar de vermelho dias que foram acertos.
 *
 * LIMITE CONHECIDO: `PUT /plans/current` edita a dieta NO LUGAR, sem criar
 * versão. Uma edição manual sobrescreve a meta histórica, e não há como
 * recuperá-la. Quando a prescrição de dieta do nutricionista for construída
 * (frente 3), ela precisa criar versão, como a de treino já faz.
 */
export async function alvosPorDia(
  userId: mongoose.Types.ObjectId,
  dias: string[]
): Promise<Map<string, AlvoDiario | null>> {
  const planos = await Plan.find({ user: userId, diet: { $ne: null } })
    .select("diet createdAt")
    .sort({ createdAt: 1 })
    .lean();

  // Um par (dia em que passou a valer, alvo), já no fuso de São Paulo — o mesmo
  // fuso em que `FoodLog.date` é gravado, senão os dois desalinham na virada.
  const trocas = planos.map((p) => ({
    desde: chaveDoDia(p.createdAt as Date),
    alvo: alvoDe(p.diet as DietaDoPlano | null),
  }));

  const mapa = new Map<string, AlvoDiario | null>();
  for (const dia of dias) {
    let vigente: AlvoDiario | null = null;
    // As trocas estão em ordem; a última que já tinha começado é a que vale.
    for (const t of trocas) {
      if (t.desde <= dia) vigente = t.alvo;
      else break;
    }
    mapa.set(dia, vigente);
  }
  return mapa;
}

function alvoDe(diet: DietaDoPlano | null): AlvoDiario | null {
  if (!diet?.dailyCalories) return null;
  return {
    kcal: diet.dailyCalories,
    proteinG: diet.macros?.proteinG ?? 0,
    carbsG: diet.macros?.carbsG ?? 0,
    fatG: diet.macros?.fatG ?? 0,
  };
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd api && npx vitest run src/services/nutricao.test.ts`
Esperado: PASSA (4 testes).

- [ ] **Passo 5: commit**

```bash
git add api/src/services/nutricao.ts api/src/services/nutricao.test.ts
git commit -m "feat: o alvo de nutricao e o que valia em cada dia, nao o de hoje"
```

---

# Tarefa 3: a série de dias, com os buracos

**Arquivos:**
- Modificar: `api/src/services/nutricao.ts`
- Modificar: `api/src/services/nutricao.test.ts`
- Modificar: `api/src/models/FoodLog.ts`

**Interfaces consumidas:** `alvosPorDia` (Tarefa 2), `ultimosDias` de `utils/dia.ts`.

**Interfaces produzidas:**
```ts
export interface DiaDeNutricao {
  dia: string;
  kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null;
  registros: number;
  alvo: AlvoDiario | null;
}
export interface EvolucaoDeNutricao {
  dias: DiaDeNutricao[];
  resumo: {
    diasComRegistro: number; diasNaJanela: number;
    mediaKcal: number | null; diasDentroDoAlvo: number;
  };
}
export async function evolucaoDeNutricao(
  userId: mongoose.Types.ObjectId, dias: number
): Promise<EvolucaoDeNutricao>;
```

- [ ] **Passo 1: escrever o teste que falha**

Acrescentar ao fim de `api/src/services/nutricao.test.ts` (e no topo do arquivo,
acrescentar `import { FoodLog } from "../models/FoodLog.js";` e
`evolucaoDeNutricao` ao import de `./nutricao.js`):

```ts
describe("A serie de dias", () => {
  const registrar = (date: string, kcal: number) =>
    FoodLog.create({ user, date, meal: "almoco", name: "arroz", kcal, proteinG: 10, carbsG: 20, fatG: 5 });

  beforeEach(async () => {
    await FoodLog.deleteMany({});
  });

  it("devolve um item por dia da janela, inclusive os vazios", async () => {
    const r = await evolucaoDeNutricao(user, 7);
    expect(r.dias).toHaveLength(7);
    expect(r.resumo.diasNaJanela).toBe(7);
  });

  it("dia sem registro vem NULL, e nao zero", async () => {
    // Zero e uma afirmacao sobre a comida; null e a ausencia de afirmacao. O
    // grafico precisa da diferenca para nao dizer que a pessoa passou fome.
    const r = await evolucaoDeNutricao(user, 7);
    const vazio = r.dias[0]!;
    expect(vazio.kcal).toBeNull();
    expect(vazio.registros).toBe(0);
  });

  it("soma os registros do mesmo dia", async () => {
    const hoje = r_hoje();
    await registrar(hoje, 300);
    await registrar(hoje, 200);

    const r = await evolucaoDeNutricao(user, 7);
    const dia = r.dias.find((d) => d.dia === hoje)!;

    expect(dia.kcal).toBe(500);
    expect(dia.proteinG).toBe(20);
    expect(dia.registros).toBe(2);
  });

  it("a media ignora os dias vazios, e o resumo diz quantos foram", async () => {
    await registrar(r_hoje(), 400);

    const r = await evolucaoDeNutricao(user, 30);

    // 400, e nao 400/30: a media de um dia apresentada como se fosse de trinta e
    // a mentira que esta tela existe para evitar.
    expect(r.resumo.mediaKcal).toBe(400);
    expect(r.resumo.diasComRegistro).toBe(1);
  });

  it("media e null quando nao houve registro nenhum", async () => {
    const r = await evolucaoDeNutricao(user, 7);
    expect(r.resumo.mediaKcal).toBeNull();
  });

  it("nao mistura o diario de outra pessoa", async () => {
    await FoodLog.create({
      user: new mongoose.Types.ObjectId(), date: r_hoje(), meal: "almoco",
      name: "alheio", kcal: 9999, proteinG: 0, carbsG: 0, fatG: 0,
    });

    const r = await evolucaoDeNutricao(user, 7);
    expect(r.dias.every((d) => d.kcal === null)).toBe(true);
  });
});
```

E no topo do arquivo, junto dos outros helpers:

```ts
import { chaveDoDia } from "../utils/dia.js";
/** O "hoje" do servidor, no mesmo fuso em que o FoodLog e gravado. */
const r_hoje = () => chaveDoDia();
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/services/nutricao.test.ts`
Esperado: FALHA com "evolucaoDeNutricao is not a function".

- [ ] **Passo 3: implementar**

Acrescentar a `api/src/services/nutricao.ts` (e ao import de `utils/dia.js`,
acrescentar `ultimosDias`):

```ts
import { FoodLog } from "../models/FoodLog.js";

/** Um dia da janela. Os totais são `null` quando não houve registro nenhum. */
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
    /** Média só dos dias COM registro. A tela nunca a mostra sozinha. */
    mediaKcal: number | null;
    diasDentroDoAlvo: number;
  };
}

/** Quanto o consumo pode se afastar do alvo e ainda contar como acerto. */
const TOLERANCIA = 0.1;

/**
 * A aderência da pessoa ao longo da janela.
 *
 * Quem monta o buraco é o servidor, e não a tela: senão cada cliente inventa a
 * própria regra para o dia vazio, e o APK instalado inventaria uma diferente do
 * painel do nutricionista.
 */
export async function evolucaoDeNutricao(
  userId: mongoose.Types.ObjectId,
  dias: number
): Promise<EvolucaoDeNutricao> {
  const datas = ultimosDias(dias);

  // `date` é string yyyy-mm-dd, então a comparação lexicográfica é a cronológica
  // — e o índice { user, date } atende este $match direto.
  const linhas = await FoodLog.aggregate<{
    _id: string; kcal: number; proteinG: number; carbsG: number; fatG: number; registros: number;
  }>([
    { $match: { user: userId, date: { $gte: datas[0], $lte: datas[datas.length - 1] } } },
    {
      $group: {
        _id: "$date",
        kcal: { $sum: "$kcal" },
        proteinG: { $sum: "$proteinG" },
        carbsG: { $sum: "$carbsG" },
        fatG: { $sum: "$fatG" },
        registros: { $sum: 1 },
      },
    },
  ]);

  const porDia = new Map(linhas.map((l) => [l._id, l]));
  const alvos = await alvosPorDia(userId, datas);

  const serie: DiaDeNutricao[] = datas.map((dia) => {
    const l = porDia.get(dia);
    const alvo = alvos.get(dia) ?? null;
    if (!l) {
      return { dia, kcal: null, proteinG: null, carbsG: null, fatG: null, registros: 0, alvo };
    }
    return {
      dia,
      kcal: l.kcal,
      proteinG: l.proteinG,
      carbsG: l.carbsG,
      fatG: l.fatG,
      registros: l.registros,
      alvo,
    };
  });

  const comRegistro = serie.filter((d) => d.kcal !== null);
  const dentro = comRegistro.filter(
    (d) => d.alvo && Math.abs(d.kcal! - d.alvo.kcal) <= d.alvo.kcal * TOLERANCIA
  );

  return {
    dias: serie,
    resumo: {
      diasComRegistro: comRegistro.length,
      diasNaJanela: datas.length,
      mediaKcal: comRegistro.length
        ? Math.round(comRegistro.reduce((s, d) => s + d.kcal!, 0) / comRegistro.length)
        : null,
      diasDentroDoAlvo: dentro.length,
    },
  };
}
```

- [ ] **Passo 4: criar o índice**

Em `api/src/models/FoodLog.ts`, logo antes da linha `export const FoodLog = ...`:

```ts
// A janela do progresso filtra por pessoa E por intervalo de datas. Com os dois
// índices soltos que existiam, uma janela de 30 dias varria todos os registros
// da pessoa. O CLAUDE.md exige índice para toda query nova, e esta é a query.
foodLogSchema.index({ user: 1, date: 1 });
```

- [ ] **Passo 5: rodar e ver passar**

Rodar: `cd api && npx vitest run src/services/nutricao.test.ts && npx tsc --noEmit`
Esperado: PASSA (10 testes no arquivo).

- [ ] **Passo 6: commit**

```bash
git add api/src/services/nutricao.ts api/src/services/nutricao.test.ts api/src/models/FoodLog.ts
git commit -m "feat: a serie de nutricao, com o dia vazio como buraco e nao como zero"
```

---

# Tarefa 4: a rota

**Arquivos:**
- Modificar: `api/src/routes/nutrition.ts`
- Criar: `api/src/routes/nutricaoEvolucao.test.ts`

**Interfaces consumidas:** `evolucaoDeNutricao` (Tarefa 3), `janelaPermitida` e
`metaDaJanela` (Tarefa 1).

**Contrato produzido:** `GET /nutrition/evolucao?dias=30` →
`{ data: EvolucaoDeNutricao, meta: { dias, diasPedidos?, limitadoPor? } }`

- [ ] **Passo 1: escrever o teste que falha**

Criar `api/src/routes/nutricaoEvolucao.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { FoodLog } from "../models/FoodLog.js";
import { User } from "../models/User.js";
import { chaveDoDia } from "../utils/dia.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";
let userId = "";

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email: "nutri@test.com", password: "senha12345" });
  token = reg.body.token;
  userId = reg.body.user.id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await FoodLog.deleteMany({});
  // O gate de janela olha o plano: premium por padrão, e o teste do grátis
  // rebaixa explicitamente.
  await User.updateOne({ _id: userId }, { $set: { plan: "pro", tier: "premium" } });
});

const pedir = (qs = "") =>
  request(app).get(`/nutrition/evolucao${qs}`).set("Authorization", `Bearer ${token}`);

describe("GET /nutrition/evolucao", () => {
  it("exige autenticacao", async () => {
    await request(app).get("/nutrition/evolucao").expect(401);
  });

  it("devolve a janela inteira, com envelope", async () => {
    const r = await pedir("?dias=30").expect(200);

    expect(r.body.data.dias).toHaveLength(30);
    expect(r.body.meta).toEqual({ dias: 30 });
    expect(r.body.data.resumo.diasNaJanela).toBe(30);
  });

  it("o dia sem registro chega no app como null", async () => {
    const r = await pedir("?dias=7").expect(200);
    expect(r.body.data.dias[0].kcal).toBeNull();
  });

  it("soma o que foi registrado hoje", async () => {
    await FoodLog.create({
      user: new mongoose.Types.ObjectId(userId), date: chaveDoDia(), meal: "janta",
      name: "feijoada", kcal: 700, proteinG: 40, carbsG: 50, fatG: 30,
    });

    const r = await pedir("?dias=7").expect(200);
    const hoje = r.body.data.dias.at(-1);

    expect(hoje.kcal).toBe(700);
    expect(hoje.registros).toBe(1);
  });

  it("o gratis tem a janela cortada, e o corpo diz que cortou", async () => {
    await User.updateOne({ _id: userId }, { $set: { plan: "free", tier: "free" } });

    const r = await pedir("?dias=90").expect(200);

    // Cortado, e nao recusado: um 402 mandaria o APK instalado para a tela de
    // assinatura a partir de um grafico.
    expect(r.body.data.dias).toHaveLength(7);
    expect(r.body.meta).toEqual({ dias: 7, diasPedidos: 90, limitadoPor: "plano" });
  });

  it("janela vazia ou absurda nao vira varredura", async () => {
    await pedir("?dias=").expect(200);
    await pedir("?dias=99999").expect(400);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd api && npx vitest run src/routes/nutricaoEvolucao.test.ts`
Esperado: FALHA — a rota devolve 404.

- [ ] **Passo 3: implementar a rota**

Em `api/src/routes/nutrition.ts`, acrescentar aos imports:

```ts
import { z } from "zod";
import { evolucaoDeNutricao } from "../services/nutricao.js";
import { janelaPermitida, metaDaJanela } from "../services/janela.js";
```

E acrescentar a rota (antes do `export`, junto das demais):

```ts
/**
 * Janela em dias. Diferente da evolução de treino, aqui NÃO existe "tudo":
 * a resposta é um item por dia, e uma janela sem teto viraria um corpo de
 * milhares de itens para desenhar um gráfico que cabe numa tela.
 *
 * `?dias=` vazio é tratado como ausente: `Number("")` é 0, e 0 escaparia do
 * `min` em silêncio.
 */
const janelaDeNutricaoSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().int().min(7).max(365).default(30)
);

/** A aderência à dieta ao longo do tempo. */
nutritionRouter.get(
  "/evolucao",
  asyncHandler(async (req, res) => {
    const pedidos = janelaDeNutricaoSchema.parse(req.query.dias);
    const dias = janelaPermitida(req.user!, pedidos);
    const data = await evolucaoDeNutricao(req.user!._id, dias);
    res.json({ data, meta: metaDaJanela(pedidos, dias) });
  })
);
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd api && npx vitest run src/routes/nutricaoEvolucao.test.ts`
Esperado: PASSA (6 testes).

- [ ] **Passo 5: suíte inteira e código de saída**

Rodar: `cd api && npx vitest run; echo "saida=$?"; npx tsc --noEmit`
Esperado: `saida=0`, sem linha `Errors`, typecheck limpo.
**Conferir o código de saída, não só a linha "Tests passed":** o vitest sai 1 quando há
rejeição não tratada mesmo com todos os testes verdes, e é isso que o portão do deploy lê.

- [ ] **Passo 6: commit**

```bash
git add api/src/routes/nutrition.ts api/src/routes/nutricaoEvolucao.test.ts
git commit -m "feat: GET /nutrition/evolucao, a aderencia ao longo do tempo"
```

---

# Tarefa 5: o cliente no app

**Arquivos:**
- Criar: `app-android/src/api/nutricao.ts`

**Interfaces consumidas:** contrato da Tarefa 4.

**Interfaces produzidas:**
```ts
export interface AlvoDiario { kcal: number; proteinG: number; carbsG: number; fatG: number }
export interface DiaDeNutricao { dia: string; kcal: number | null; proteinG: number | null;
  carbsG: number | null; fatG: number | null; registros: number; alvo: AlvoDiario | null }
export interface EvolucaoDeNutricao { dias: DiaDeNutricao[]; resumo: {
  diasComRegistro: number; diasNaJanela: number; mediaKcal: number | null; diasDentroDoAlvo: number } }
export async function buscarEvolucaoDeNutricao(token: string, dias: number):
  Promise<{ data: EvolucaoDeNutricao; meta: { dias: number; limitadoPor?: "plano" } }>;
```

> Sem passo de teste: o app não tem runner. A verificação é o typecheck.

- [ ] **Passo 1: criar o cliente**

Criar `app-android/src/api/nutricao.ts`, seguindo o padrão de
`app-android/src/api/evolucao.ts` (abra-o e copie a forma do `apiFetch`):

```ts
import { apiFetch } from "./client";

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

export async function buscarEvolucaoDeNutricao(token: string, dias: number) {
  return apiFetch<{
    data: EvolucaoDeNutricao;
    meta: { dias: number; diasPedidos?: number; limitadoPor?: "plano" };
  }>(`/nutrition/evolucao?dias=${dias}`, { token });
}
```

Se a assinatura de `apiFetch` no projeto for diferente, **use a do projeto** — abra
`app-android/src/api/evolucao.ts` e espelhe.

- [ ] **Passo 2: typecheck**

Rodar: `cd app-android && npx tsc --noEmit`
Esperado: limpo.

- [ ] **Passo 3: commit**

```bash
git add app-android/src/api/nutricao.ts
git commit -m "feat(app): cliente da evolucao de nutricao"
```

---

# Tarefa 6: o gráfico aprende a ter buraco

Hoje `LineChart` recebe `value: number` e desenha o eixo X no tempo. Se a tela simplesmente
omitir os dias vazios, **a linha é desenhada por cima do buraco** — que é exatamente a
interpolação que a spec proíbe.

**Arquivos:**
- Modificar: `app-android/src/components/LineChart.tsx`

**Interfaces produzidas:** `ChartPoint.value` passa a ser `number | null`.

> Sem passo de teste: o app não tem runner. A verificação é typecheck + olhar a tela.

- [ ] **Passo 1: abrir o componente e entender o caminho**

Ler `app-android/src/components/LineChart.tsx` inteiro. Localizar onde o `path` do SVG é
montado a partir de `points` e onde a escala do eixo Y é calculada (mínimo e máximo).

- [ ] **Passo 2: aceitar null**

**a)** Mudar a interface:

```ts
export interface ChartPoint {
  date: string;
  /** `null` = não houve medida nesse dia. A linha QUEBRA aqui, não interpola:
   *  ligar os dois lados por cima do buraco é afirmar um dia que não existiu. */
  value: number | null;
  /** Neste treino a pessoa bateu o próprio recorde. */
  ehPR?: boolean;
}
```

**b)** Dentro do `useMemo`, a escala passa a ignorar os nulos, e `y` passa a propagar nulo:

```ts
const values = points.map((p) => p.value).filter((v): v is number => v != null);
// Todos nulos: não há escala possível, e quem trata o vazio é a tela.
if (values.length === 0) return null;
const min = Math.min(...values);
const max = Math.max(...values);
```

```ts
const y = (v: number | null) => {
  if (v == null) return null;
  const frac = (v - min) / span;
  return padT + (menorEhMelhor ? frac : 1 - frac) * plotH;
};
```

Com isso `coords` vira `{ px: number; py: number | null; v: number | null; ... }` — o
TypeScript strict acusa cada ponto que precisa de guarda, e é assim que se acha todos.

**c)** Depois do `useMemo`, a guarda de vazio cobre os dois casos:

```ts
if (points.length === 0 || g === null) return null;
```

**d)** Trocar a polilinha única por trechos contínuos. `<Polyline>` não tem como ter
buraco, então a linha vira uma por trecho:

```ts
// A linha quebra onde não houve medida. Um trecho de um ponto só não desenha
// segmento nenhum — e está certo: o círculo daquele dia continua aparecendo,
// então um dia solto entre dois buracos aparece como ponto, não some.
const segmentos: string[] = [];
let atual: string[] = [];
for (const c of g.coords) {
  if (c.py == null) {
    if (atual.length) segmentos.push(atual.join(" "));
    atual = [];
  } else {
    atual.push(`${c.px},${c.py}`);
  }
}
if (atual.length) segmentos.push(atual.join(" "));
```

No JSX, onde hoje há **uma** `<Polyline points={polyline} …/>`, passa a haver uma por
trecho, com as mesmas props visuais:

```tsx
{segmentos.map((pts, i) => (
  <Polyline key={i} points={pts} /* …mesmas props de antes… */ />
))}
```

**e)** Onde os círculos são desenhados, pular os nulos:

```tsx
{g.coords.filter((c) => c.py != null).map((c, i) => ( /* …como antes… */ ))}
```

**f)** O rótulo do último ponto usa o último **não nulo**:

```ts
const last = [...g.coords].reverse().find((c) => c.py != null) ?? null;
```

E onde `last` é usado, guardar com `last &&`.

**g)** `selecionar` só considera pontos com medida — deixar o dedo cair num buraco mostraria
um valor que não existe:

```ts
g.coords.forEach((c, i) => {
  if (c.py == null) return;
  /* …resto como antes… */
});
```

E o `rotulo` guarda `sel?.v != null` antes de formatar.

- [ ] **Passo 3: garantir que o gráfico de treino não regrediu**

`HistoryScreen` passa `value: number` sempre. Como `number` é atribuível a
`number | null`, ele compila sem mudança. Confirmar:

Rodar: `cd app-android && npx tsc --noEmit && npm run checar-cores`
Esperado: limpo nos dois.

- [ ] **Passo 4: commit**

```bash
git add app-android/src/components/LineChart.tsx
git commit -m "feat(app): o grafico quebra a linha no dia sem medida, em vez de inventar"
```

---

# Tarefa 7: a tela de nutrição

**Arquivos:**
- Criar: `app-android/src/screens/NutricaoProgressoScreen.tsx`

**Interfaces consumidas:** `buscarEvolucaoDeNutricao` (Tarefa 5), `LineChart` com null
(Tarefa 6).

> Sem passo de teste: o app não tem runner.

- [ ] **Passo 1: montar a tela**

Criar `app-android/src/screens/NutricaoProgressoScreen.tsx`. Ela recebe
`{ embedded }: { embedded?: boolean }`, como as outras telas do hub.

Ordem dos blocos, de cima para baixo:

1. **Chips de janela** — 7 · 30 · 90 dias. Quando `meta.limitadoPor === "plano"`, desenhar
   o cadeado e o card tocável para `Subscription`, como `HistoryScreen` já faz (copie a
   forma de lá).

2. **Cabeçalho honesto** — um `Card` com duas informações de igual peso:
   - `resumo.mediaKcal` ("média por dia registrado"), ou um traço quando for `null`;
   - `"{diasComRegistro} de {diasNaJanela} dias registrados"`.

   **A média nunca aparece sem a contagem ao lado.** Uma média de 12 dias apresentada como
   se fosse de 30 é a mentira que esta tela existe para evitar.

3. **Gráfico** — `LineChart` com `points = dias.map(d => ({ date: d.dia, value: d.kcal }))`.
   O alvo entra como referência visual; se o alvo variar na janela, use o alvo do último
   dia com alvo e não desenhe uma linha reta mentirosa sobre os dias que tinham outra meta.

4. **Barras de macro** — proteína, carbo e gordura: soma dos dias com registro contra a
   soma dos alvos desses mesmos dias. Reusar o componente `Bar` que o `DiarioScreen` já
   usa; abrir `app-android/src/screens/DiarioScreen.tsx` e copiar a forma.

5. **Convite para preencher** (Tarefa 9 liga o toque; aqui só a condição e o texto):
   aparece quando `dias` tem buraco em ontem ou anteontem. Texto: *"Faltou registrar
   domingo. O que você comeu?"* — **nunca** "você falhou", "você pulou", "dia perdido".

6. **Estados** — seguir o padrão do projeto, literalmente:
   `try { ...; setError(false) } catch { setError(true) } finally { setLoading(false) }`,
   e renderizar `loading → Skeleton`, `error → ErrorState`, `vazio → EmptyState`, senão o
   conteúdo. Vazio aqui é `resumo.diasComRegistro === 0`, e o CTA é registrar uma refeição.

- [ ] **Passo 2: typecheck e cores**

Rodar: `cd app-android && npx tsc --noEmit && npm run checar-cores`
Esperado: limpo.

- [ ] **Passo 3: commit**

```bash
git add app-android/src/screens/NutricaoProgressoScreen.tsx
git commit -m "feat(app): a tela de progresso de nutricao, com o buraco visivel"
```

---

# Tarefa 8: o Progresso ganha dois níveis

**Arquivos:**
- Modificar: `app-android/src/screens/ProgressoScreen.tsx`

**Interfaces consumidas:** `NutricaoProgressoScreen` (Tarefa 7).

> Sem passo de teste: o app não tem runner.

- [ ] **Passo 1: acrescentar o nível de cima**

Em `ProgressoScreen.tsx`, acrescentar **acima** do `SegmentedControl` que já existe um
segundo `SegmentedControl`, de assunto:

```tsx
type Assunto = "treino" | "nutricao";

const ASSUNTOS: Segment<Assunto>[] = [
  { key: "treino", label: "Treino" },
  { key: "nutricao", label: "Nutrição" },
];
```

No corpo do componente:

```tsx
const [assunto, setAssunto] = useState<Assunto>("treino");
```

E no JSX: o seletor de assunto sempre visível; o `SegmentedControl` das quatro abas e o
bloco que as renderiza só quando `assunto === "treino"`; `<NutricaoProgressoScreen embedded />`
quando `assunto === "nutricao"`.

**Não alterar nada dentro das quatro telas existentes.** Elas já recebem `embedded`.

- [ ] **Passo 2: conferir que nada de treino mudou**

Rodar: `cd app-android && npx tsc --noEmit && npm run checar-cores`
Esperado: limpo.

- [ ] **Passo 3: commit**

```bash
git add app-android/src/screens/ProgressoScreen.tsx
git commit -m "feat(app): Progresso separa Treino de Nutricao, e cabe o CrossFit depois"
```

---

# Tarefa 9: preencher ontem e anteontem

**Arquivos:**
- Modificar: `app-android/src/components/QuickFoodAdd.tsx`
- Modificar: `app-android/src/screens/NutricaoProgressoScreen.tsx`

> Sem passo de teste: o app não tem runner.

- [ ] **Passo 1: o QuickFoodAdd aceita data**

Hoje ele grava sempre em `todayStr()`. Acrescentar uma prop **opcional**:

```tsx
/** Em que dia gravar. Ausente = hoje, que é o caso comum e o comportamento
 *  que o resto do app já espera. */
data?: string;
```

Usar `data ?? todayStr()` em todos os pontos em que hoje ele chama `todayStr()`. Prop
opcional de propósito: nenhuma chamada existente muda.

- [ ] **Passo 2: ligar o convite**

Na `NutricaoProgressoScreen`, o convite do bloco 5 abre o `QuickFoodAdd` passando a data
daquele dia. Ofertar **no máximo ontem e anteontem** — mais para trás vira reconstrução de
memória, e um gráfico cheio de estimativa de duas semanas atrás é tão falso quanto o que só
tinha dia bom.

**Não** acrescentar trava nenhuma no servidor: o `DiarioScreen` grava em qualquer data
passada hoje e precisa continuar gravando, senão o APK 1.2.0 instalado quebra numa tela que
sempre funcionou.

- [ ] **Passo 3: recarregar depois de gravar**

Depois de o `QuickFoodAdd` fechar com sucesso, chamar de novo o carregamento da tela — o
buraco precisa sumir do gráfico na hora, senão a pessoa não vê que a ação dela teve efeito.

- [ ] **Passo 4: typecheck e cores**

Rodar: `cd app-android && npx tsc --noEmit && npm run checar-cores`
Esperado: limpo.

- [ ] **Passo 5: commit**

```bash
git add app-android/src/components/QuickFoodAdd.tsx app-android/src/screens/NutricaoProgressoScreen.tsx
git commit -m "feat(app): preencher o dia que ficou em branco, sem chamar de falha"
```

---

# Tarefa 10: revisão e entrega

- [ ] **Passo 1: a suíte inteira, com o código de saída**

```bash
cd api && npx vitest run; echo "saida=$?"; npx tsc --noEmit
cd ../app-android && npx tsc --noEmit && npm run checar-cores
```

Esperado: `saida=0` e todos limpos. Se o vitest disser `Errors: N` com todos os testes
verdes, há promise solta em algum lugar — não ignore, é isso que derruba o deploy.

- [ ] **Passo 2: revisores do projeto, em paralelo, no diff pronto**

O `CLAUDE.md` exige. `fitsocial-compatibilidade` é **obrigatório** (mexe em índice, em
contrato e no `QuickFoodAdd`, que o APK instalado usa), mais `fitsocial-backend` e
`fitsocial-app`. Dar a eles o contexto do que a mudança tenta resolver, não só "revise".
Conferir cada achado antes de aplicar.

- [ ] **Passo 3: commit final e merge**

Merge na `main` dispara o deploy pelo GitHub Actions. Confirmar pelo campo `commit` do
deployment — `/health` responde 200 mesmo com build quebrado.

---

# Fora deste plano

- Peso, medidas e fotos de progresso (fatia seguinte).
- Painel do nutricionista (frente 3) — vai consumir `services/nutricao.ts`.
- Trava de autoria da dieta (`recusarSeTemNutricionista`).
- `POST /nutrition/logs` aceitar data no futuro — buraco real, tarefa própria.
