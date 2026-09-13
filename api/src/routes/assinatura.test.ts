import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Assinatura } from "../models/Assinatura.js";
import { Cobranca } from "../models/Cobranca.js";
import { EventoDeCobranca } from "../models/EventoDeCobranca.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { setProvedorDePagamento } from "../services/pagamentos/index.js";
import type {
  CheckoutCriado,
  EventoNormalizado,
  IProvedorDePagamento,
  PedidoDeCheckout,
} from "../services/pagamentos/provider.js";

// A compra, de ponta a ponta, sem falar com o Asaas.
//
// O dublê existe porque o que precisa ser provado aqui não é a API deles — é o
// que ACONTECE com os direitos quando o dinheiro se move, e o que acontece
// quando o gateway reenvia, reordena ou mente.

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Um gateway de mentira que registra o que foi pedido a ele. */
class ProvedorDeMentira implements IProvedorDePagamento {
  readonly nome = "asaas" as const;
  ultimoPedido: PedidoDeCheckout | null = null;

  /**
   * Espelha o checkout HOSPEDADO, que é como o Asaas funciona de verdade: na
   * criação só existe a sessão. A assinatura e o cliente do gateway nascem
   * quando o cartão passa, e chegam no primeiro evento.
   */
  async criarCheckout(p: PedidoDeCheckout): Promise<CheckoutCriado> {
    this.ultimoPedido = p;
    return {
      urlDeCheckout: `https://pagamento.exemplo/${p.referencia}`,
      provedorAssinaturaId: null,
      provedorClienteId: null,
      provedorCheckoutId: `chk_${p.referencia}`,
    };
  }
  verificarWebhook(cabecalhos: Record<string, unknown>): boolean {
    return cabecalhos["asaas-access-token"] === "segredo-certo";
  }
  normalizarEvento(corpo: unknown): EventoNormalizado {
    return corpo as EventoNormalizado;
  }
  async cancelarAssinatura(): Promise<void> {}
  async consultarAssinatura() {
    return null;
  }

  /** O que o gateway responde quando se pergunta de onde veio uma assinatura. */
  origens = new Map<string, { referencia: string | null; provedorCheckoutId: string | null }>();
  perguntasDeOrigem = 0;

  async resolverOrigem(id: string) {
    this.perguntasDeOrigem += 1;
    return this.origens.get(id) ?? null;
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
    Assinatura.deleteMany({}),
    Cobranca.deleteMany({}),
    EventoDeCobranca.deleteMany({}),
    ProfessionalLink.deleteMany({}),
  ]);
  dublê = new ProvedorDeMentira();
  setProvedorDePagamento(dublê);
});

let n = 0;
async function registrar() {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `P${n}`, email: `as${n}@teste.com`, password: "senha-bem-longa" });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

/** Manda um evento como o gateway mandaria, já normalizado pelo dublê. */
type EventoDeTeste = Partial<Omit<EventoNormalizado, "pagoEm" | "ocorridoEm">> & {
  // Strings, e não Date: é o que o gateway manda de verdade, e o que o dublê
  // devolve sem tratar — testar com Date já pronto esconderia o passo da
  // conversão.
  pagoEm?: string;
  ocorridoEm?: string;
};

function webhook(evento: EventoDeTeste, token = "segredo-certo") {
  return request(app)
    .post("/billing/webhook/asaas")
    .set("asaas-access-token", token)
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ tipo: "pagamento.aprovado", eventoId: "e1", ...evento }));
}

const contaDe = async (id: string) => (await User.findById(id))!;

describe("o catálogo é público e vem do servidor", () => {
  it("lista os produtos com preço formatado", async () => {
    const r = await request(app).get("/billing/produtos");

    expect(r.status).toBe(200);
    const pro = r.body.data.find((p: { produto: string }) => p.produto === "pro");
    expect(pro.precoCentavos.mensal).toBe(2990);
    expect(pro.precoFormatado.mensal).toBe("R$ 29,90");
    // Preço na tela vem daqui, nunca escrito no aplicativo.
    const coach = r.body.data.find((p: { produto: string }) => p.produto === "pro_coach");
    expect(coach.limiteDeAlunos).toBe(30);
  });
});

describe("checkout", () => {
  it("cria a assinatura pendente ANTES de chamar o gateway, e manda o nosso id", async () => {
    const u = await registrar();

    const r = await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal" });

    expect(r.status).toBe(201);
    expect(r.body.data.urlDeCheckout).toContain("https://");

    const a = (await Assinatura.findOne({ user: u.id }))!;
    expect(a.status).toBe("pendente");
    expect(a.precoCentavos).toBe(2990);
    // A referência é o NOSSO id: é ela que torna o webhook resolvível mesmo
    // quando o provedor perde o resto do metadata.
    expect(dublê.ultimoPedido?.referencia).toBe(a._id.toString());
  });

  it("quem já tem assinatura ativa não abre outra", async () => {
    const u = await registrar();
    await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro", ciclo: "mensal" });
    const a = (await Assinatura.findOne({ user: u.id }))!;
    await webhook({ referencia: a._id.toString() });

    const r = await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro_plus", ciclo: "anual" });

    expect(r.status).toBe(409);
  });

  it("produto inventado é recusado na borda", async () => {
    const u = await registrar();
    const r = await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro_infinito", ciclo: "mensal" });
    expect(r.status).toBe(400);
  });
});

describe("webhook", () => {
  async function comAssinatura(produto = "pro", ciclo = "mensal") {
    const u = await registrar();
    await request(app).post("/billing/checkout").set(auth(u.token)).send({ produto, ciclo });
    const a = (await Assinatura.findOne({ user: u.id }))!;
    return { u, a };
  }

  it("sem o segredo certo, RECUSA", async () => {
    const { a } = await comAssinatura();

    const r = await webhook({ referencia: a._id.toString() }, "chute");

    expect(r.status).toBe(401);
    // E nada foi aplicado: liberar acesso pago para quem manda um POST seria o
    // pior buraco possível.
    expect((await Assinatura.findById(a._id))!.status).toBe("pendente");
  });

  it("pagamento aprovado libera o acesso e grava a cobrança", async () => {
    const { u, a } = await comAssinatura();

    const r = await webhook({
      referencia: a._id.toString(),
      provedorCobrancaId: "pay_1",
      valorCentavos: 2990,
      liquidoCentavos: 2791,
      metodo: "pix",
      pagoEm: new Date().toISOString(),
      ocorridoEm: new Date().toISOString(),
    });

    expect(r.status).toBe(200);
    expect((await Assinatura.findById(a._id))!.status).toBe("ativa");
    expect((await contaDe(u.id)).tier).toBe("premium");

    const c = (await Cobranca.findOne({ assinatura: a._id }))!;
    expect(c.status).toBe("paga");
    // O líquido é o que bate com o extrato; sem ele o relatório conta o bruto
    // e nunca fecha com o banco.
    expect(c.liquidoCentavos).toBe(2791);
  });

  it("o MESMO evento duas vezes não credita dois meses", async () => {
    const { a } = await comAssinatura();
    const evento = { referencia: a._id.toString(), eventoId: "repetido", provedorCobrancaId: "p1" };

    await webhook(evento);
    const primeiro = (await Assinatura.findById(a._id))!.validoAte!;

    const r = await webhook(evento);

    expect(r.status).toBe(200);
    expect((await Assinatura.findById(a._id))!.validoAte!.getTime()).toBe(primeiro.getTime());
    // Uma cobrança, não duas: o relatório de receita contaria o dobro.
    expect(await Cobranca.countDocuments({ assinatura: a._id })).toBe(1);
    expect(await EventoDeCobranca.countDocuments()).toBe(1);
  });

  it("evento fora de ordem não ressuscita assinatura cancelada", async () => {
    const { u, a } = await comAssinatura();
    const agora = new Date();
    const antes = new Date(agora.getTime() - 60_000);

    await webhook({ referencia: a._id.toString(), eventoId: "e1", ocorridoEm: agora.toISOString() });
    await webhook({
      referencia: a._id.toString(),
      eventoId: "e2",
      tipo: "estorno",
      ocorridoEm: agora.toISOString(),
    });
    expect((await contaDe(u.id)).tier).toBe("free");

    // O "renovou" atrasado chega DEPOIS do estorno, mas aconteceu ANTES.
    await webhook({
      referencia: a._id.toString(),
      eventoId: "e3",
      tipo: "assinatura.renovada",
      ocorridoEm: antes.toISOString(),
    });

    expect((await Assinatura.findById(a._id))!.status).toBe("estornada");
    expect((await contaDe(u.id)).tier).toBe("free");
  });

  it("cobrança que falha NÃO derruba o acesso na hora", async () => {
    const { u, a } = await comAssinatura();
    await webhook({ referencia: a._id.toString(), eventoId: "ok" });

    await webhook({ referencia: a._id.toString(), eventoId: "falhou", tipo: "pagamento.falhou" });

    // Cartão vencido é a causa nº 1 de recusa, e acontece com quem QUER pagar.
    // A carência de 7 dias do motor é que decide quando cai.
    const conta = await contaDe(u.id);
    expect(conta.assinaturaStatus).toBe("inadimplente");
    expect(conta.tier).toBe("premium");
  });

  it("cancelar mantém o acesso até o fim do ciclo; estornar derruba na hora", async () => {
    const cancelada = await comAssinatura();
    await webhook({ referencia: cancelada.a._id.toString(), eventoId: "c1" });
    await webhook({
      referencia: cancelada.a._id.toString(),
      eventoId: "c2",
      tipo: "assinatura.cancelada",
    });
    // Comprou o mês; o mês é dele.
    expect((await contaDe(cancelada.u.id)).tier).toBe("premium");

    const estornada = await comAssinatura();
    await webhook({ referencia: estornada.a._id.toString(), eventoId: "e1" });
    await webhook({ referencia: estornada.a._id.toString(), eventoId: "e2", tipo: "estorno" });
    // O dinheiro voltou; o acesso vai junto.
    expect((await contaDe(estornada.u.id)).tier).toBe("free");
  });

  it("evento de tipo desconhecido é aceito e ignorado, nunca erro", async () => {
    const { a } = await comAssinatura();

    const r = await webhook({ referencia: a._id.toString(), tipo: "desconhecido" });

    // Explodir faria o gateway reenviar em laço para sempre.
    expect(r.status).toBe(200);
    expect((await EventoDeCobranca.findOne())!.resultado).toBe("ignorado");
  });
});

describe("comprar o painel", () => {
  it("Pro Coach concede a capacidade e o Pro completo, sem cobrar duas vezes", async () => {
    const u = await registrar();
    await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro_coach", ciclo: "anual" });
    const a = (await Assinatura.findOne({ user: u.id }))!;

    await webhook({ referencia: a._id.toString() });

    const conta = await contaDe(u.id);
    expect(conta.tier).toBe("premium");
    expect(conta.get("pro.coach.ativo")).toBe(true);
    expect(conta.get("pro.coach.origem")).toBe("gateway");
    expect(conta.get("pro.coach.limiteDeAlunos")).toBe(30);
    // E não virou nutri de brinde.
    expect(conta.get("pro.nutri.ativo")).toBe(false);
  });

  it("o estorno tira o painel junto", async () => {
    const u = await registrar();
    await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro_coach", ciclo: "mensal" });
    const a = (await Assinatura.findOne({ user: u.id }))!;
    await webhook({ referencia: a._id.toString(), eventoId: "p1" });

    await webhook({ referencia: a._id.toString(), eventoId: "p2", tipo: "estorno" });

    expect((await contaDe(u.id)).get("pro.coach.ativo")).toBe(false);
  });

  it("a cortesia do admin NÃO é sobrescrita pela compra", async () => {
    // Precedência que já existia: o painel ganha do gateway. Uma compra não
    // pode encurtar o prazo de uma capacidade que o admin deu à mão.
    const u = await registrar();
    await User.updateOne(
      { _id: u.id },
      { $set: { "pro.coach": { ativo: true, origem: "manual", limiteDeAlunos: 500 } } }
    );

    await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto: "pro_coach", ciclo: "mensal" });
    const a = (await Assinatura.findOne({ user: u.id }))!;
    await webhook({ referencia: a._id.toString() });

    const conta = await contaDe(u.id);
    expect(conta.get("pro.coach.origem")).toBe("manual");
    expect(conta.get("pro.coach.limiteDeAlunos")).toBe(500);
  });
});

describe("checkout hospedado: a assinatura do gateway só nasce ao pagar", () => {
  /** Abre o checkout e devolve a nossa `Assinatura`, ainda pendente. */
  async function abrirCheckout(produto = "pro") {
    const u = await registrar();
    await request(app)
      .post("/billing/checkout")
      .set(auth(u.token))
      .send({ produto, ciclo: "mensal" });
    return { u, a: (await Assinatura.findOne({ user: u.id }))! };
  }

  it("guarda a sessão de checkout, que é o único id que existe antes do pagamento", async () => {
    const { a } = await abrirCheckout();

    expect(a.provedorCheckoutId).toBe(`chk_${a._id.toString()}`);
    // Nem assinatura nem cliente ainda: os dois nascem quando o cartão passa.
    expect(a.provedorAssinaturaId).toBeFalsy();
    expect(a.provedorClienteId).toBeFalsy();
  });

  it("carimba a assinatura e o cliente do gateway no primeiro evento que os traz", async () => {
    const { a } = await abrirCheckout();

    await webhook({
      referencia: a._id.toString(),
      provedorAssinaturaId: "sub_asaas_1",
      provedorClienteId: "cus_asaas_1",
      eventoId: "e-carimbo",
    });

    const depois = (await Assinatura.findById(a._id))!;
    // Sem isto o botão de cancelar não teria o que chamar no gateway, e o
    // cartão da pessoa continuaria sendo cobrado todo mês.
    expect(depois.provedorAssinaturaId).toBe("sub_asaas_1");
    expect(depois.provedorClienteId).toBe("cus_asaas_1");
  });

  it("acha a assinatura pela sessão de checkout quando o evento não traz a referência", async () => {
    const { u, a } = await abrirCheckout();

    await webhook({
      referencia: null,
      provedorCheckoutId: `chk_${a._id.toString()}`,
      eventoId: "e-por-checkout",
    });

    expect((await Assinatura.findById(a._id))!.status).toBe("ativa");
    expect((await contaDe(u.id)).plan).toBe("pro");
  });

  it("pergunta ao gateway de onde veio a assinatura quando nada mais resolve", async () => {
    const { u, a } = await abrirCheckout();
    // O caso real: o evento de cobrança chega ANTES do CHECKOUT_PAID, com uma
    // assinatura do gateway que a gente nunca viu e sem a nossa referência.
    dublê.origens.set("sub_desconhecida", {
      referencia: null,
      provedorCheckoutId: `chk_${a._id.toString()}`,
    });

    await webhook({
      referencia: null,
      provedorAssinaturaId: "sub_desconhecida",
      eventoId: "e-orfao",
    });

    expect(dublê.perguntasDeOrigem).toBe(1);
    // Sem este degrau o evento seria descartado em silêncio: alguém teria
    // pagado e não receberia acesso nenhum.
    expect((await Assinatura.findById(a._id))!.status).toBe("ativa");
    expect((await contaDe(u.id)).plan).toBe("pro");
  });

  it("não pergunta ao gateway quando a referência já resolveu", async () => {
    const { a } = await abrirCheckout();

    await webhook({ referencia: a._id.toString(), eventoId: "e-direto" });

    // A pergunta custa uma chamada de rede dentro do webhook: ela só pode
    // acontecer no caminho em que todo o resto falhou.
    expect(dublê.perguntasDeOrigem).toBe(0);
  });

  it("CHECKOUT_PAID sozinho NÃO libera acesso", async () => {
    const { u, a } = await abrirCheckout();

    await webhook({
      tipo: "checkout.pago",
      referencia: a._id.toString(),
      provedorClienteId: "cus_9",
      eventoId: "e-chk-pago",
    });

    // "Concluiu o checkout" não é "o dinheiro entrou" — o cartão ainda pode
    // ser recusado. Quem libera é o pagamento confirmado.
    expect((await Assinatura.findById(a._id))!.status).toBe("pendente");
    expect((await contaDe(u.id)).plan).toBe("free");
    // Mas o id do cliente foi aproveitado.
    expect((await Assinatura.findById(a._id))!.provedorClienteId).toBe("cus_9");
  });

  it("checkout expirado derruba a pendente e não encosta na que já está ativa", async () => {
    const { a } = await abrirCheckout();
    await webhook({
      tipo: "checkout.expirado",
      referencia: a._id.toString(),
      eventoId: "e-exp-1",
    });
    expect((await Assinatura.findById(a._id))!.status).toBe("expirada");

    const outra = await abrirCheckout();
    await webhook({ referencia: outra.a._id.toString(), eventoId: "e-pago" });
    await webhook({
      tipo: "checkout.expirado",
      referencia: outra.a._id.toString(),
      eventoId: "e-exp-2",
      ocorridoEm: new Date(Date.now() + 60_000).toISOString(),
    });

    // Um link velho expirando não pode rebaixar quem já pagou.
    expect((await Assinatura.findById(outra.a._id))!.status).toBe("ativa");
    expect((await contaDe(outra.u.id)).plan).toBe("pro");
  });
});
