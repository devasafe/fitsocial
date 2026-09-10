import { useEffect, useRef } from "react";

/* Camadas: folha de confirmação e detalhe em tela cheia.
 *
 * Duas coisas que o painel não tinha e que separam "site" de "app":
 *
 * 1. O voltar do Android fecha a camada em vez de sair do painel. Sem isso, um
 *    moderador com a folha aberta e um motivo meio digitado que deslize para
 *    trás perde o texto E sai da página. Não é polimento: é perda de dado no
 *    fluxo destrutivo mais usado daqui.
 * 2. Esc fecha, no desktop.
 *
 * Com duas camadas empilhadas, só a de cima responde — por isso a pilha. */

interface Alvo {
  fechar(): void;
}

const pilha: Alvo[] = [];
let ouvindo = false;

function ouvir() {
  if (ouvindo) return;
  ouvindo = true;

  const topo = () => pilha[pilha.length - 1];

  window.addEventListener("popstate", () => topo()?.fechar());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") topo()?.fechar();
  });
}

/**
 * Empilha a entrada de histórico da camada. Chame no HANDLER que abre, nunca
 * num efeito: o StrictMode invoca efeitos duas vezes em desenvolvimento, e aí
 * o histórico ganha duas entradas em dev e uma em produção — um "voltar" não
 * fecha nada em dev e fecha em produção, que é o tipo de divergência que só
 * aparece depois do deploy.
 *
 * pushState sem argumento de URL não muda o hash, então o listener de
 * hashchange do App não dispara e a navegação por seção continua intacta.
 */
export function empilharCamada() {
  history.pushState({ camada: true }, "");
}

/**
 * Liga uma camada aberta ao voltar do navegador e ao Esc.
 *
 * `fechar` deve apenas limpar o estado — quem consome a entrada de histórico é
 * este hook.
 */
export function useCamada(aberta: boolean, fechar: () => void) {
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;

  // Distingue "fechou porque voltaram" de "fechou por botão": no primeiro caso
  // a entrada de histórico já foi consumida pelo navegador.
  const porVoltar = useRef(false);
  const estavaAberta = useRef(false);

  useEffect(() => {
    if (!aberta) return;
    ouvir();
    const meu: Alvo = {
      fechar: () => {
        porVoltar.current = true;
        fecharRef.current();
      },
    };
    pilha.push(meu);
    return () => {
      const i = pilha.lastIndexOf(meu);
      if (i >= 0) pilha.splice(i, 1);
    };
  }, [aberta]);

  // Fechou por botão, toque fora ou envio concluído? A entrada empilhada ainda
  // está lá. Consome, senão cada camada já fechada cobra um toque a mais no
  // voltar depois.
  //
  // Isto vive num efeito separado, guardado por ref em vez de cleanup, porque
  // cleanup roda também no remount do StrictMode — e ali um history.back()
  // comeria a entrada da camada que acabou de abrir.
  useEffect(() => {
    if (aberta) {
      estavaAberta.current = true;
      return;
    }
    if (!estavaAberta.current) return;
    estavaAberta.current = false;
    if (porVoltar.current) {
      porVoltar.current = false;
      return;
    }
    history.back();
  }, [aberta]);
}
