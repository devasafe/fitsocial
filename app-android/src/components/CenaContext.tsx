// Um lugar para a cena morar quando a tela que a disparou vai embora.
//
// A cena é um Modal, e Modal morre junto com o componente que o renderiza.
// Isso basta quando a tela continua montada por baixo — a Home, gerando o
// plano, é assim. Mas publicar TERMINA saindo do compositor: no instante em
// que a navegação troca de tela, a cena sumiria e a pessoa veria um corte
// seco de verde para o post.
//
// Aqui a cena mora acima do navegador. A troca de tela acontece por baixo do
// lime, escondida, e o que a pessoa vê é o verde abrindo no post já pronto.
//
// Quem não navega não precisa disto e pode renderizar <CenaLime> direto.

import React, { createContext, useContext, useMemo, useState } from "react";
import { CenaLime, type Origem } from "./CenaLime";

interface Pedido {
  /** Uma frase só = passagem. Várias = companhia numa espera longa. */
  passos: readonly string[];
  /** Onde o dedo tocou. Sem isso, nasce do centro. */
  origem?: Origem | null;
  passoMs?: number;
}

interface Cena {
  abrir(pedido: Pedido): void;
  fechar(): void;
}

const CenaCtx = createContext<Cena>({ abrir: () => {}, fechar: () => {} });

export function CenaProvider({ children }: { children: React.ReactNode }) {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [visivel, setVisivel] = useState(false);

  const cena = useMemo<Cena>(
    () => ({
      abrir(p) {
        setPedido(p);
        setVisivel(true);
      },
      fechar() {
        // O pedido fica: a saída ainda mostra o texto enquanto desaparece.
        setVisivel(false);
      },
    }),
    []
  );

  return (
    <CenaCtx.Provider value={cena}>
      {children}
      <CenaLime
        visivel={visivel}
        origem={pedido?.origem}
        passos={pedido?.passos ?? []}
        passoMs={pedido?.passoMs}
      />
    </CenaCtx.Provider>
  );
}

export function useCena(): Cena {
  return useContext(CenaCtx);
}

/** Espera o mínimo para a gota cobrir a tela antes de trocar o que está embaixo. */
export const COBERTURA_MS = 520;

export const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
