import { useCallback, useEffect, useState } from "react";
import {
  buscarCapacidades,
  criarConvite,
  listarConvites,
  revogarConvite,
  ErroApi,
  type Capacidade,
  type Convite,
} from "../api";

/**
 * O link que o coach manda no WhatsApp.
 *
 * Caminho, e não hash: o app na web usa history API, e o Caddy dele já serve o
 * index.html para qualquer caminho. Quem abrir sem ter conta cai no cadastro e
 * o código fica guardado até a conta existir.
 */
function linkDoConvite(code: string): string {
  return `https://fit.satriz.club/convite/${code}`;
}

export function Convites({ token }: { token: string }) {
  const [convites, setConvites] = useState<Convite[]>([]);
  const [capacidades, setCapacidades] = useState<Capacidade[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [c, cap] = await Promise.all([listarConvites(token), buscarCapacidades(token)]);
      setConvites(c.data);
      setCapacidades(cap.data.capacidades);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar os convites.");
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function gerar(papel: "coach" | "nutri") {
    setErro(null);
    try {
      await criarConvite(token, papel, 1);
      await carregar();
    } catch (e) {
      // O 409 de lotação é informação, não falha: a mensagem da API já diz
      // quantos de quantos, e é isso que o coach precisa ler.
      setErro(e instanceof ErroApi ? e.message : "Não foi possível gerar o convite.");
    }
  }

  async function copiar(code: string) {
    try {
      await navigator.clipboard.writeText(linkDoConvite(code));
      setCopiado(code);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      // Navegador sem permissão de área de transferência: o link está na tela,
      // dá para selecionar à mão.
      setErro("Não consegui copiar. Selecione o link e copie manualmente.");
    }
  }

  async function revogar(code: string) {
    try {
      await revogarConvite(token, code);
      await carregar();
    } catch {
      setErro("Não foi possível cancelar este convite.");
    }
  }

  if (carregando) return <p className="vazio">Carregando…</p>;

  return (
    <>
      <h1>Convites</h1>
      <p className="sub" style={{ marginBottom: 24 }}>
        Gere um link e mande para o aluno. Ele aceita, escolhe o que abrir para você, e aparece na
        sua lista.
      </p>

      <div className="cartoes" style={{ marginBottom: 24 }}>
        {capacidades.map((c) => (
          <div key={c.papel} className="cartao">
            <div className="num">
              {c.alunos}
              <span style={{ fontSize: 16, color: "var(--texto-3)" }}> / {c.limite}</span>
            </div>
            <div className="rotulo">{c.papel === "coach" ? "alunos" : "pacientes"}</div>
            <div className="aviso">
              {c.alunos >= c.limite
                ? "Limite atingido — encerre um acompanhamento para abrir vaga."
                : `${c.limite - c.alunos} ${c.limite - c.alunos === 1 ? "vaga" : "vagas"}`}
            </div>
            <button
              className="primario"
              style={{ marginTop: 12, width: "100%" }}
              disabled={c.alunos >= c.limite}
              onClick={() => gerar(c.papel)}
            >
              Gerar convite
            </button>
          </div>
        ))}
      </div>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      <h2>Convites em aberto</h2>
      {convites.length === 0 ? (
        <p className="vazio">Nenhum convite esperando. Gere um acima.</p>
      ) : (
        <div className="painel">
          <div className="linhas">
            {convites.map((c) => (
              <div key={c.code} className="linha" style={{ cursor: "default" }}>
                <span className="crescer">
                  <span className="codigo">{c.code}</span>
                  <br />
                  <span className="sub">
                    {c.papel === "coach" ? "Treino" : "Nutrição"} · vale até{" "}
                    {new Date(c.expiraEm).toLocaleDateString("pt-BR")}
                    {c.usosRestantes > 1 && ` · ${c.usosRestantes} usos`}
                  </span>
                </span>

                <button className="discreto" onClick={() => copiar(c.code)}>
                  {copiado === c.code ? "Copiado!" : "Copiar link"}
                </button>
                <button className="discreto perigo" onClick={() => revogar(c.code)}>
                  Cancelar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
