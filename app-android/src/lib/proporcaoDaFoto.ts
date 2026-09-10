// A proporção da foto de um post.
//
// Antes, a caixa da imagem tinha altura fixa em 240px e largura de 100%. Como a
// largura muda com a tela e o `resizeMode` padrão é "cover", a mesma foto era
// cortada de um jeito num celular estreito e de outro num aparelho largo — a
// pessoa via a foto "dar zoom" ao girar o telefone ou ao abrir no navegador. E
// os previews de publicar e de editar usavam alturas diferentes ainda, então o
// que se via ao publicar não era o que saía no feed.
//
// Agora a altura vem da proporção da própria foto, e é a mesma em qualquer
// lugar.

import { useEffect, useState } from "react";
import { Image } from "react-native";

/** Limites de proporção (largura ÷ altura).
 *
 *  Sem teto, uma foto 9:16 tirada em pé ocuparia quase 600px de feed e
 *  empurraria o resto do post para fora da tela; sem piso, uma panorâmica
 *  viraria uma tira. São os mesmos limites que o Instagram usa, e o corte que
 *  sobra é idêntico em toda tela — que é o que estava incomodando. */
const MAIS_ALTA = 0.8; // 4:5, retrato
const MAIS_LARGA = 1.91; // 1.91:1, paisagem

/** Enquanto não se sabe o tamanho: retrato, que é o formato da maioria das
 *  fotos de celular. Errar para o lado comum evita o salto de layout. */
export const PROPORCAO_PADRAO = MAIS_ALTA;

export function proporcaoDaFoto(largura?: number | null, altura?: number | null): number {
  if (!largura || !altura || altura <= 0) return PROPORCAO_PADRAO;
  return Math.min(Math.max(largura / altura, MAIS_ALTA), MAIS_LARGA);
}

/**
 * Proporção de uma foto, vinda do post ou medida na hora.
 *
 * Os posts publicados antes de o servidor guardar as dimensões não têm o que
 * ler, e aí o tamanho é perguntado à própria imagem. Tem que ser `getSize`, e
 * não o `onLoad`: no react-native-web o evento de carregamento é o evento cru
 * do navegador, sem `source.width` — o fallback funcionaria só no APK, e o
 * navegador ficaria com a proporção padrão para todo post antigo.
 */
export function useProporcaoDaFoto(
  url?: string | null,
  largura?: number | null,
  altura?: number | null
): number {
  const conhecida = largura && altura ? proporcaoDaFoto(largura, altura) : null;
  const [medida, setMedida] = useState<number | null>(null);

  useEffect(() => {
    if (conhecida !== null || !url) return;
    let vivo = true;
    Image.getSize(
      url,
      (w, h) => vivo && setMedida(proporcaoDaFoto(w, h)),
      () => vivo && setMedida(null) // imagem quebrada: fica no padrão
    );
    return () => {
      vivo = false;
    };
  }, [url, conhecida]);

  return conhecida ?? medida ?? PROPORCAO_PADRAO;
}
