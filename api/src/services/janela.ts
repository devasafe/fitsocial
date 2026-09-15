import { calcularPlan } from "./entitlement.js";
import type { UserDoc } from "../models/User.js";

/**
 * Até onde o plano grátis enxerga o próprio passado.
 *
 * Uma semana é o bastante para responder "como foi a semana" — que é o que faz
 * a pessoa voltar amanhã — e curta o bastante para a falta doer em quem já tem
 * histórico.
 */
export const JANELA_DO_GRATIS = 7;

/**
 * A janela que esta pessoa pode pedir, cortada se for o caso.
 *
 * CORTA, e não recusa. Um 402 faria o aplicativo instalado navegar para a tela
 * de assinatura a partir de um gráfico que nunca foi ligado a isso. Cortado, o
 * cliente velho mostra sete dias e o novo lê `meta.limitadoPor`.
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
