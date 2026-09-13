import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User, publicUser } from "../models/User.js";
import {
  calcularPlan,
  calcularTier,
  planDoUsuario,
  planEfetivo,
  recomputeTier,
  temCapacidade,
} from "./entitlement.js";

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
  await User.deleteMany({});
});

async function criar(campos: Record<string, unknown> = {}) {
  return User.create({
    name: "Pessoa",
    email: `p${Math.random().toString(36).slice(2)}@teste.com`,
    passwordHash: "x",
    ...campos,
  });
}

describe("plano do consumidor", () => {
  it("conta nova nasce free", async () => {
    const u = await criar();
    expect(planDoUsuario(u)).toBe("free");
    expect(calcularTier(u)).toBe("free");
  });

  // A razão de `planDoUsuario` existir: quem já paga tem `tier: premium` e não
  // tem `plan`. Derivar do tier é o que impede o deploy de rebaixar essa gente.
  it("conta antiga premium, sem plan, é lida como pro", async () => {
    const u = await criar();
    await User.collection.updateOne(
      { _id: u._id },
      { $set: { tier: "premium", premiumSource: "purchase" }, $unset: { plan: "" } }
    );
    const antigo = (await User.findById(u._id))!;

    expect(antigo.plan).toBeUndefined();
    expect(planDoUsuario(antigo)).toBe("pro");
    expect(calcularTier(antigo)).toBe("premium");
  });

  it("pro e pro_plus continuam sendo premium para quem lê tier", async () => {
    for (const plan of ["pro", "pro_plus"] as const) {
      const u = await criar({ plan, premiumSource: "purchase" });
      expect(calcularTier(u)).toBe("premium");
      expect(publicUser(u).tier).toBe("premium");
      expect(publicUser(u).plan).toBe(plan);
    }
  });

  it("cortesia do admin ganha do que veio da loja", async () => {
    const u = await criar({ plan: "free", premiumSource: "admin" });
    expect(calcularPlan(u)).toBe("pro");
    expect(calcularTier(u)).toBe("premium");
  });

  it("cortesia vencida volta para free", async () => {
    const u = await criar({
      plan: "pro",
      premiumSource: "admin",
      premiumUntil: new Date(Date.now() - 1000),
      tier: "premium",
    });
    await recomputeTier(u);

    expect(u.plan).toBe("free");
    expect(u.tier).toBe("free");
    expect(u.premiumSource).toBeNull();
  });

  it("recompute não rebaixa quem tem compra ativa", async () => {
    const u = await criar({ plan: "pro_plus", premiumSource: "purchase", tier: "premium" });
    await recomputeTier(u);

    expect(u.plan).toBe("pro_plus");
    expect(u.tier).toBe("premium");
  });
});

describe("capacidade profissional", () => {
  it("ninguém nasce coach nem nutri", async () => {
    const u = await criar();
    expect(temCapacidade(u, "coach")).toBe(false);
    expect(temCapacidade(u, "nutri")).toBe(false);
    expect(publicUser(u).pro).toEqual({ coach: false, nutri: false });
  });

  it("capacidade ativa vale, e o prazo é respeitado", async () => {
    const ativo = await criar({ pro: { coach: { ativo: true, origem: "manual" } } });
    expect(temCapacidade(ativo, "coach")).toBe(true);
    expect(temCapacidade(ativo, "nutri")).toBe(false);

    const vencido = await criar({
      pro: { coach: { ativo: true, origem: "manual", validoAte: new Date(Date.now() - 1000) } },
    });
    expect(temCapacidade(vencido, "coach")).toBe(false);
  });

  // Os três eixos são independentes: um coach pode ser aluno free, e um
  // admin não vira coach por ser admin.
  it("capacidade não depende do plano nem do papel", async () => {
    const coachFree = await criar({ plan: "free", pro: { coach: { ativo: true } } });
    expect(temCapacidade(coachFree, "coach")).toBe(true);
    expect(calcularTier(coachFree)).toBe("free");

    const admin = await criar({ role: "admin" });
    expect(temCapacidade(admin, "coach")).toBe(false);
  });

  it("dá para ser coach e nutri ao mesmo tempo", async () => {
    const u = await criar({ pro: { coach: { ativo: true }, nutri: { ativo: true } } });
    expect(temCapacidade(u, "coach")).toBe(true);
    expect(temCapacidade(u, "nutri")).toBe(true);
  });

  it("o teto de alunos nasce em 10 e vive no documento", async () => {
    const u = await criar({ pro: { coach: { ativo: true } } });
    expect(u.pro?.coach?.limiteDeAlunos).toBe(10);

    const excecao = await criar({ pro: { coach: { ativo: true, limiteDeAlunos: 50 } } });
    expect(excecao.pro?.coach?.limiteDeAlunos).toBe(50);
  });
});

/**
 * As cinco fontes de acesso pago, e a ordem entre elas.
 *
 * Tabela pura: `calcularPlan` não consulta nada, e é por isso que ela pode
 * rodar dentro do `requireAuth` sem custo. Estes testes existem para que a
 * precedência nunca vire acidente — cada linha aqui é uma decisão de produto
 * que alguém tomou, e não um detalhe de implementação.
 */
describe("as cinco fontes de acesso pago", () => {
  const ONTEM = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const DAQUI_A_UM_MES = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  it("cortesia do admin dentro do prazo vale", async () => {
    const u = await criar({ premiumSource: "admin", premiumUntil: DAQUI_A_UM_MES });
    expect(calcularPlan(u)).toBe("pro");
  });

  it("cortesia VENCIDA não vale mais — é o bug que o motor existe para matar", async () => {
    const u = await criar({ premiumSource: "admin", premiumUntil: ONTEM, tier: "premium" });
    // Antes, nada recalculava: o `tier` gravado continuava premium para sempre.
    expect(calcularPlan(u)).toBe("free");
  });

  it("assinatura ativa vale, e o produto decide o plano", async () => {
    const u = await criar({
      assinaturaStatus: "ativa",
      assinaturaAte: DAQUI_A_UM_MES,
      produtoAssinado: "pro_coach",
    });
    // Pro Coach é `pro` no eixo do consumidor: quem compra o painel não paga o
    // Pro separado. A capacidade profissional vive noutro campo.
    expect(calcularPlan(u)).toBe("pro");
  });

  it("assinatura vencida cai", async () => {
    const u = await criar({
      assinaturaStatus: "ativa",
      assinaturaAte: ONTEM,
      produtoAssinado: "pro",
      tier: "premium",
    });
    expect(calcularPlan(u)).toBe("free");
  });

  it("inadimplente ganha carência antes de cair", async () => {
    const tresDiasAtras = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const u = await criar({
      assinaturaStatus: "inadimplente",
      assinaturaAte: tresDiasAtras,
      produtoAssinado: "pro",
    });
    // Cartão vencido é a causa nº 1 de recusa, e acontece com quem QUER pagar.
    expect(calcularPlan(u)).toBe("pro");
  });

  it("passada a carência, o inadimplente cai", async () => {
    const dezDiasAtras = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const u = await criar({
      assinaturaStatus: "inadimplente",
      assinaturaAte: dezDiasAtras,
      produtoAssinado: "pro",
    });
    expect(calcularPlan(u)).toBe("free");
  });

  it("meses grátis de cupom valem sozinhos, sem assinatura nenhuma", async () => {
    const u = await criar({ cortesiaAte: DAQUI_A_UM_MES });
    expect(calcularPlan(u)).toBe("pro");
  });

  it("aluno acompanhado é Pro enquanto o vínculo durar", async () => {
    const u = await criar({ vinculosPatrocinados: 1 });
    expect(calcularPlan(u)).toBe("pro");
  });

  it("aluno com coach E nutri não perde o Pro ao encerrar um dos dois", async () => {
    const u = await criar({ vinculosPatrocinados: 2 });
    expect(calcularPlan(u)).toBe("pro");

    // É por isso que o campo é contador e não booleano.
    u.vinculosPatrocinados = 1;
    expect(calcularPlan(u)).toBe("pro");

    u.vinculosPatrocinados = 0;
    expect(calcularPlan(u)).toBe("free");
  });

  it("quem paga E é acompanhado não perde nada ao encerrar o vínculo", async () => {
    const u = await criar({
      assinaturaStatus: "ativa",
      assinaturaAte: DAQUI_A_UM_MES,
      produtoAssinado: "pro",
      vinculosPatrocinados: 1,
    });
    expect(calcularPlan(u)).toBe("pro");

    u.vinculosPatrocinados = 0;
    // A compra continua de pé: patrocínio é o ÚLTIMO ramo de propósito.
    expect(calcularPlan(u)).toBe("pro");
  });

  it("cortesia do admin ganha da assinatura vencida", async () => {
    const u = await criar({
      premiumSource: "admin",
      premiumUntil: DAQUI_A_UM_MES,
      assinaturaStatus: "expirada",
      assinaturaAte: ONTEM,
    });
    expect(calcularPlan(u)).toBe("pro");
  });
});

describe("pro_plus é o rótulo de ter os dois painéis", () => {
  it("as duas capacidades ativas fazem o plano virar pro_plus", async () => {
    const u = await criar({
      assinaturaStatus: "ativa",
      assinaturaAte: new Date(Date.now() + 86_400_000),
      produtoAssinado: "pro_coach",
      pro: {
        coach: { ativo: true, origem: "gateway" },
        nutri: { ativo: true, origem: "manual" },
      },
    });
    // `pro_plus` não desbloqueava nada e não havia caminho para virar pro_plus.
    // Agora ele é derivado, e não um valor que alguém precisa lembrar de gravar.
    expect(planEfetivo(u)).toBe("pro_plus");
  });

  it("uma capacidade só continua sendo pro", async () => {
    const u = await criar({
      vinculosPatrocinados: 1,
      pro: { coach: { ativo: true, origem: "gateway" }, nutri: { ativo: false } },
    });
    expect(planEfetivo(u)).toBe("pro");
  });

  it("quem é free não vira pro_plus por ter capacidade", async () => {
    const u = await criar({
      pro: {
        coach: { ativo: true, origem: "manual" },
        nutri: { ativo: true, origem: "manual" },
      },
    });
    // Capacidade é o que a pessoa faz COM OS OUTROS; plano é o que ela comprou
    // para si. São eixos diferentes, e um não promove o outro.
    expect(planEfetivo(u)).toBe("free");
  });
});

describe("recomputeTier grava sem atropelar a rota", () => {
  it("corrige o tier de quem estava premium com cortesia vencida", async () => {
    const u = await criar({
      tier: "premium",
      premiumSource: "admin",
      premiumUntil: new Date("2020-01-01"),
    });

    await recomputeTier(u);

    expect(u.tier).toBe("free");
    expect((await User.findById(u._id))!.tier).toBe("free");
  });

  it("apaga a origem da cortesia vencida", async () => {
    const u = await criar({
      premiumSource: "admin",
      premiumUntil: new Date(Date.now() - 86_400_000),
      tier: "premium",
    });

    await recomputeTier(u);

    const doBanco = (await User.findById(u._id))!;
    expect(doBanco.tier).toBe("free");
    expect(doBanco.premiumSource).toBeNull();
  });
});

describe("o premium legado, que não tem como provar que pagou", () => {
  it("premium sem origem nenhuma continua premium", async () => {
    // O primeiro webhook do RevenueCat gravava só `tier`. Sem este ramo, quem
    // comprou naquela época cairia para free E o `recomputeTier` apagaria o
    // `tier: "premium"` por cima — sumindo com a única prova do pagamento.
    const u = await criar({ tier: "premium" });
    expect(calcularPlan(u)).toBe("pro");
  });

  it("e o recálculo não o rebaixa nem apaga a evidência", async () => {
    const u = await criar({ tier: "premium" });

    await recomputeTier(u);

    const doBanco = (await User.findById(u._id))!;
    expect(doBanco.tier).toBe("premium");
    expect(doBanco.plan).toBe("pro");
  });

  it("mas free continua free — o ramo não promove ninguém", async () => {
    const u = await criar({ tier: "free" });
    expect(calcularPlan(u)).toBe("free");
  });
});

describe("a escrita do recálculo não pode atrapalhar ninguém", () => {
  it("falha de gravação NÃO derruba a sessão", async () => {
    const u = await criar({ tier: "premium", premiumSource: "admin" });

    // `requireAuth` transforma exceção em 401, e o app apaga o token do
    // aparelho ao tomar 401 no boot. Um timeout de escrita no Mongo não pode
    // custar a sessão de alguém.
    const original = User.updateOne.bind(User);
    (User as unknown as { updateOne: unknown }).updateOne = () => {
      throw new Error("banco fora do ar no meio da requisição");
    };

    await expect(recomputeTier(u)).resolves.toBeUndefined();
    // E o valor em memória está certo: a permissão desta requisição sai correta.
    expect(u.tier).toBe("premium");

    (User as unknown as { updateOne: unknown }).updateOne = original;
  });

  it("não desfaz uma compra que chegou pelo webhook no meio do caminho", async () => {
    const u = await criar({ tier: "free" });

    // O documento que o `requireAuth` carregou, antes de tudo.
    const doMiddleware = (await User.findById(u._id))!;

    // Enquanto isso, o webhook da loja credita a compra.
    await User.updateOne(
      { _id: u._id },
      { $set: { tier: "premium", plan: "pro", premiumSource: "purchase" } }
    );

    // O recálculo roda sobre o documento VELHO e calcularia "free".
    await recomputeTier(doMiddleware);

    const doBanco = (await User.findById(u._id))!;
    // A precondição no filtro impede a escrita: a compra fica de pé.
    expect(doBanco.tier).toBe("premium");
    expect(doBanco.premiumSource).toBe("purchase");
  });

  it("um save() da ROTA, com outro documento, não ressuscita o valor velho", async () => {
    const u = await criar({ tier: "premium", premiumSource: "admin" });

    // Dois documentos: é assim na vida real — o middleware carrega um, a rota
    // carrega outro. Com um só, o teste não distingue `save()` de `updateOne`.
    const doMiddleware = (await User.findById(u._id))!;
    const doRoteador = (await User.findById(u._id))!;

    // A cortesia venceu entre um e outro.
    await User.updateOne({ _id: u._id }, { $set: { premiumUntil: new Date("2020-01-01") } });
    doMiddleware.premiumUntil = new Date("2020-01-01");
    await recomputeTier(doMiddleware);

    doRoteador.name = "Outro nome";
    await doRoteador.save();

    const doBanco = (await User.findById(u._id))!;
    expect(doBanco.name).toBe("Outro nome");
    expect(doBanco.tier).toBe("free");
  });
});
