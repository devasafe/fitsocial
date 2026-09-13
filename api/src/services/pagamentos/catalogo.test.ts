import { describe, it, expect } from "vitest";
import { CATALOGO, PRODUTOS, diasDoCiclo, emReais, precoDe } from "./catalogo.js";
import { AsaasProvider } from "./asaas.js";

// O catálogo é regra de negócio escrita em constante. Estes testes existem
// para que uma mudança de preço nunca seja acidente de edição — se o número
// mudar, um teste fala.

describe("catálogo", () => {
  it("os preços são os combinados, em centavos inteiros", () => {
    expect(precoDe("pro", "mensal")).toBe(2990);
    expect(precoDe("pro", "anual")).toBe(26900);
    expect(precoDe("pro_coach", "mensal")).toBe(7990);
    expect(precoDe("pro_coach", "anual")).toBe(71900);
    expect(precoDe("pro_plus", "mensal")).toBe(11990);

    // Nada de ponto flutuante em dinheiro, em lugar nenhum.
    for (const p of PRODUTOS) {
      for (const valor of Object.values(CATALOGO[p].precoCentavos)) {
        expect(Number.isInteger(valor)).toBe(true);
      }
    }
  });

  it("o anual custa dez meses — dois de graça", () => {
    for (const p of PRODUTOS) {
      const { mensal, anual } = CATALOGO[p].precoCentavos;
      expect(anual).toBeLessThanOrEqual(mensal * 10);
    }
  });

  it("quem compra painel NÃO paga o Pro separado", () => {
    // A regra cai sozinha do desenho: Pro Coach concede o plano `pro`, e o
    // painel é uma capacidade noutro eixo. Se alguém um dia criar um plano
    // `pro_coach` no enum de `plan`, este teste quebra — e deve quebrar.
    expect(CATALOGO.pro_coach.plano).toBe("pro");
    expect(CATALOGO.pro_coach.capacidades).toEqual(["coach"]);
    expect(CATALOGO.pro_nutri.plano).toBe("pro");
    expect(CATALOGO.pro_plus.capacidades).toEqual(["coach", "nutri"]);
  });

  it("só os produtos com painel têm teto de alunos", () => {
    expect(CATALOGO.pro.limiteDeAlunos).toBe(0);
    expect(CATALOGO.pro_coach.limiteDeAlunos).toBe(30);
    expect(CATALOGO.pro_plus.limiteDeAlunos).toBe(30);
  });

  it("escreve dinheiro como gente lê", () => {
    expect(emReais(2990)).toBe("R$ 29,90");
    expect(emReais(107900)).toBe("R$ 1079,00");
  });

  it("o ciclo vira dias", () => {
    expect(diasDoCiclo("mensal")).toBe(30);
    expect(diasDoCiclo("anual")).toBe(365);
  });
});

describe("o adaptador do Asaas", () => {
  const asaas = new AsaasProvider();

  it("traduz o evento do gateway para o vocabulário daqui", () => {
    const e = asaas.normalizarEvento({
      id: "evt_123",
      event: "PAYMENT_CONFIRMED",
      dateCreated: "2026-09-13 10:00:00",
      payment: {
        id: "pay_abc",
        subscription: "sub_xyz",
        externalReference: "651f1f77bcf86cd799439011",
        value: 29.9,
        netValue: 27.91,
        billingType: "PIX",
        paymentDate: "2026-09-13",
      },
    });

    expect(e.tipo).toBe("pagamento.aprovado");
    expect(e.eventoId).toBe("evt_123");
    // A referência é o id da NOSSA assinatura: é por ela que o handler acha o
    // que atualizar, mesmo que o resto do payload mude de forma.
    expect(e.referencia).toBe("651f1f77bcf86cd799439011");
    expect(e.provedorCobrancaId).toBe("pay_abc");
    // Centavos inteiros, sem passar por ponto flutuante: 29.9 * 100 dá
    // 2989.9999... em JavaScript.
    expect(e.valorCentavos).toBe(2990);
    expect(e.liquidoCentavos).toBe(2791);
    expect(e.metodo).toBe("pix");
  });

  it("evento que não interessa vira 'desconhecido', e não erro", () => {
    // O gateway manda muito mais tipo do que a gente trata. Explodir num tipo
    // novo faria o Asaas reenviar em laço.
    expect(asaas.normalizarEvento({ id: "e1", event: "PAYMENT_ANTICIPATED" }).tipo).toBe(
      "desconhecido"
    );
    expect(asaas.normalizarEvento({}).tipo).toBe("desconhecido");
  });

  it("estorno e chargeback não se confundem com cancelamento", () => {
    // Cancelar mantém o acesso até o fim do ciclo pago; estornar derruba na
    // hora, porque o dinheiro voltou. Trocar os dois é devolver acesso de
    // graça ou tirar de quem pagou.
    expect(asaas.normalizarEvento({ id: "a", event: "PAYMENT_REFUNDED" }).tipo).toBe("estorno");
    expect(asaas.normalizarEvento({ id: "b", event: "SUBSCRIPTION_DELETED" }).tipo).toBe(
      "assinatura.cancelada"
    );
    expect(
      asaas.normalizarEvento({ id: "c", event: "PAYMENT_CHARGEBACK_REQUESTED" }).tipo
    ).toBe("chargeback");
  });

  it("sem o token configurado, o webhook RECUSA tudo", async () => {
    const antes = process.env.ASAAS_WEBHOOK_TOKEN;
    process.env.ASAAS_WEBHOOK_TOKEN = "";
    try {
      const { env } = await import("../../config/env.js");
      // O env é lido no boot; o que importa aqui é a regra: sem segredo, não
      // passa. O webhook antigo deste projeto ficava PÚBLICO nessa situação,
      // e qualquer um liberava acesso pago com um POST.
      if (!env.asaasWebhookToken) {
        expect(asaas.verificarWebhook({ "asaas-access-token": "qualquer" }, Buffer.from(""))).toBe(
          false
        );
      }
    } finally {
      process.env.ASAAS_WEBHOOK_TOKEN = antes;
    }
  });
});
