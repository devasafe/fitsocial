import sharp from "sharp";

/** Maior dimensão (px) permitida; imagens maiores são reduzidas proporcionalmente. */
const MAX_DIMENSION = 1600;

export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
  /** Dimensões DEPOIS do resize — é a imagem que o app vai exibir. */
  width: number;
  height: number;
}

/**
 * Normaliza uma imagem enviada pelo usuário antes de armazenar:
 * - reencoda como JPEG, o que **remove todo o EXIF** (fotos de celular carregam
 *   GPS — ver docs/SECURITY.md);
 * - reduz para no máximo MAX_DIMENSION no maior lado (sem ampliar as menores).
 *
 * Devolve também largura e altura. O sharp já sabe as duas para redimensionar;
 * jogar fora obrigava o app a adivinhar a proporção, e era isso que fazia a
 * foto do feed dar zoom diferente em cada tamanho de tela.
 *
 * Lança erro se o buffer não for uma imagem válida.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  // Sem .withMetadata(): o sharp descarta EXIF/ICC por padrão ao reencodar.
  const { data, info } = await sharp(input)
    .rotate() // aplica a orientação EXIF antes de descartá-la
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    contentType: "image/jpeg",
    ext: ".jpg",
    width: info.width,
    height: info.height,
  };
}
