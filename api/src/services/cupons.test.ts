import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Cupom } from "../models/Cupom.js";
import { CupomUso } from "../models/CupomUso.js";
import { Assinatura } from "../models/Assinatura.js";
import { Cobranca } from "../models/Cobranca.js";
import { EventoDeCobranca } from "../models/EventoDeCobranca.js";
import { setProvedorDePagamento } from "../services/pagamentos/index.js";
import { relatorioDoCupom } from "./cupons.js";
import type {
  CheckoutCriado,
  EventoNormalizado,
  IProvedorDePagamento,
  PedidoDeCheckout,
} from "./pagamentos/provider.js";

// O cupom tem dois eixos, e os testes seguem essa divisão: o que ele faz com o
// DINHEIRO (desconto) e o que ele faz com a ORIGEM (parceria). A maior parte
// dos erros caros mora no segundo, porque ele decide quanto alguém recebe.

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

class ProvedorDeMentira implements IProvedorDePagamento {
  readonly nome = "asaas" as const;
  ultimoPedido: PedidoDeCheckout | null = null;
  async criarCheckout(p: PedidoDeCheckout): Promise<CheckoutCriado> {
    this.ultimoPedido = p;
    return {
      urlDeCheckout: `https://pagamento.exemplo/${p.referencia}`,
      provedorAssinaturaId: null,
      provedorClienteId: null,
      provedorCheckoutId: `chk_${p.referencia}`,
    };
  }
  verificarWebhook(h: Record<string, unknown>) {
    return h["asaas-access-token"] === "segredo-certo";
  }
  normalizarEvento(c: unknown) {
    return c as EventoNormalizado;
  }
  async cancelarAssinatura(): Promise<void> {}
  async consultarAssinatura() {
    return null;
  }
}

let dublê: ProvedorDeMentira;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
  setProvedorDePagamento(null);
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Cupom.deleteMany({}),
    CupomUso.deleteMany({}),
    Assinatura.deleteMany({}),
    Cobranca.deleteMany({}),
    EventoDeCobranca.deleteMany({}),
  ]);
  dublê = new ProvedorDeMentira();
  setProvedorDePagamento(dublê);
});

let n = 0;
async function registrar(cupom?: string) {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({
      name: `P${n}`,
      email: `cup${n}@teste.com`,
      password: "senha-bem-longa",
      ...(cupom ? { cupom } : {}),
    });
  return { token: r.body.token as string, id: r.body.user.id as string, status: r.status };
}

const contaDe = async (id: string) => (await User.findById(id))!;

function webhook(evento: Partial<EventoNormalizado> & { ocorridoEm?: string }) {
  return request(app)
    .post("/billing/webhook/asaas")
    .set("asaas-access-token", "segredo-certo")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ tipo: "pagamento.aprovado", eventoId: `e${Math.random()}`, ...evento }));
}

async function criarCupom(campos: Record<string, unknown>) {
  return Cupom.create({ codigo: "TESTE", ...campos });
}

describe("o cupom de DESCONTO mexe no preço", () => {
  it("percentual desconta do valor mandado ao gateway", async () => {
    await criarCupom({ codigo: "META20", desconto: { tipo: "percentual", valor: 20 } });
    const u = await registrar();

    const r = await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal", cupom: "meta20" });

    expect(r.status).toBe(201);
    // 29,90 menos 20% = 23,92. O gateway tem de receber o valor JÁ descontado:
    // se recebesse o cheio, o extrato não bateria com o que a tela prometeu.
    expect(r.body.data.valorCentavos).toBe(2392);
    expect(r.body.data.descontoCentavos).toBe(598);
    expect(dublê.ultimoPedido?.valorCentavos).toBe(2392);
    // Minúsculo funciona: o código é normalizado em todo caminho de entrada.
    expect(r.body.data.cupom).toBe("META20");
  });

  it("valor fixo desconta em centavos", async () => {
    await criarCupom({ codigo: "DEZOFF", desconto: { tipo: "valor", valor: 1000 } });
    const u = await registrar();

    const r = await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal", cupom: "DEZOFF" });

    expect(r.body.data.valorCentavos).toBe(1990);
  });

  it("desconto maior que o preço não zera a cobrança", async () => {
    // O gateway recusa cobrança de zero, e o checkout ficaria inabrível com uma
    // mensagem que não explica nada. Quem quer dar de graça usa meses grátis.
    await criarCupom({ codigo: "CEMOFF", desconto: { tipo: "valor", valor: 999999 } });
    const u = await registrar();

    const r = await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal", cupom: "CEMOFF" });

    expect(r.status).toBe(201);
    expect(r.body.data.valorCentavos).toBeGreaterThanOrEqual(100);
  });

  it("cupom digitado que não vale RECUSA a compra, em vez de cobrar o cheio", async () => {
    const u = await registrar();
    const r = await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal", cupom: "NAOEXISTE" });

    // Cobrar o preço cheio em silêncio seria a pior saída: a pessoa veria outro
    // valor na página de pagamento sem entender por quê.
    expect(r.status).toBe(404);
  });

  it("cupom restrito a um produto não vale para outro", async () => {
    await criarCupom({
      codigo: "SOCOACH",
      desconto: { tipo: "percentual", valor: 50 },
      produtos: ["pro_coach"],
    });
    const u = await registrar();

    const r = await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal", cupom: "SOCOACH" });

    expect(r.status).toBe(409);
  });

  it("revogado, vencido e esgotado são recusados", async () => {
    await criarCupom({ codigo: "MORTO", revogadoEm: new Date() });
    await criarCupom({ codigo: "VELHO", validoAte: new Date(Date.now() - 1000) });
    await criarCupom({ codigo: "CHEIO", limiteDeUsos: 1, usos: 1 });
    const u = await registrar();

    for (const c of ["MORTO", "VELHO", "CHEIO"]) {
      const r = await request(app)
        .post("/billing/checkout")
        .set(auth(u.token))
        .send({ produto: "pro", ciclo: "mensal", cupom: c });
      expect(r.status, c).toBe(409);
    }
  });
});

describe("o cupom de PARCERIA marca de onde a pessoa veio", () => {
  it("o código dado no cadastro fica na conta e conta como entrada", async () => {
    await criarCupom({
      codigo: "JOAO",
      parceiro: { nome: "João", comissaoPercentual: 30 },
    });

    const u = await registrar("joao");

    expect((await contaDe(u.id)).cupom).toBe("JOAO");
    const rel = await relatorioDoCupom("JOAO");
    // Ela entrou, e ainda não pagou. É o número que o parceiro vem cobrar, e
    // que não existiria se o cupom só fosse lido no checkout.
    expect(rel.entraram).toBe(1);
    expect(rel.pagaram).toBe(0);
    expect(rel.gratis).toBe(1);
  });

  it("cupom errado no cadastro NÃO impede a conta de ser criada", async () => {
    const u = await registrar("ISSONAOEXISTE");

    // Perder um cadastro por causa de uma letra trocada num campo opcional
    // seria perder a pessoa e o parceiro de uma vez.
    expect(u.status).toBe(201);
    expect((await contaDe(u.id)).cupom ?? null).toBeNull();
  });

  it("quem entrou por um parceiro usa o desconto dele sem digitar nada", async () => {
    await criarCupom({
      codigo: "PARC",
      desconto: { tipo: "percentual", valor: 10 },
      parceiro: { nome: "Parceira", comissaoPercentual: 25 },
    });
    const u = await registrar("PARC");

    const r = await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal" });

    // Sem isto, a parceria só renderia se a pessoa lembrasse do código na hora
    // de pagar — e a maior parte não lembra.
    expect(r.body.data.cupom).toBe("PARC");
    expect(r.body.data.valorCentavos).toBe(2691);
  });

  it("a comissão é gravada quando o dinheiro ENTRA, e só então", async () => {
    await criarCupom({
      codigo: "COM50",
      parceiro: { nome: "Meio a meio", comissaoPercentual: 50 },
    });
    const u = await registrar("COM50");
    await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal" });
    const a = (await Assinatura.findOne({ user: u.id }))!;

    // Antes do pagamento: nada creditado.
    expect((await relatorioDoCupom("COM50")).comissaoCentavos).toBe(0);

    await webhook({ referencia: a._id.toString(), valorCentavos: 2990 });

    const rel = await relatorioDoCupom("COM50");
    expect(rel.pagaram).toBe(1);
    expect(rel.receitaCentavos).toBe(2990);
    expect(rel.comissaoCentavos).toBe(1495);
    // E a comissão fica na COBRANÇA, congelada com a taxa do dia da venda.
    const cob = (await Cobranca.findOne({ assinatura: a._id, status: "paga" }))!;
    expect(cob.parceiroComissaoCentavos).toBe(1495);
  });

  it("cobrança que FALHOU não credita comissão nenhuma", async () => {
    await criarCupom({ codigo: "FALHA", parceiro: { nome: "X", comissaoPercentual: 50 } });
    const u = await registrar("FALHA");
    await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal" });
    const a = (await Assinatura.findOne({ user: u.id }))!;

    await webhook({ referencia: a._id.toString(), tipo: "pagamento.falhou", valorCentavos: 2990 });

    // Pagar comissão sobre venda que não aconteceu é dinheiro saindo por
    // engano, e reverter depois é conversa difícil com quem já recebeu.
    expect((await relatorioDoCupom("FALHA")).comissaoCentavos).toBe(0);
  });

  it("mudar a comissão do parceiro NÃO reescreve o que já foi vendido", async () => {
    const c = await criarCupom({
      codigo: "MUDA",
      parceiro: { nome: "Y", comissaoPercentual: 10 },
    });
    const u = await registrar("MUDA");
    await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal" });
    const a = (await Assinatura.findOne({ user: u.id }))!;
    await webhook({ referencia: a._id.toString(), valorCentavos: 2990 });

    c.set("parceiro.comissaoPercentual", 90);
    await c.save();

    // O relatório de ontem não pode dizer outra coisa hoje.
    const cob = (await Cobranca.findOne({ assinatura: a._id, status: "paga" }))!;
    expect(cob.parceiroComissaoCentavos).toBe(299);
  });
});

describe("o cupom de MESES GRÁTIS não passa pelo gateway", () => {
  it("dá a cortesia na hora do cadastro", async () => {
    await criarCupom({ codigo: "TRESMES", desconto: { tipo: "meses_gratis", valor: 3 } });

    const u = await registrar("TRESMES");

    const conta = await contaDe(u.id);
    // Já entra com o Pro: é o cupom que faz a pessoa experimentar antes de
    // decidir pagar, e esperar a segunda requisição estragaria o primeiro
    // minuto dela no app.
    expect(conta.plan).toBe("pro");
    expect(conta.cortesiaAte).toBeTruthy();
    const meses =
      (conta.cortesiaAte!.getFullYear() - new Date().getFullYear()) * 12 +
      (conta.cortesiaAte!.getMonth() - new Date().getMonth());
    expect(meses).toBe(3);
  });

  it("a cortesia vence sozinha e a conta volta a ser grátis", async () => {
    await criarCupom({ codigo: "UMMES", desconto: { tipo: "meses_gratis", valor: 1 } });
    const u = await registrar("UMMES");
    expect((await contaDe(u.id)).plan).toBe("pro");

    await User.updateOne({ _id: u.id }, { $set: { cortesiaAte: new Date(Date.now() - 1000) } });
    await request(app).get("/auth/me").set(auth(u.token));

    expect((await contaDe(u.id)).plan).toBe("free");
  });
});

describe("a rota de validação responde antes de cobrar", () => {
  it("devolve o desconto sem expor o parceiro", async () => {
    await criarCupom({
      codigo: "VER",
      desconto: { tipo: "percentual", valor: 15 },
      parceiro: { nome: "Segredo Comercial", comissaoPercentual: 40 },
    });
    const u = await registrar();

    const r = await request(app)
      .get("/billing/cupom/ver?produto=pro&ciclo=mensal")
      .set(auth(u.token));

    expect(r.status).toBe(200);
    expect(r.body.data.descontoCentavos).toBe(449);
    expect(r.body.data.temParceiro).toBe(true);
    // Nome e comissão são combinação comercial: não são da conta de quem compra.
    expect(JSON.stringify(r.body)).not.toContain("Segredo Comercial");
    expect(JSON.stringify(r.body)).not.toContain("40");
  });

  it("a mesma pessoa não usa o mesmo cupom para comprar duas vezes", async () => {
    await criarCupom({ codigo: "UMAVEZ", desconto: { tipo: "percentual", valor: 50 } });
    const u = await registrar();
    await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal", cupom: "UMAVEZ" });
    const a = (await Assinatura.findOne({ user: u.id }))!;
    await webhook({ referencia: a._id.toString(), valorCentavos: 1495 });

    const r = await request(app).get("/billing/cupom/UMAVEZ").set(auth(u.token));

    expect(r.status).toBe(409);
  });
});
