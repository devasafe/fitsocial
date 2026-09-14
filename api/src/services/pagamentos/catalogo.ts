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
  /**
   * O que vem junto, item a item.
   *
   * Mora AQUI, e não na tela, pelo mesmo motivo do preço: o APK instalado não
   * se atualiza sozinho. Uma promessa comercial escrita dentro do aplicativo
   * fica congelada na versão que a pessoa baixou, e passa a mentir no dia em
   * que um gate mudar. Vindo do servidor, muda com um deploy.
   */
  beneficios: string[];
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
 * O anual custa 9× o mensal — TRÊS meses de graça, e é assim que ele é
 * vendido. Vale para os quatro produtos, e o número não é aproximado: 29,90 × 12
 * = 358,80 contra 269,00 anuais, exatamente três mensalidades de diferença.
 * Quem mexer nos preços mantém a proporção, ou o "3 meses grátis" da tela —
 * que é calculado, não escrito — passa a dizer outra coisa.
 *
 * A justificativa mudou quando a cobrança virou cartão (a recorrência do Asaas
 * não aceita outro método). Com 2,99% + R$ 0,49 por cobrança, doze mensalidades
 * de R$ 29,90 pagam R$ 16,56 de taxa e o anual de R$ 269 paga R$ 8,53 — cerca
 * de oito reais de diferença, não o abismo que a taxa fixa do PIX sugeria. O
 * que sustenta o desconto agora é o outro motivo, e ele é o mais forte: o anual
 * não depende de doze cobranças darem certo. Cartão recusado é a causa número
 * um de cancelamento involuntário, e cada renovação é uma chance de perder
 * alguém que queria ficar.
 */
export const CATALOGO: Record<Produto, ItemDoCatalogo> = {
  pro: {
    produto: "pro",
    nome: "Pro",
    resumo: "Sua evolução inteira, recordes, calendário do ano e a IA ajustando seu plano.",
    beneficios: [
      "Sua evolução sem o limite de 7 dias",
      "Seus recordes e todo o histórico deles",
      "O calendário do ano inteiro",
      "A IA ajusta seu treino e sua dieta quando você pedir",
    ],
    precoCentavos: { mensal: 2990, anual: 26900 },
    plano: "pro",
    capacidades: [],
    limiteDeAlunos: 0,
  },
  pro_coach: {
    produto: "pro_coach",
    nome: "Pro Coach",
    resumo: "O painel de treinador, com até 30 alunos — e o Pro completo para você.",
    beneficios: [
      "Tudo do Pro, para você",
      "Painel de treinador, com até 30 alunos",
      "Você monta e ajusta o treino de cada um",
      "Seus alunos ganham o Pro enquanto você os acompanha",
    ],
    precoCentavos: { mensal: 7990, anual: 71900 },
    plano: "pro",
    capacidades: ["coach"],
    limiteDeAlunos: 30,
  },
  pro_nutri: {
    produto: "pro_nutri",
    nome: "Pro Nutri",
    resumo: "O painel de nutricionista, com até 30 pacientes — e o Pro completo para você.",
    beneficios: [
      "Tudo do Pro, para você",
      "Painel de nutricionista, com até 30 pacientes",
      "Você monta e ajusta a dieta de cada um",
      "Seus pacientes ganham o Pro enquanto você os acompanha",
    ],
    precoCentavos: { mensal: 7990, anual: 71900 },
    plano: "pro",
    capacidades: ["nutri"],
    limiteDeAlunos: 30,
  },
  pro_plus: {
    produto: "pro_plus",
    nome: "Pro+",
    resumo: "Os dois painéis, treino e nutrição, com até 30 acompanhados em cada.",
    beneficios: [
      "Tudo do Pro, para você",
      "Os dois painéis: treinador e nutricionista",
      "Até 30 acompanhados em cada um",
      "Quem você acompanha ganha o Pro",
    ],
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
