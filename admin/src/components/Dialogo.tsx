import { useState, type FormEvent, type ReactNode } from "react";
import { useEhCelular } from "../hooks/useEhCelular";

/** Confirmação de ação administrativa. O motivo é obrigatório porque é ele que
 *  vai para a auditoria — daqui a seis meses, "por que essa conta foi banida?"
 *  precisa ter resposta.
 *
 *  No celular vira folha inferior; no desktop continua diálogo centrado. A
 *  diferença é toda de CSS (ver estilo-movel.css), inclusive a alça, que é um
 *  pseudo-elemento. Aqui muda só o que CSS não alcança: o foco e o toque
 *  fora.
 *
 *  Voltar e Esc são responsabilidade de quem abre, via useCamada — o estado
 *  que liga e desliga a folha vive lá, e é ele que o hook precisa observar.
 *  Aqui dentro não dá: quando o envio conclui, este componente desmonta sem
 *  nunca ver "fechado", e a entrada de histórico vazaria. */
export function Dialogo({
  titulo,
  descricao,
  rotuloAcao,
  perigoso = false,
  extra,
  aoConfirmar,
  aoFechar,
}: {
  titulo: string;
  descricao: string;
  rotuloAcao: string;
  perigoso?: boolean;
  extra?: ReactNode;
  aoConfirmar: (motivo: string) => Promise<void>;
  aoFechar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ehCelular = useEhCelular();

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await aoConfirmar(motivo.trim());
      aoFechar();
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <div
      className="cortina"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      // Fechar tocando fora é o comportamento da folha do app: um menu que só
      // fecha no botão faz a pessoa procurar a saída. Só no alvo exato, senão
      // um arrasto que termine sobre a cortina fecharia.
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) aoFechar();
      }}
    >
      <form className="dialogo" onSubmit={enviar}>
        <h2>{titulo}</h2>
        <p style={{ color: "var(--texto-2)", margin: "8px 0 0" }}>{descricao}</p>

        {extra}

        <div style={{ marginTop: 14 }}>
          <label htmlFor="motivo">Motivo</label>
          <input
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Fica registrado na auditoria"
            minLength={3}
            required
            // No celular o foco automático abre o teclado enquanto a folha
            // ainda está subindo: a animação trepida e o teclado cobre os
            // botões antes de a pessoa ver do que se trata.
            autoFocus={!ehCelular}
            onFocus={(e) => {
              if (ehCelular) e.currentTarget.scrollIntoView({ block: "center" });
            }}
          />
        </div>

        {erro && (
          <div className="erro" role="alert" style={{ marginTop: 12 }}>
            {erro}
          </div>
        )}

        {/* No celular isto vira coluna. A ordem do DOM é [Cancelar, Confirmar],
            então em coluna a ação principal fica embaixo — mais perto do
            polegar, e sem descolar a ordem visual da ordem de tabulação. */}
        <div className="dialogo-acoes">
          <button type="button" className="discreto" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </button>
          <button
            type="submit"
            className={perigoso ? "acao perigosa" : "acao"}
            disabled={enviando || motivo.trim().length < 3}
          >
            {enviando ? "Aplicando" : rotuloAcao}
          </button>
        </div>
      </form>
    </div>
  );
}
