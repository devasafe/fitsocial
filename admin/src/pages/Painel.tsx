import { useEffect, useState } from "react";
import { buscarPanorama, type Panorama } from "../api";
import { Cartao } from "../components/Cartao";
import { GraficoBarras, GraficoLinhas } from "../components/Grafico";

const JANELAS = [7, 30, 90];
const nf = new Intl.NumberFormat("pt-BR");

const porExtenso = (dia: string) =>
  new Date(dia + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "long" });

export function Painel({ token }: { token: string }) {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Panorama | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setErro(null);
    buscarPanorama(token, dias)
      .then((r) => ativo && setDados(r.data))
      .catch((e: Error) => ativo && setErro(e.message));
    return () => {
      ativo = false;
    };
  }, [token, dias]);

  if (erro) {
    return (
      <>
        <div className="cabecalho"><h1>Crescimento</h1></div>
        <div className="erro" role="alert">{erro}</div>
      </>
    );
  }

  if (!dados) {
    return (
      <>
        <div className="cabecalho"><h1>Crescimento</h1></div>
        <p className="vazio">Carregando…</p>
      </>
    );
  }

  const { totais, series, retencao, conversao } = dados;
  const semNinguem = totais.contas === 0;

  // Curva acumulada: o total de contas ao fim de cada dia da janela.
  const jaExistiam = totais.contas - series.novos.reduce((s, p) => s + p.valor, 0);
  let corrente = jaExistiam;
  const acumulado = series.novos.map((p) => {
    corrente += p.valor;
    return { dia: p.dia, total: corrente };
  });

  const uso = series.treinos.map((t, i) => ({
    dia: t.dia,
    treinos: t.valor,
    posts: series.posts[i]?.valor ?? 0,
    coach: series.coach[i]?.valor ?? 0,
  }));

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Crescimento</h1>
          <p>
            Como o FitSocial está indo nos últimos {dias} dias. Os dias fecham no horário
            de Brasília.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {JANELAS.map((d) => (
            <button key={d} className="discreto" aria-pressed={dias === d} onClick={() => setDias(d)}>
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {semNinguem ? (
        <div className="painel">
          <p className="vazio">
            Nenhuma conta cadastrada ainda. Os gráficos aparecem quando a primeira pessoa
            entrar no app.
          </p>
        </div>
      ) : (
        <>
          <div className="cartoes">
            <Cartao valor={nf.format(totais.contas)} rotulo="contas" />
            <Cartao
              valor={nf.format(totais.premium)}
              rotulo="premium"
              apoio={`${conversao.taxa}% do total`}
              destaque={totais.premium > 0}
            />
            <Cartao
              valor={nf.format(totais.ativos7d)}
              rotulo="ativos em 7 dias"
              apoio="quem registrou algo ou abriu o app"
            />
            <Cartao
              valor={nf.format(totais.treinos)}
              rotulo="treinos registrados"
              apoio={`${conversao.ativacao}% das contas já registraram um`}
            />
          </div>

          <section className="secao">
            <h2>Novas contas por dia</h2>
            <div className="painel">
              <GraficoBarras
                dados={series.novos as unknown as Record<string, unknown>[]}
                faixas={[{ chave: "valor", nome: "cadastros", cor: "var(--lime)" }]}
              />
            </div>
          </section>

          <section className="secao">
            <h2>Total de contas</h2>
            <div className="painel">
              <GraficoLinhas
                dados={acumulado as unknown as Record<string, unknown>[]}
                faixas={[{ chave: "total", nome: "contas", cor: "var(--lime)" }]}
                altura={170}
              />
            </div>
          </section>

          <section className="secao">
            <h2>As pessoas voltam?</h2>
            <div className="duas-colunas">
              <div className="painel">
                <GraficoLinhas
                  dados={series.ativos as unknown as Record<string, unknown>[]}
                  faixas={[
                    { chave: "registraram", nome: "registraram algo", cor: "var(--lime)" },
                    { chave: "abriram", nome: "abriram o app", cor: "var(--info)" },
                  ]}
                />
                <p className="aviso" style={{ marginTop: 10, marginBottom: 0 }}>
                  {dados.acessoDesde
                    ? `"Abriram o app" é medido desde ${porExtenso(dados.acessoDesde)}; antes disso só havia registro de quem escrevia algo.`
                    : "Ainda não há registro de acesso. Ele começa assim que alguém abrir o app."}
                </p>
              </div>

              <div className="painel">
                <div style={{ display: "flex", gap: 26 }}>
                  {[
                    { r: retencao.d1, b: retencao.base.d1, l: "no dia seguinte" },
                    { r: retencao.d7, b: retencao.base.d7, l: "após 7 dias" },
                    { r: retencao.d30, b: retencao.base.d30, l: "após 30 dias" },
                  ].map((x) => (
                    <div key={x.l}>
                      <div className="num" style={{ fontSize: 26 }}>
                        {x.b ? `${x.r}%` : "—"}
                      </div>
                      <div style={{ color: "var(--texto-2)" }}>{x.l}</div>
                      <div className="aviso">{x.b ? `de ${x.b} contas` : "sem base ainda"}</div>
                    </div>
                  ))}
                </div>
                <p className="aviso" style={{ marginTop: 14, marginBottom: 0 }}>
                  Quantas pessoas ainda estavam ativas depois de se cadastrar. Quem entrou
                  há pouco não entra na conta — não deu tempo de voltar.
                </p>
              </div>
            </div>
          </section>

          <section className="secao">
            <h2>Uso do app</h2>
            <div className="painel">
              <GraficoBarras
                dados={uso as unknown as Record<string, unknown>[]}
                faixas={[
                  { chave: "treinos", nome: "treinos", cor: "var(--lime)" },
                  { chave: "posts", nome: "posts", cor: "var(--info)" },
                  { chave: "coach", nome: "coach", cor: "var(--alerta)" },
                ]}
                altura={220}
              />
            </div>
          </section>

          <section className="secao">
            <h2>Assinaturas</h2>
            <div className="painel">
              {totais.premium === 0 ? (
                <p className="vazio">Nenhuma conta premium ainda.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Origem</th>
                      <th className="dir">Contas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversao.porOrigem.map((o) => (
                      <tr key={o.origem}>
                        <td>
                          {o.origem === "admin" ? "cortesia dada por você"
                            : o.origem === "purchase" ? "compra na loja"
                            : o.origem === "founder" ? "fundador"
                            : o.origem}
                        </td>
                        <td className="dir num">{nf.format(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
