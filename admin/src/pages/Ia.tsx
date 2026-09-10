import { useEffect, useState } from "react";
import { buscarChaves, buscarSerie, type UsoPorChave, type UsoPorDia } from "../api";
import { Serie } from "../components/Serie";
import { useEhCelular } from "../hooks/useEhCelular";
import { Termica } from "../components/Termica";

const JANELAS = [7, 30, 90];
const nf = new Intl.NumberFormat("pt-BR");

export function Ia({ token }: { token: string }) {
  const [dias, setDias] = useState(30);
  const [serie, setSerie] = useState<UsoPorDia[] | null>(null);
  const [chaves, setChaves] = useState<UsoPorChave[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ehCelular = useEhCelular();

  useEffect(() => {
    let ativo = true;
    setErro(null);
    Promise.all([buscarSerie(token, dias), buscarChaves(token)])
      .then(([s, c]) => {
        if (!ativo) return;
        setSerie(s.data);
        setChaves(c.data);
      })
      .catch((e: Error) => ativo && setErro(e.message));
    return () => {
      ativo = false;
    };
  }, [token, dias]);

  const totalTokens = serie?.reduce((s, d) => s + d.tokens, 0) ?? 0;
  const totalChamadas = serie?.reduce((s, d) => s + d.chamadas, 0) ?? 0;
  const totalFalhas = serie?.reduce((s, d) => s + d.falhas, 0) ?? 0;

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Consumo de IA</h1>
          <p>
            Cada conversa com o coach e cada plano gerado passa por uma das chaves
            configuradas. Quando uma estoura a quota, a próxima assume — e as duas
            aparecem aqui.
          </p>
        </div>
        <div className="filtros">
          {JANELAS.map((d) => (
            <button key={d} className="discreto" aria-pressed={dias === d} onClick={() => setDias(d)}>
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="erro" role="alert" style={{ marginBottom: 20 }}>
          {erro}
        </div>
      )}

      <section className="secao">
        <h2>Chamadas por dia</h2>
        <div className="painel">
          {serie === null ? (
            <p className="vazio">Carregando…</p>
          ) : (
            <>
              <Serie dados={serie} />
              <p className="aviso" style={{ marginTop: 10, marginBottom: 0 }}>
                {nf.format(totalChamadas)} chamadas e {nf.format(totalTokens)} tokens em {dias} dias.
                {totalFalhas > 0 && <> {nf.format(totalFalhas)} falharam, em vermelho.</>}
              </p>
            </>
          )}
        </div>
      </section>

      <section className="secao">
        <h2>Chaves hoje</h2>
        <div className="painel">
          {chaves === null ? (
            <p className="vazio">Carregando…</p>
          ) : chaves.length === 0 ? (
            <p className="vazio">
              Nenhuma chave foi usada hoje. O consumo aparece aqui na primeira chamada.
            </p>
          ) : ehCelular ? (
            /* Seis colunas de número não cabem em 360px, e rolar de lado para
               ler uma linha é pior que ler duas. A barra de quota, que é o que
               se olha de relance, ganha a largura toda. */
            <ul className="lista-cartoes">
              {chaves.map((c) => (
                <li className="cartao-item" key={c.keyLabel}>
                  <div className="cartao-titulo">
                    <b>{c.keyLabel}</b>
                  </div>
                  <div className="cartao-sub">{c.provider}</div>

                  <div style={{ marginTop: 12 }}>
                    <Termica pct={c.usoPct} />
                    {c.limiteDiario !== null && (
                      <div className="aviso" style={{ marginTop: 4 }}>
                        {nf.format(c.chamadas)} de {nf.format(c.limiteDiario)}
                      </div>
                    )}
                  </div>

                  <div className="cartao-numeros">
                    <div>
                      <div className="num">{nf.format(c.chamadas)}</div>
                      <div className="aviso">chamadas</div>
                    </div>
                    <div>
                      <div
                        className="num"
                        style={{ color: c.falhas ? "var(--perigo)" : undefined }}
                      >
                        {nf.format(c.falhas)}
                      </div>
                      <div className="aviso">falhas</div>
                    </div>
                    <div>
                      <div className="num">{nf.format(c.tokens)}</div>
                      <div className="aviso">tokens</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rolagem-tabela">
              <table>
                <thead>
                  <tr>
                    <th>Chave</th>
                    <th>Serviço</th>
                    <th className="col-quota">Quota usada</th>
                    <th className="dir">Chamadas</th>
                    <th className="dir">Falhas</th>
                    <th className="dir">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {chaves.map((c) => (
                    <tr key={c.keyLabel}>
                      <td>{c.keyLabel}</td>
                      <td style={{ color: "var(--texto-2)" }}>{c.provider}</td>
                      <td>
                        <Termica pct={c.usoPct} />
                        {c.limiteDiario !== null && (
                          <span className="aviso">
                            {nf.format(c.chamadas)} de {nf.format(c.limiteDiario)}
                          </span>
                        )}
                      </td>
                      <td className="dir num">{nf.format(c.chamadas)}</td>
                      <td
                        className="dir num"
                        style={{ color: c.falhas ? "var(--perigo)" : undefined }}
                      >
                        {nf.format(c.falhas)}
                      </td>
                      <td className="dir num">{nf.format(c.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="aviso" style={{ marginTop: 12, marginBottom: 0 }}>
            O teto de cada chave vem da variável AI_DAILY_LIMITS. Sem teto configurado,
            o consumo aparece em número absoluto.
          </p>
        </div>
      </section>
    </>
  );
}
