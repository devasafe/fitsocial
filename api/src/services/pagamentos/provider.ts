import type { Ciclo, Produto } from "./catalogo.js";
import type { Provedor } from "../../models/Assinatura.js";

// O contrato que todo gateway cumpre.
//
// Mesmo formato de `services/ai/provider.ts` e `services/storage/provider.ts`:
// uma interface, um arquivo por provedor, uma fábrica. O projeto já troca de
// provedor de IA e de armazenamento sem que nada acima saiba — cobrança é o
// terceiro caso, e o mais caro de errar.
//
// A escolha do gateway foi Asaas. Mas ela foi tomada sabendo que pode mudar:
// enquanto for pequeno, uma plataforma que emite nota (Cakto) compete de perto;
// passando de umas dezenas de assinantes, o Asaas ganha com folga. O adaptador
// é o que faz essa migração ser "escrever uma classe" em vez de "reescrever a
// cobrança" — é o mesmo movimento do `IPaymentProvider` do DROP.

/**
 * O vocabulário de eventos é NOSSO, não o do gateway.
 *
 * Traduzir na fronteira é o que permite Asaas, Cakto e RevenueCat caberem no
 * mesmo handler. Sem isso, o handler vira um `switch` com os nomes de três
 * empresas diferentes, e cada provedor novo o reescreve.
 */
export type TipoDeEvento =
  | "pagamento.aprovado"
  | "pagamento.falhou"
  | "assinatura.renovada"
  | "assinatura.cancelada"
  | "estorno"
  | "chargeback"
  // A pessoa concluiu o checkout. NÃO libera acesso — quem libera é o dinheiro
  // confirmado. Serve para carimbar os ids que só passam a existir agora.
  | "checkout.pago"
  | "checkout.expirado"
  | "desconhecido";

export interface EventoNormalizado {
  tipo: TipoDeEvento;
  /** O id do evento no provedor — a chave da idempotência. */
  eventoId: string;
  /** A nossa referência, devolvida pelo gateway. É o id da `Assinatura`. */
  referencia: string | null;
  provedorAssinaturaId: string | null;
  provedorCobrancaId: string | null;
  /** A sessão de checkout, quando o evento é de checkout e não de cobrança. */
  provedorCheckoutId: string | null;
  provedorClienteId: string | null;
  valorCentavos: number | null;
  /** O que de fato caiu na conta, já sem a taxa. Nulo quando não informado. */
  liquidoCentavos: number | null;
  metodo: "pix" | "cartao" | "boleto" | null;
  pagoEm: Date | null;
  /** Quando o evento aconteceu no gateway — usado para ignorar fora de ordem. */
  ocorridoEm: Date | null;
}

export interface PedidoDeCheckout {
  /** O id da nossa `Assinatura`. Vai e volta como referência externa. */
  referencia: string;
  produto: Produto;
  ciclo: Ciclo;
  valorCentavos: number;
  descricao: string;
  cliente: { id: string; nome: string; email: string };
}

export interface CheckoutCriado {
  /** Para onde mandar a pessoa. */
  urlDeCheckout: string;
  provedorAssinaturaId: string | null;
  provedorClienteId: string | null;
  /** A sessão de checkout, quando o gateway hospeda a tela de pagamento. */
  provedorCheckoutId: string | null;
}

export interface IProvedorDePagamento {
  readonly nome: Provedor;

  criarCheckout(pedido: PedidoDeCheckout): Promise<CheckoutCriado>;

  /**
   * O corpo veio mesmo do gateway?
   *
   * Recebe os BYTES CRUS, e não o objeto já parseado: assinatura de webhook é
   * calculada sobre os bytes exatos, e `JSON.parse` seguido de re-serialização
   * muda espaçamento e ordem de chaves. Por isso a rota monta `express.raw`
   * antes do `express.json` global — se isso for descoberto depois, todo
   * evento assinado falha na verificação e ninguém entende por quê.
   */
  verificarWebhook(cabecalhos: Record<string, unknown>, corpoCru: Buffer): boolean;

  normalizarEvento(corpo: unknown): EventoNormalizado;

  cancelarAssinatura(provedorAssinaturaId: string, aoFimDoCiclo: boolean): Promise<void>;

  /**
   * Como está esta assinatura NO GATEWAY, agora.
   *
   * Existe para reconciliação. Webhook perdido é a falha número um de todo
   * gateway em produção — e sem uma forma de perguntar, a única saída é
   * descobrir pelo cliente reclamando que pagou e não liberou.
   */
  consultarAssinatura(
    provedorAssinaturaId: string
  ): Promise<{ status: string; validoAte: Date | null } | null>;

  /**
   * De quem é esta assinatura do gateway, quando o evento não disse.
   *
   * Existe por causa do checkout hospedado: a assinatura do Asaas nasce no
   * momento do pagamento, e o primeiro evento de cobrança pode chegar sem a
   * nossa referência — nesse caso a única pista é perguntar ao gateway de qual
   * sessão de checkout aquela assinatura veio.
   *
   * Opcional: um provedor sem checkout hospedado não precisa disto, e o
   * handler simplesmente não chama.
   */
  resolverOrigem?(
    provedorAssinaturaId: string
  ): Promise<{ referencia: string | null; provedorCheckoutId: string | null } | null>;
}
