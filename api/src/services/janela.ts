import { calcularPlan } from "./entitlement.js";
import type { UserDoc } from "../models/User.js";

/**
 * Até onde o plano grátis enxerga o próprio passado.
 *
 * Uma semana é o bastante para a aba responder "como foi a semana" — que é o
 * que faz a pessoa voltar amanhã — e curta o bastante para a falta doer
 * justamente em quem já tem histórico. Quanto mais tempo de app, mais falta faz.
 */
export const JANELA_DO_GRATIS = 7;

/**
 * A janela que esta pessoa pode pedir, cortada se for o caso.
 *
 * CORTA, e não recusa. Um 402 aqui faria o aplicativo instalado navegar para a
 * tela de assinatura a partir de uma tela de gráfico que nunca foi ligada a
 * isso — e a pessoa sairia do gráfico sem entender por quê. Cortado, o cliente
 * velho simplesmente mostra sete dias, e o novo lê `meta.limitadoPor` e desenha
 * o cadeado.
 *
 * Zero significa "tudo" na borda deste projeto, e por isso é o caso que mais
 * precisa de corte.
 */
export function janelaPermitida(user: UserDoc, pedidos: number): number {
  if (calcularPlan(user) !== "free") return pedidos;
  if (pedidos === 0) return JANELA_DO_GRATIS;
  return Math.min(pedidos, JANELA_DO_GRATIS);
}

/** O `meta` das rotas de janela, dizendo se cortou e por quê. */
export function metaDaJanela(pedidos: number, dias: number) {
  return {
    dias,
    ...(dias !== pedidos ? { diasPedidos: pedidos, limitadoPor: "plano" as const } : {}),
  };
}
