// Qual desenho de cartão a pessoa prefere.
//
// Fica no aparelho, e não no servidor, pelo mesmo motivo da plataforma de
// vídeo: é gosto, não identidade. E fica guardado porque quem escolheu uma vez
// quase sempre quer a mesma coisa na próxima — sem isso, escolher vira um
// pedágio antes de cada compartilhamento.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LayoutDoCartao } from "../api/social";

const KEY = "fitsocial.layoutDoCartao";

/** Os três que a pessoa escolhe. `numeros` não está aqui: ele é o que o
 *  servidor devolve sozinho quando o post não tem foto. */
export const LAYOUTS_ESCOLHIVEIS = ["foto", "ficha", "cartao"] as const;
export type LayoutEscolhivel = (typeof LAYOUTS_ESCOLHIVEIS)[number];

export const NOME_DO_LAYOUT: Record<LayoutEscolhivel, string> = {
  foto: "Foto",
  ficha: "Ficha",
  cartao: "Cartão",
};

export const COMO_E_O_LAYOUT: Record<LayoutEscolhivel, string> = {
  foto: "A foto ocupa tudo e o treino fica por cima",
  ficha: "Foto em cima, treino embaixo — o mais legível",
  cartao: "Um cartão com o treino flutuando sobre a foto",
};

function valido(v: unknown): v is LayoutEscolhivel {
  return LAYOUTS_ESCOLHIVEIS.includes(v as LayoutEscolhivel);
}

export async function getLayoutDoCartao(): Promise<LayoutEscolhivel> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return valido(raw) ? raw : "foto";
  } catch {
    return "foto";
  }
}

export async function setLayoutDoCartao(layout: LayoutEscolhivel): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, layout);
  } catch {
    /* vale para esta vez; na próxima volta ao padrão */
  }
}

/** O layout escolhido é só um pedido: sem foto, o servidor devolve `numeros`. */
export function servidorTrocou(pedido: LayoutEscolhivel, veio: LayoutDoCartao): boolean {
  return veio !== pedido;
}
