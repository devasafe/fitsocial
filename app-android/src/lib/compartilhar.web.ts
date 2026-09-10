// Compartilhar no navegador.
//
// Existe porque a versão nativa importa expo-sharing, expo-file-system e
// expo-intent-launcher — e importar módulo nativo no bundle web quebra o
// carregamento. É o padrão do projeto (ver lib/push.web.ts, RouteMap.web.tsx).
//
// O navegador não tem bandeja do sistema nem intent do Instagram. Tem a Web
// Share API, quando o navegador oferece, e o download como saída que sempre
// funciona. Em qualquer um dos dois, o Instagram não recebe imagem por link:
// quem estiver no computador vai precisar mandar a imagem para o celular.

/** Compartilha pela Web Share API, ou baixa o arquivo. */
export async function abrirBandeja(url: string): Promise<void> {
  const arquivo = await baixarComoArquivo(url);

  const nav = navigator as Navigator & {
    canShare?: (dados: { files?: File[] }) => boolean;
    share?: (dados: { files?: File[]; title?: string }) => Promise<void>;
  };

  if (arquivo && nav.canShare?.({ files: [arquivo] }) && nav.share) {
    await nav.share({ files: [arquivo], title: "Meu treino" });
    return;
  }

  baixar(url);
}

/** Não existe intent de Story no navegador — quem chama cai na bandeja. */
export async function abrirStoryDoInstagram(): Promise<boolean> {
  return false;
}

export const temCompartilhamentoNativo = false;

async function baixarComoArquivo(url: string): Promise<File | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return new File([blob], "treino.png", { type: "image/png" });
  } catch {
    return null;
  }
}

function baixar(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = "treino.png";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
