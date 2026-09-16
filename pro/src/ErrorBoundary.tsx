import { Component, type ErrorInfo, type ReactNode } from "react";
import { MARCA } from "./marca";

interface Props {
  children: ReactNode;
}

interface State {
  comErro: boolean;
}

/**
 * Tela branca vira mensagem — nada mais que isso.
 *
 * Defeito 3 (Tarefa 11b): a ficha do aluno passou de 403 para 200 com
 * `constancia`/`exercicios`/`calendario` AUSENTES. O bundle NOVO trata isso; o
 * bundle VELHO — que fica servido até o build terminar (é o último da fila do
 * deploy) e em toda aba já aberta — lê esses campos sem guarda, e sem um
 * `ErrorBoundary` na raiz um erro de render aqui é tela branca, sem pista
 * nenhuma de que algo quebrou.
 *
 * Não tenta consertar o bundle velho — isso é impossível a partir daqui, o
 * código que quebrou já foi baixado. O que dá para fazer é ele falhar de um
 * jeito legível: uma mensagem com a saída óbvia, recarregar, que baixa o
 * bundle novo.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { comErro: false };

  static getDerivedStateFromError(): State {
    return { comErro: true };
  }

  componentDidCatch(erro: Error, info: ErrorInfo): void {
    // Só a mensagem e a pilha — nunca o que o componente estava renderizando,
    // que pode carregar dado de saúde do aluno.
    console.error("[ErrorBoundary] painel quebrou ao renderizar:", erro, info.componentStack);
  }

  render() {
    if (!this.state.comErro) return this.props.children;

    return (
      <div className="entrar">
        <div style={{ maxWidth: 380, textAlign: "center" }}>
          <div className="marca" style={{ justifyContent: "center", marginBottom: 16 }}>
            <b>{MARCA}</b>
            <span>pro</span>
          </div>
          <h1>Algo deu errado</h1>
          <p className="sub" style={{ marginTop: 8 }}>
            Esta tela travou. Na maioria das vezes é uma versão nova do painel chegando —
            recarregar resolve.
          </p>
          <button className="discreto" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
