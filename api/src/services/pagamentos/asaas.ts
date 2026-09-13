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
// Por que Asaas: recebe com CPF, faz recorrência de verdade (gera e cobra
// sozinho todo ciclo, e avisa quem não pagou), e cobra R$ 1,99 fixo no PIX,
// 0% — contra 8,3% da alternativa mais próxima num ticket de R$ 29,90. Num
// produto barato, taxa fixa é o que decide.

/** De como o Asaas chama as coisas para como a gente chama. */
const TIPOS: Record<string, TipoDeEvento> = {
  PAYMENT_CONFIRMED: "pagamento.aprovado",
  PAYMENT_RECEIVED: "pagamento.aprovado",
  PAYMENT_CREATED: "desconhecido",
  PAYMENT_OVERDUE: "pagamento.falhou",
  PAYMENT_DELETED: "assinatura.cancelada",
  PAYMENT_REFUNDED: "estorno",
  PAYMENT_CHARGEBACK_REQUESTED: "chargeback",
  PAYMENT_CHARGEBACK_DISPUTE: "chargeback",
  SUBSCRIPTION_DELETED: "assinatura.cancelada",
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

  async criarCheckout(pedido: PedidoDeCheckout): Promise<CheckoutCriado> {
    // O cliente primeiro: o Asaas amarra a assinatura a um cliente dele.
    const cliente = (await this.chamar("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: pedido.cliente.nome,
        email: pedido.cliente.email,
        externalReference: pedido.cliente.id,
      }),
    })) as { id: string };

    const dias = diasDoCiclo(pedido.ciclo);
    const assinatura = (await this.chamar("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customer: cliente.id,
        billingType: "UNDEFINED", // a pessoa escolhe PIX, cartão ou boleto
        value: pedido.valorCentavos / 100,
        cycle: pedido.ciclo === "anual" ? "YEARLY" : "MONTHLY",
        nextDueDate: new Date(Date.now() + 0).toISOString().slice(0, 10),
        description: pedido.descricao,
        // Volta em todo evento de webhook. É por ela que o handler acha a
        // nossa `Assinatura` mesmo quando o resto do payload muda de forma.
        externalReference: pedido.referencia,
      }),
    })) as { id: string; invoiceUrl?: string };

    // A primeira cobrança da assinatura é onde a pessoa paga.
    const cobrancas = (await this.chamar(
      `/payments?subscription=${encodeURIComponent(assinatura.id)}&limit=1`
    )) as { data?: { invoiceUrl?: string }[] };

    const url = cobrancas.data?.[0]?.invoiceUrl ?? assinatura.invoiceUrl;
    if (!url) throw new Error("Asaas não devolveu a URL de pagamento.");

    void dias;
    return {
      urlDeCheckout: url,
      provedorAssinaturaId: assinatura.id,
      provedorClienteId: cliente.id,
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

  normalizarEvento(corpo: unknown): EventoNormalizado {
    const c = (corpo ?? {}) as {
      id?: string;
      event?: string;
      dateCreated?: string;
      payment?: Record<string, unknown>;
    };
    const p = (c.payment ?? {}) as Record<string, unknown>;

    return {
      tipo: TIPOS[c.event ?? ""] ?? "desconhecido",
      // O Asaas manda `id` do evento; sem ele não há idempotência possível, e
      // o handler recusa em vez de arriscar processar duas vezes.
      eventoId: String(c.id ?? ""),
      referencia: typeof p.externalReference === "string" ? p.externalReference : null,
      provedorAssinaturaId: typeof p.subscription === "string" ? p.subscription : null,
      provedorCobrancaId: typeof p.id === "string" ? p.id : null,
      valorCentavos: emCentavos(p.value),
      // `netValue` é o que sobra depois da taxa — é ele que bate com o extrato.
      liquidoCentavos: emCentavos(p.netValue),
      metodo: METODOS[String(p.billingType ?? "")] ?? null,
      pagoEm: comoData(p.paymentDate ?? p.confirmedDate),
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
