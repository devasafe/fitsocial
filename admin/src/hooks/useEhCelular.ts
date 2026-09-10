import { useSyncExternalStore } from "react";

/** A fronteira. Vive aqui e em estilo-movel.css — se mudar, mude nos dois.
 *
 *  720 e não 768: 768 é exatamente o iPad em retrato, e ali o painel ainda
 *  entrega 572px de conteúdo depois da lateral. Um iPad merece o desktop. */
export const CELULAR = "(max-width: 720px)";

// Um MediaQueryList para o módulo inteiro: N componentes, um listener.
const mql = typeof window !== "undefined" ? window.matchMedia(CELULAR) : null;

function assinar(avisar: () => void) {
  mql?.addEventListener("change", avisar);
  return () => mql?.removeEventListener("change", avisar);
}

const ler = () => mql?.matches ?? false;

/** Verdadeiro quando a tela é de celular.
 *
 *  useSyncExternalStore e não useState+useEffect: com efeito, o primeiro paint
 *  sai com o markup de desktop e só o segundo corrige — no celular isso é a
 *  tabela de 6 colunas piscando antes dos cartões. */
export function useEhCelular(): boolean {
  return useSyncExternalStore(assinar, ler, () => false);
}
