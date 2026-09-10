// Levar o cartão do treino para fora do app.
//
// O desenho vem pronto do servidor (ver api/services/media/cartaoDeCompartilhar).
// Aqui só se resolve o transporte: baixar o arquivo e entregar a quem o sistema
// operacional oferecer.
//
// Dois caminhos, porque atendem a dois desejos diferentes:
//
// - Story: abre o Instagram Stories direto com a imagem já posta. É o caminho
//   de um toque, e é o que a maioria quer logo depois do treino.
// - Bandeja: a lista do sistema, de onde dá para mandar para o feed do
//   Instagram, WhatsApp, Telegram, qualquer coisa. É a saída para todo o resto.
//
// Este arquivo importa módulo nativo e por isso tem variante .web.ts — sem ela
// o pacote vaza para o bundle do navegador e quebra o carregamento.

import { Platform } from "react-native";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
// O content:// só existe na API antiga; a nova ainda não expõe equivalente, e
// o que o pacote reexporta no topo lança em runtime.
import { getContentUriAsync } from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";

const PACOTE_INSTAGRAM = "com.instagram.android";

/** Baixa o cartão para o cache e devolve o arquivo local. */
async function baixar(url: string): Promise<File> {
  // Nome único: dois compartilhamentos seguidos não podem disputar o mesmo
  // arquivo, e o cache é limpo pelo sistema quando o espaço aperta.
  const destino = new File(Paths.cache, `cartao-${Date.now()}.png`);
  return File.downloadFileAsync(url, destino);
}

/** A bandeja do sistema: a pessoa escolhe para onde vai. */
export async function abrirBandeja(url: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Este aparelho não tem para onde compartilhar.");
  }
  const arquivo = await baixar(url);
  await Sharing.shareAsync(arquivo.uri, {
    mimeType: "image/png",
    dialogTitle: "Compartilhar treino",
    UTI: "public.png",
  });
}

/**
 * Instagram Stories, direto.
 *
 * Devolve false quando não dá — sem Instagram instalado, ou fora do Android.
 * Quem chama cai na bandeja, que sempre existe.
 */
export async function abrirStoryDoInstagram(url: string): Promise<boolean> {
  if (Platform.OS !== "android") return false;

  try {
    const arquivo = await baixar(url);
    // O Instagram só aceita content:// — file:// é bloqueado pelo Android
    // desde o Nougat, e o compartilhamento falha em silêncio.
    const contentUri = await getContentUriAsync(arquivo.uri);

    await IntentLauncher.startActivityAsync("com.instagram.share.ADD_TO_STORY", {
      data: contentUri,
      type: "image/png",
      packageName: PACOTE_INSTAGRAM,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
    return true;
  } catch {
    // Instagram ausente ou intent recusada: quem chamou usa a bandeja.
    return false;
  }
}

/** No navegador não há bandeja nativa; ver a variante .web.ts. */
export const temCompartilhamentoNativo = true;
