import { useEffect, useState } from "react";
import { buscarPanorama, buscarFunil, type Panorama, type DegrauDoFunil } from "../api";
import { Cartao } from "../components/Cartao";
import { GraficoBarras, GraficoLinhas } from "../components/Grafico";
import { MARCA } from "../marca";

const JANELAS = [7, 30, 90];
const nf = new Intl.NumberFormat("pt-BR");

const porExtenso = (dia: string) =>
  new Date(dia + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "long" });

const NOME_DO_PLANO: Record<string, string> = {
  free: "Grátis",
  pro: "Pro",
  pro_plus: "Pro+",
};

/** Grátis primeiro: é a base de onde todo mundo sai. */
const ORDEM_DO_PLANO = ["free", "pro", "pro_plus"];

/**
 * Por que a conta tem o acesso que tem, em português.
 *
 * As chaves vêm de `origemDoPlano`, no servidor — e é ele quem manda. Antes
 * esta tabela traduzia os valores CRUS do banco (`admin`, `purchase`), o que
 * deixava de fora tudo que o motor passou a saber.
 */
const ORIGEM: Record<string, string> = {
  assinatura: "assinatura no cartão",
  inadimplente: "assinatura com pagamento atrasado",
  cortesia: "cortesia dada por você",
  fundador: "fundador",
  cupom: "meses grátis de cupom",
  profissional: "treinador ou nutricionista",
  patrocinio: "bancado por quem acompanha",
  legado: "compra antiga, sem origem registrada",
};

export function Painel({ token }: { token: string }) {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Panorama | null>(null);
  const [funil, setFunil] = useState<DegrauDoFunil[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setErro(null);
    buscarPanorama(token, dias)
      .then((r) => ativo && setDados(r.data))
      .catch((e: Error) => ativo && setErro(e.message));
    // O funil falha em silêncio de propósito: ele é a seção mais nova, e uma
    // API que ainda não a conhece não pode derrubar o painel inteiro.
    buscarFunil(token, dias)
      .then((r) => ativo && setFunil(r.data.degraus))
      .catch(() => ativo && setFunil(null));
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
            Como o {MARCA} está indo nos últimos {dias} dias. Os dias fecham no horário
            de Brasília.
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
              rotulo="com acesso pago"
              apoio={`${conversao.taxa}% do total`}
              destaque={totais.premium > 0}
            />
            {/* Separado do de cima, e não somado a ele: "tem acesso" inclui
                cortesia, fundador e quem é bancado pelo treinador. Só este
                número é receita. */}
            <Cartao
              valor={nf.format(conversao.pagantes ?? 0)}
              rotulo="pagando"
              apoio={`${conversao.taxaPagante ?? 0}% do total`}
              destaque={(conversao.pagantes ?? 0) > 0}
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
                <div className="retencao">
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
            <h2>Onde as pessoas param</h2>
            <div className="painel">
              {!funil || funil[0]?.pessoas === 0 ? (
                <p className="vazio">
                  Ainda não há percurso registrado nesta janela. Ele começa a aparecer
                  conforme as pessoas usam a versão nova do app.
                </p>
              ) : (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>Passo</th>
                        <th className="dir">Pessoas</th>
                        <th className="dir">Do total</th>
                        <th className="dir">Do passo anterior</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funil.map((d) => (
                        <tr key={d.nome}>
                          <td>
                            {d.rotulo}
                            <div
                              aria-hidden
                              style={{
                                marginTop: 6,
                                height: 6,
                                width: `${Math.max(d.doTotal, 1)}%`,
                                background: "var(--lime)",
                                borderRadius: 3,
                                opacity: 0.85,
                              }}
                            />
                          </td>
                          <td className="dir num">{nf.format(d.pessoas)}</td>
                          <td className="dir num">{d.doTotal}%</td>
                          <td className="dir num">{d.doPasso}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="aviso" style={{ marginTop: 14, marginBottom: 0 }}>
                    A coluna que importa é a última: ela mostra quanto se perde de um passo
                    para o seguinte. Só conta quem criou a conta dentro da janela, e cada
                    pessoa aparece uma vez por passo — não uma vez por visita.
                  </p>
                </>
              )}
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
            <h2>Planos</h2>
            <div className="painel">
              <table>
                <thead>
                  <tr>
                    <th>Plano</th>
                    <th className="dir">Contas</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(conversao.porPlano ?? [])]
                    // Grátis primeiro, que é a base de onde todo mundo sai.
                    .sort((a, b) => ORDEM_DO_PLANO.indexOf(a.plano) - ORDEM_DO_PLANO.indexOf(b.plano))
                    .map((x) => (
                      <tr key={x.plano}>
                        <td>{NOME_DO_PLANO[x.plano] ?? x.plano}</td>
                        <td className="dir num">{nf.format(x.total)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="secao">
            <h2>De onde vem o acesso</h2>
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
                        <td>{ORIGEM[o.origem] ?? o.origem}</td>
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
