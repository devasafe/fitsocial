import { useState, type FormEvent, type ReactNode } from "react";

/** Confirmação de ação administrativa. O motivo é obrigatório porque é ele que
 *  vai para a auditoria — daqui a seis meses, "por que essa conta foi banida?"
 *  precisa ter resposta. */
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
    <div className="cortina" role="dialog" aria-modal="true" aria-label={titulo}>
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
            autoFocus
          />
        </div>

        {erro && (
          <div className="erro" role="alert" style={{ marginTop: 12 }}>
            {erro}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
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
