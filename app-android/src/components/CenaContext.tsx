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
import { Platform } from "react-native";
import { CenaLime, type Origem } from "./CenaLime";

interface Pedido {
  /** Uma frase só = passagem. Várias = companhia numa espera longa. Nenhuma = pincelada. */
  passos: readonly string[];
  /** Só a tinta, curta. Para ação instantânea e repetida. */
  pincelada?: boolean;
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
        pincelada={pedido?.pincelada}
        aoPedirSaida={cena.fechar}
      />
    </CenaCtx.Provider>
  );
}

export function useCena(): Cena {
  return useContext(CenaCtx);
}

/** Espera o mínimo para a gota cobrir a tela antes de trocar o que está embaixo. */
export const COBERTURA_MS = 520;

// A cena cobre a CERIMÔNIA, não a rede. apiFetch espera até 60s, e uma tela
// lime inteira por um minuto — sem abas, sem voltar, sem cancelar — é uma
// armadilha. Passado este limite a cena sai e devolve a pessoa à tela dela,
// com o botão ainda em carregamento. A ação continua; só a festa acaba.
export const LIMITE_DE_CENA_MS = 6000;

/** O quanto a pincelada leva para cobrir. Curto: ela é a troca, não a festa. */
export const PINCELADA_MS = 300;

export const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ToqueBruto {
  nativeEvent: { pageX?: number; pageY?: number; clientX?: number; clientY?: number };
}

/** De onde a gota nasce. Sem um ponto confiável, do centro. */
export function origemDoToque(evento?: ToqueBruto | null): Origem | null {
  const n = evento?.nativeEvent;
  if (!n) return null;
  // No web o overlay é fixed, então o par certo é client*. E o botão é focável:
  // acionar por teclado gera um clique sintético em (0,0), que faria a gota
  // nascer no canto da tela em vez do botão.
  const x = Platform.OS === "web" ? n.clientX ?? n.pageX : n.pageX;
  const y = Platform.OS === "web" ? n.clientY ?? n.pageY : n.pageY;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x === 0 && y === 0) return null;
  return { x, y };
}
