import { env } from "../../config/env.js";
import { diasDoCiclo } from "./catalogo.js";
import type {
  CheckoutCriado,
  EventoNormalizado,
  IProvedorDePagamento,
  PedidoDeCheckout,
  TipoDeEvento,
} from "./provider.js";
import type { Provedor } from "../../models/Assinatura.js";

// O Asaas.
//
// HTTP puro, sem SDK — a mesma escolha do webhook do RevenueCat
// (`routes/billing.ts`), e pelo mesmo motivo: a superfície que a gente usa é
// pequena, e um SDK a mais é uma dependência a mais para atualizar, auditar e
// carregar na imagem.
//
// Por que Asaas: recebe com CPF (sem exigir CNPJ), faz recorrência de verdade
// — gera e cobra sozinho todo ciclo, e avisa quem não pagou — e não tem
// mensalidade nem adesão: só se paga quando se recebe.
//
// POR QUE CARTÃO, e não PIX. A recorrência do Asaas é de cartão e só de
// cartão: o próprio gateway recusa `chargeTypes: RECURRENT` com qualquer outro
// método ("O método de pagamento CREDIT_CARD é o único método de pagamento
// permitido para operações RECURRENT"). PIX ali é sempre avulso, o que
// obrigaria a pessoa a pagar de novo, na mão, todo mês — e assinatura que
// depende de alguém lembrar não é assinatura.
//
// E a conta fecha a favor do cartão mesmo assim. Num ticket de R$ 29,90:
// cartão em assinatura sai por 2,99% + R$ 0,49 = R$ 1,38, contra R$ 1,99
// fixos do PIX. A taxa fixa do PIX só passa a compensar em ticket alto, que
// não é o do plano que mais vai vender.

/** De como o Asaas chama as coisas para como a gente chama. */
const TIPOS: Record<string, TipoDeEvento> = {
  PAYMENT_CONFIRMED: "pagamento.aprovado",
  PAYMENT_RECEIVED: "pagamento.aprovado",
  // Não é dinheiro: é a fatura sendo emitida. Vale pelo que ela carrega — o id
  // da assinatura no gateway, que o evento de checkout não traz.
  PAYMENT_CREATED: "cobranca.criada",
  PAYMENT_OVERDUE: "pagamento.falhou",
  PAYMENT_DELETED: "assinatura.cancelada",
  PAYMENT_REFUNDED: "estorno",
  PAYMENT_CHARGEBACK_REQUESTED: "chargeback",
  PAYMENT_CHARGEBACK_DISPUTE: "chargeback",
  SUBSCRIPTION_DELETED: "assinatura.cancelada",
  CHECKOUT_PAID: "checkout.pago",
  CHECKOUT_EXPIRED: "checkout.expirado",
  CHECKOUT_CANCELED: "checkout.expirado",
  CHECKOUT_CREATED: "desconhecido",
};

/** O que o Asaas chama de billingType, no nosso vocabulário. */
const METODOS: Record<string, "pix" | "cartao" | "boleto"> = {
  PIX: "pix",
  CREDIT_CARD: "cartao",
  BOLETO: "boleto",
  UNDEFINED: "pix",
};

/** Reais com centavos → centavos inteiros, sem passar por ponto flutuante. */
function emCentavos(valor: unknown): number | null {
  if (typeof valor !== "number") return null;
  return Math.round(valor * 100);
}

function comoData(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v.length <= 10 ? `${v}T12:00:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class AsaasProvider implements IProvedorDePagamento {
  readonly nome: Provedor = "asaas";

  private async chamar(caminho: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${env.asaasApiUrl}${caminho}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        access_token: env.asaasApiKey,
        ...(init.headers ?? {}),
      },
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) {
      const erro = (corpo as { errors?: { description?: string }[] }).errors?.[0]?.description;
      throw new Error(erro || `Asaas respondeu ${res.status}`);
    }
    return corpo;
  }

  /**
   * Abre uma sessão de checkout HOSPEDADA pelo Asaas.
   *
   * Foi tentado antes o caminho direto — criar o cliente e a assinatura pela
   * API — e ele não fecha: o Asaas aceita criar um cliente sem CPF, mas recusa
   * a cobrança desse cliente ("Para criar esta cobrança é necessário preencher
   * o CPF ou CNPJ do cliente"). O RUMO não pede CPF em lugar nenhum, então
   * aquele caminho quebraria no primeiro pagamento de verdade.
   *
   * O checkout hospedado resolve por cima: a tela deles coleta CPF, telefone e
   * endereço do pagador, e nada disso passa por aqui nem é gravado — que é o
   * desfecho certo para dado que a gente não precisa guardar.
   *
   * Por isso `customerData` NÃO é enviado: ele é tudo-ou-nada — mandar o nome
   * obriga a mandar CPF, telefone e endereço completos, exatamente o que não
   * se tem.
   */
  async criarCheckout(pedido: PedidoDeCheckout): Promise<CheckoutCriado> {
    void diasDoCiclo;
    const volta = `${env.appPublicUrl}/assinatura`;

    const checkout = (await this.chamar("/checkouts", {
      method: "POST",
      body: JSON.stringify({
        // Cartão porque é o ÚNICO que o Asaas aceita em recorrência.
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        // O teto do Asaas é 1440 (24h). Link expirado não é problema: a pessoa
        // clica em assinar de novo e sai um novo.
        minutesToExpire: 1440,
        callback: {
          successUrl: `${volta}?status=ok`,
          cancelUrl: `${volta}?status=cancelado`,
          expiredUrl: `${volta}?status=expirado`,
        },
        items: [
          {
            name: pedido.descricao,
            description: pedido.descricao,
            quantity: 1,
            value: pedido.valorCentavos / 100,
          },
        ],
        subscription: {
          cycle: pedido.ciclo === "anual" ? "YEARLY" : "MONTHLY",
          nextDueDate: `${new Date().toISOString().slice(0, 10)} 12:00:00`,
        },
        // Volta em todo evento de webhook, e o Asaas a propaga do checkout
        // para a assinatura e desta para cada cobrança. É por ela que o
        // handler acha a nossa `Assinatura` sem depender do formato do resto.
        externalReference: pedido.referencia,
      }),
    })) as { id?: string; link?: string };

    if (!checkout.link) throw new Error("Asaas não devolveu a URL de pagamento.");

    // Nem a assinatura nem o cliente existem ainda: os dois nascem quando o
    // cartão passa. Até lá, quem amarra o evento à nossa `Assinatura` é a
    // sessão de checkout.
    return {
      urlDeCheckout: checkout.link,
      provedorAssinaturaId: null,
      provedorClienteId: null,
      provedorCheckoutId: checkout.id ?? null,
    };
  }

  /**
   * O Asaas não assina o corpo: ele manda um token fixo no cabeçalho
   * `asaas-access-token`, que a gente configura no painel deles.
   *
   * Comparação em tempo constante para a verificação não virar um oráculo de
   * adivinhação byte a byte. E recusa dura quando o segredo não está
   * configurado: o webhook anterior deste projeto ficava PÚBLICO quando a env
   * estava vazia, o que é pior que não ter webhook.
   */
  verificarWebhook(cabecalhos: Record<string, unknown>, _corpoCru: Buffer): boolean {
    const esperado = env.asaasWebhookToken;
    if (!esperado) return false;

    const recebido = cabecalhos["asaas-access-token"];
    if (typeof recebido !== "string" || recebido.length !== esperado.length) return false;

    let diferenca = 0;
    for (let i = 0; i < esperado.length; i++) {
      diferenca |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
    }
    return diferenca === 0;
  }

  /**
   * O Asaas manda DOIS formatos, e é preciso ler os dois.
   *
   * Evento de cobrança traz `payment`; evento de checkout traz `checkout`, com
   * campos diferentes — nele não existe `subscription` como id, e o cliente
   * vem numa chave própria. Tratar só o primeiro faria todo `CHECKOUT_PAID`
   * chegar sem referência e ser descartado em silêncio.
   */
  normalizarEvento(corpo: unknown): EventoNormalizado {
    const c = (corpo ?? {}) as {
      id?: string;
      event?: string;
      dateCreated?: string;
      payment?: Record<string, unknown>;
      checkout?: Record<string, unknown>;
    };
    const p = (c.payment ?? {}) as Record<string, unknown>;
    const k = (c.checkout ?? {}) as Record<string, unknown>;
    const deCheckout = Boolean(c.checkout);

    const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

    return {
      tipo: TIPOS[c.event ?? ""] ?? "desconhecido",
      // O Asaas manda `id` do evento; sem ele não há idempotência possível, e
      // o handler recusa em vez de arriscar processar duas vezes.
      eventoId: String(c.id ?? ""),
      referencia: texto(deCheckout ? k.externalReference : p.externalReference),
      provedorAssinaturaId: deCheckout ? null : texto(p.subscription),
      provedorCobrancaId: deCheckout ? null : texto(p.id),
      provedorCheckoutId: deCheckout ? texto(k.id) : null,
      // No checkout o cliente vem como id solto; na cobrança, na chave própria.
      provedorClienteId: texto(deCheckout ? k.customer : p.customer),
      valorCentavos: deCheckout ? null : emCentavos(p.value),
      // `netValue` é o que sobra depois da taxa — é ele que bate com o extrato.
      liquidoCentavos: deCheckout ? null : emCentavos(p.netValue),
      metodo: deCheckout ? null : (METODOS[String(p.billingType ?? "")] ?? null),
      pagoEm: deCheckout ? null : comoData(p.paymentDate ?? p.confirmedDate),
      ocorridoEm: comoData(c.dateCreated),
    };
  }

  async cancelarAssinatura(provedorAssinaturaId: string, aoFimDoCiclo: boolean): Promise<void> {
    // O Asaas não tem "cancelar ao fim do ciclo": apagar a assinatura só para
    // as cobranças FUTURAS, e a já paga continua valendo até o vencimento.
    // Quem cuida de manter o acesso até lá é o nosso `validoAte`.
    void aoFimDoCiclo;
    await this.chamar(`/subscriptions/${encodeURIComponent(provedorAssinaturaId)}`, {
      method: "DELETE",
    });
  }

  /**
   * De qual checkout esta assinatura nasceu.
   *
   * A assinatura do Asaas guarda `checkoutSession` — o id da sessão que a
   * originou — e também herda o `externalReference`. Qualquer um dos dois
   * resolve, e é por isso que os dois voltam: se a herança da referência
   * falhar, a sessão ainda amarra.
   *
   * Uma chamada a mais, e só no caminho em que o evento chegou sem referência.
   * O caro é o contrário: um pagamento confirmado que não acha dono é dinheiro
   * recebido sem acesso liberado, e a pessoa reclamando.
   */
  async resolverOrigem(
    provedorAssinaturaId: string
  ): Promise<{ referencia: string | null; provedorCheckoutId: string | null } | null> {
    try {
      const a = (await this.chamar(
        `/subscriptions/${encodeURIComponent(provedorAssinaturaId)}`
      )) as { externalReference?: unknown; checkoutSession?: unknown };
      const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
      return {
        referencia: texto(a.externalReference),
        provedorCheckoutId: texto(a.checkoutSession),
      };
    } catch {
      return null;
    }
  }

  /** A assinatura ativa deste cliente, se houver. Ver o contrato. */
  async assinaturaDoCliente(provedorClienteId: string): Promise<string | null> {
    try {
      const r = (await this.chamar(
        `/subscriptions?customer=${encodeURIComponent(provedorClienteId)}&status=ACTIVE&limit=1`
      )) as { data?: { id?: unknown }[] };
      const id = r.data?.[0]?.id;
      return typeof id === "string" && id ? id : null;
    } catch {
      return null;
    }
  }

  async consultarAssinatura(
    provedorAssinaturaId: string
  ): Promise<{ status: string; validoAte: Date | null } | null> {
    try {
      const a = (await this.chamar(
        `/subscriptions/${encodeURIComponent(provedorAssinaturaId)}`
      )) as { status?: string; nextDueDate?: string };
      return { status: String(a.status ?? "").toLowerCase(), validoAte: comoData(a.nextDueDate) };
    } catch {
      return null;
    }
  }
}
