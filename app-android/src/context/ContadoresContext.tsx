// Uma fonte só para todos os badges do app.
//
// Antes o sino da Home buscava a própria contagem e nenhuma outra área tinha
// badge. Com cada tela buscando a sua, os números se contradizem: o sino diz 3,
// a lista mostra 5, e ninguém sabe qual acreditar.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { useAuth } from "./AuthContext";
import {
  getContadores,
  marcarAreaVista,
  CONTADORES_ZERADOS,
  type Area,
  type Contadores,
} from "../api/readState";

interface Estado {
  contadores: Contadores;
  /** Rebusca do servidor. Barato e sem efeito colateral. */
  refrescar: () => Promise<void>;
  /** Chamar quando a pessoa CHEGA ao conteúdo novo — não ao abrir a aba. */
  marcarVisto: (area: Area) => Promise<void>;
  /** O sino tem marca por item, então zera por outro caminho. */
  zerarNotificacoes: () => void;
}

const Ctx = createContext<Estado | undefined>(undefined);

export function ContadoresProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [contadores, setContadores] = useState<Contadores>(CONTADORES_ZERADOS);
  // Marcar a mesma área duas vezes seguidas é inofensivo no servidor, mas gera
  // requisição à toa: a lista dispara o gatilho a cada rolagem.
  const marcando = useRef<Set<Area>>(new Set());

  const refrescar = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await getContadores(token);
      setContadores(data);
    } catch {
      // Badge é enfeite informativo: se a rede falhou, mantém o último número
      // conhecido em vez de piscar zero e mentir que não há nada novo.
    }
  }, [token]);

  const marcarVisto = useCallback(
    async (area: Area) => {
      if (!token || marcando.current.has(area)) return;
      marcando.current.add(area);
      try {
        const { data } = await marcarAreaVista(token, area);
        setContadores(data);
      } catch {
        /* tenta de novo no próximo gatilho */
      } finally {
        marcando.current.delete(area);
      }
    },
    [token]
  );

  const zerarNotificacoes = useCallback(() => {
    setContadores((c) => ({ ...c, notificacoes: 0 }));
  }, []);

  useEffect(() => {
    if (!token) {
      setContadores(CONTADORES_ZERADOS);
      return;
    }
    void refrescar();
    // Voltar para o app é o momento em que a pessoa quer saber o que perdeu.
    const sub = AppState.addEventListener("change", (estado) => {
      if (estado === "active") void refrescar();
    });
    return () => sub.remove();
  }, [token, refrescar]);

  return (
    <Ctx.Provider value={{ contadores, refrescar, marcarVisto, zerarNotificacoes }}>
      {children}
    </Ctx.Provider>
  );
}

export function useContadores(): Estado {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useContadores precisa estar dentro de <ContadoresProvider>");
  return ctx;
}
