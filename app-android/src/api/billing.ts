import { apiFetch } from "./client";
import type { AppUser } from "./auth";

/**
 * Upgrade de DESENVOLVIMENTO (alterna free/premium) — só funciona fora de
 * produção. Em produção, quem libera acesso é o webhook do gateway.
 */
export function devUpgrade(token: string) {
  return apiFetch<{ user: AppUser }>("/billing/dev-upgrade", {
    method: "POST",
    token,
  });
}

export type Produto = "pro" | "pro_coach" | "pro_nutri" | "pro_plus";
export type Ciclo = "mensal" | "anual";

export interface ProdutoDoCatalogo {
  produto: Produto;
  nome: string;
  resumo: string;
  /**
   * Vem do SERVIDOR, e não escrito aqui.
   *
   * O APK instalado não se atualiza sozinho: uma lista de benefícios escrita
   * na tela fica congelada na versão que a pessoa baixou e passa a mentir no
   * dia em que um gate mudar.
   */
  beneficios?: string[];
  precoCentavos: Record<Ciclo, number>;
  precoFormatado: Record<Ciclo, string>;
  economiaAnualCentavos?: number;
  /** Quantas mensalidades o anual economiza. Calculado no servidor. */
  mesesGratisNoAnual?: number;
  limiteDeAlunos: number;
}

export interface AssinaturaAtual {
  id: string;
  produto: Produto;
  nome: string;
  ciclo: Ciclo;
  status: "ativa" | "inadimplente" | "cancelada";
  valorCentavos: number;
  valorFormatado: string;
  validoAte: string | null;
  renovaEm: string | null;
  /** Cancelada, mas o ciclo já pago continua valendo até o fim. */
  cancelaNoFimDoCiclo: boolean;
}

/** O que está à venda. Público: a tela abre antes de decidir se pede login. */
export function listarProdutos() {
  return apiFetch<{ data: ProdutoDoCatalogo[] }>("/billing/produtos");
}

/**
 * Abre o pagamento e devolve para onde mandar a pessoa.
 *
 * A URL é uma página do gateway: é lá que o CPF e os dados do cartão são
 * digitados, e nada disso passa por aqui.
 */
export function abrirCheckout(token: string, produto: Produto, ciclo: Ciclo, cupom?: string) {
  return apiFetch<{
    data: {
      assinatura: string;
      urlDeCheckout: string;
      valorCentavos: number;
      descontoCentavos: number;
      cupom: string | null;
    };
  }>("/billing/checkout", {
    method: "POST",
    token,
    body: { produto, ciclo, ...(cupom ? { cupom } : {}) },
  });
}

export interface CupomValidado {
  codigo: string;
  descontoCentavos: number;
  descontoFormatado: string | null;
  /** Meses de cortesia, quando o cupom é desse tipo. */
  mesesGratis: number;
  temParceiro: boolean;
}

/**
 * O cupom vale? Consulta pura, antes de mandar a pessoa ao gateway.
 *
 * Existe para o desconto aparecer NA TELA: descobrir o preço final só na
 * página de pagamento é o tipo de surpresa que faz desistir. Quem decide de
 * verdade continua sendo o servidor, no checkout.
 */
export function validarCupom(token: string, codigo: string, produto: Produto, ciclo: Ciclo) {
  const q = new URLSearchParams({ produto, ciclo }).toString();
  return apiFetch<{ data: CupomValidado }>(
    `/billing/cupom/${encodeURIComponent(codigo)}?${q}`,
    { token }
  );
}

export function obterAssinatura(token: string) {
  return apiFetch<{ data: AssinaturaAtual | null }>("/billing/assinatura", { token });
}

/** Cancela a renovação. O acesso continua até o fim do ciclo já pago. */
export function cancelarAssinatura(token: string) {
  return apiFetch<{ data: AssinaturaAtual }>("/billing/assinatura", {
    method: "DELETE",
    token,
  });
}
