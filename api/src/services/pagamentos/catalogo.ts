// O que está à venda, e por quanto.
//
// CONSTANTE, e não tabela no banco nem variável de ambiente. Preço é regra de
// negócio, e o CLAUDE.md deste projeto diz que ela não muda sem perguntar —
// um arquivo revisável é o que torna isso verificável no diff. Preço em banco
// muda sem deixar rastro; preço em env muda sem ninguém revisar.
//
// Tudo em CENTAVOS, inteiro. Dinheiro em ponto flutuante é como um centavo
// vira três por mês e ninguém acha de onde veio.

import type { Capacidade, Plano } from "../entitlement.js";

/** O que o mundo compra. Não confundir com `plan`, que é o que a conta VIRA. */
export const PRODUTOS = ["pro", "pro_coach", "pro_nutri", "pro_plus"] as const;
export type Produto = (typeof PRODUTOS)[number];

export const CICLOS = ["mensal", "anual"] as const;
export type Ciclo = (typeof CICLOS)[number];

export interface ItemDoCatalogo {
  produto: Produto;
  nome: string;
  /** O que a pessoa lê antes de decidir. */
  resumo: string;
  precoCentavos: Record<Ciclo, number>;
  /**
   * O plano do CONSUMIDOR que este produto concede.
   *
   * Repare que Pro Coach concede `pro`, e não um plano próprio: o painel do
   * profissional é uma CAPACIDADE, que vive noutro eixo. É isso que faz "quem
   * compra o painel não paga o Pro separado" cair sozinho, sem uma linha
   * escrita para essa regra.
   */
  plano: Plano;
  /** As capacidades profissionais que vêm junto. */
  capacidades: Capacidade[];
  /** Teto de alunos por capacidade. Zero quando o produto não tem painel. */
  limiteDeAlunos: number;
}

/**
 * O catálogo.
 *
 * O anual custa 10× o mensal — dois meses de graça, e é assim que ele é
 * vendido. Não é só desconto: com a taxa FIXA do Asaas (R$ 1,99 por cobrança),
 * uma mensalidade de R$ 29,90 perde 6,7% para a taxa, e o anual de R$ 269
 * perde 0,7%. O desconto de dois meses se paga em parte só com isso — e o
 * resto vem de não depender de doze cobranças darem certo.
 */
export const CATALOGO: Record<Produto, ItemDoCatalogo> = {
  pro: {
    produto: "pro",
    nome: "Pro",
    resumo: "Sua evolução inteira, recordes, calendário do ano e a IA ajustando seu plano.",
    precoCentavos: { mensal: 2990, anual: 26900 },
    plano: "pro",
    capacidades: [],
    limiteDeAlunos: 0,
  },
  pro_coach: {
    produto: "pro_coach",
    nome: "Pro Coach",
    resumo: "O painel de treinador, com até 30 alunos — e o Pro completo para você.",
    precoCentavos: { mensal: 7990, anual: 71900 },
    plano: "pro",
    capacidades: ["coach"],
    limiteDeAlunos: 30,
  },
  pro_nutri: {
    produto: "pro_nutri",
    nome: "Pro Nutri",
    resumo: "O painel de nutricionista, com até 30 pacientes — e o Pro completo para você.",
    precoCentavos: { mensal: 7990, anual: 71900 },
    plano: "pro",
    capacidades: ["nutri"],
    limiteDeAlunos: 30,
  },
  pro_plus: {
    produto: "pro_plus",
    nome: "Pro+",
    resumo: "Os dois painéis, treino e nutrição, com até 30 acompanhados em cada.",
    precoCentavos: { mensal: 11990, anual: 107900 },
    plano: "pro_plus",
    capacidades: ["coach", "nutri"],
    limiteDeAlunos: 30,
  },
};

export function itemDoCatalogo(produto: string): ItemDoCatalogo | null {
  return (CATALOGO as Record<string, ItemDoCatalogo>)[produto] ?? null;
}

/** Quanto custa, em centavos. Lança se o produto ou o ciclo não existirem. */
export function precoDe(produto: Produto, ciclo: Ciclo): number {
  return CATALOGO[produto].precoCentavos[ciclo];
}

/** Quantos dias o ciclo dura. É o que define o `validoAte` da assinatura. */
export function diasDoCiclo(ciclo: Ciclo): number {
  return ciclo === "anual" ? 365 : 30;
}

/** "R$ 29,90" — para a tela e para a descrição que vai ao gateway. */
export function emReais(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}
