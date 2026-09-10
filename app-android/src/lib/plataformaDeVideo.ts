// Onde procurar a execução de um exercício.
//
// Não há integração com nenhuma das duas: o app monta a busca e entrega para o
// aplicativo que a pessoa já tem instalado. Sem chave de API, sem player
// embutido, sem termo de uso para cumprir.
//
// A escolha mora no aparelho, não no servidor: é sobre qual app você tem no
// celular, não sobre quem você é. Trocar de celular pode significar trocar de
// resposta, e tudo bem.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type PlataformaDeVideo = "youtube" | "tiktok";

const KEY = "fitsocial.plataformaDeVideo";

export const NOME_DA_PLATAFORMA: Record<PlataformaDeVideo, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
};

export async function getPlataforma(): Promise<PlataformaDeVideo | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw === "youtube" || raw === "tiktok" ? raw : null;
  } catch {
    // Storage indisponível: perguntar de novo é melhor que abrir o app errado.
    return null;
  }
}

export async function setPlataforma(p: PlataformaDeVideo): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, p);
  } catch {
    /* a escolha vale para esta vez; na próxima o app pergunta de novo */
  }
}

/**
 * A busca de cada plataforma.
 *
 * "execução correta" no YouTube porque lá o acervo é de vídeo-aula e o termo
 * filtra bem; só "execução" no TikTok porque lá o formato é curto e a frase
 * longa devolve pouca coisa.
 */
export function urlDeBusca(plataforma: PlataformaDeVideo, exercicio: string): string {
  if (plataforma === "tiktok") {
    return `https://www.tiktok.com/search?q=${encodeURIComponent(`${exercicio} execução`)}`;
  }
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${exercicio} execução correta`
  )}`;
}
