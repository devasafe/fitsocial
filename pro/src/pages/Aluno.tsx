import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  buscarAluno,
  buscarCardio,
  buscarConquistas,
  buscarGrupos,
  buscarSerie,
  buscarSerieDeCardio,
  formatarCardio,
  METRICAS_CARDIO,
  rotuloDaMetricaCardio,
  encerrarAluno,
  ErroApi,
  JANELAS,
  METRICAS,
  nomeDoExercicio,
  rotuloDaJanela,
  rotuloDaMetrica,
  rotuloDoRecorde,
  unidadeDaMetrica,
  valorDoRecorde,
  type Conquista,
  type Escopo,
  type EsporteNaLista,
  type ExercicioNaLista,
  type GrupoTreinado,
  type Janela,
  type Metrica,
  type MetricaCardio,
  type PerfilDoAluno,
  type PontoDaSerie,
} from "../api";
import { Calendario } from "../components/Calendario";
import { Conversa } from "../components/Conversa";
import { Prescrever } from "../components/Prescrever";

// O Recharts sozinho pesa mais que o resto do painel inteiro. Separado, a
// lista de alunos e a tela de convites não pagam por ele — e é a lista que
// abre primeiro, todo dia. `Nutricao` importa recharts direto (o gráfico de
// kcal é escrito à mão ali, sem passar por `Grafico`), então ela entra na
// mesma regra: importar estático desfaria o corte de bundle e o coach que
// nunca abre a aba Nutrição pagaria pelo recharts mesmo assim.
const Grafico = lazy(() => import("../components/Grafico").then((m) => ({ default: m.Grafico })));
const RadarDeGrupos = lazy(() =>
  import("../components/Radar").then((m) => ({ default: m.RadarDeGrupos }))
);
const Nutricao = lazy(() =>
  import("../components/Nutricao").then((m) => ({ default: m.Nutricao }))
);

type Aba = "evolucao" | "treino" | "nutricao" | "dieta" | "conversa";

/**
 * Que abas esta pessoa vê deste aluno.
 *
 * O papel do VÍNCULO decide, e não um seletor de modo: quem acompanha a mesma
 * pessoa como treinador e como nutricionista tem dois vínculos, e a lista de
 * alunos já sabe qual é qual. Pedir que ela lembre em que modo está seria
 * inventar um estado para ela errar.
 */
function abasDoVinculo(papel: "coach" | "nutri", escopo: Escopo): [Aba, string][] {
  const abas: [Aba, string][] = [];
  if (papel === "coach") {
    // As duas exigem `escopo.treinos`: a rota de prescrição também é guardada
    // com `{ parte: "treinos" }` (api/src/routes/pro.ts) — sem isto, o coach
    // via aba que dá 403 ao salvar.
    if (escopo.treinos) {
      abas.push(["evolucao", "Evolução"]);
      abas.push(["treino", "Prescrever treino"]);
    }
  }
  if (papel === "nutri") {
    if (escopo.dieta) abas.push(["nutricao", "Nutrição"], ["dieta", "Prescrever dieta"]);
  }
  abas.push(["conversa", "Conversa"]);
  return abas;
}

export function Aluno({
  token,
  alunoId,
  euId,
  voltar,
}: {
  token: string;
  alunoId: string;
  euId: string;
  voltar: () => void;
}) {
  const [perfil, setPerfil] = useState<PerfilDoAluno | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  // Não dá para inicializar com uma aba fixa: qual existe depende do perfil,
  // que ainda não chegou. `null` até lá, e a aba de fato usada é derivada mais
  // abaixo — a partir das abas disponíveis — para nunca ficar presa numa que
  // sumiu (ex.: aluno fechou o escopo depois de a pessoa tê-la selecionado).
  const [abaEscolhida, setAbaEscolhida] = useState<Aba | null>(null);
  /**
   * Qual vínculo alimenta a aba Conversa quando a dupla tem dois papéis.
   *
   * `ProMessage.link` aponta para UM vínculo específico: coach e nutri do
   * mesmo aluno têm duas conversas separadas de verdade, não uma só vista de
   * dois jeitos. Escolher uma sozinho escondia a outra sem a pessoa saber que
   * ela existe — por isso isto é estado visível e trocável, não um cálculo.
   */
  const [linkDaConversa, setLinkDaConversa] = useState<string | null>(null);

  /**
   * A janela vale para a tela inteira.
   *
   * É o mesmo seletor que o aluno tem na aba Progresso dele, e por isso manda
   * em tudo de uma vez: ver a curva de 90 dias ao lado de um radar de 30 seria
   * comparar coisas que não se comparam, e é o tipo de erro que só aparece
   * depois de uma conversa inteira baseada nele.
   */
  const [janela, setJanela] = useState<Janela>(90);
  /** Musculação ou cardio — a mesma divisão que o aluno tem na aba dele. */
  const [modo, setModo] = useState<"forca" | "cardio">("forca");
  const [metrica, setMetrica] = useState<Metrica>("carga_max");

  const [exercicio, setExercicio] = useState<ExercicioNaLista | null>(null);
  const [serie, setSerie] = useState<PontoDaSerie[]>([]);
  const [grupos, setGrupos] = useState<GrupoTreinado[]>([]);
  const [conquistas, setConquistas] = useState<Conquista[]>([]);
  const [maisConquistas, setMaisConquistas] = useState<string | null>(null);

  const [cardio, setCardio] = useState<EsporteNaLista[]>([]);
  const [esporte, setEsporte] = useState<string | null>(null);
  const [metricaCardio, setMetricaCardio] = useState<MetricaCardio>("pace");
  const [serieCardio, setSerieCardio] = useState<PontoDaSerie[]>([]);
  /** Vem do servidor: no pace, correr melhor é um número menor. */
  const [paceInvertido, setPaceInvertido] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await buscarAluno(token, alunoId, janela);
      setPerfil(r.data);
      // Mantém o exercício escolhido quando ele existe na janela nova; trocar
      // de janela não pode trocar o assunto embaixo do coach.
      setExercicio((atual) => {
        // Ausente quando ninguém abriu `escopo.treinos` para esta pessoa —
        // ausência de dado, não lista vazia por falta de treino.
        const lista = r.data.exercicios ?? [];
        return lista.find((e) => e.slug === atual?.slug) ?? lista[0] ?? null;
      });
      setErro(null);
    } catch (e) {
      // 403 aqui é informação, não falha: o aluno fechou os treinos, e o
      // profissional precisa saber disso — não ver uma página vazia.
      setErro(
        e instanceof ErroApi && e.status === 403
          ? "Este aluno fechou os treinos para você."
          : "Não foi possível carregar este aluno."
      );
    } finally {
      setCarregando(false);
    }
  }, [token, alunoId, janela]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // A curva do exercício escolhido, buscada à parte: trocar de exercício ou de
  // métrica não deve recarregar o perfil inteiro.
  useEffect(() => {
    if (!exercicio) {
      setSerie([]);
      return;
    }
    let vivo = true;
    buscarSerie(token, alunoId, exercicio.slug, janela, metrica)
      .then((r) => vivo && setSerie(r.data))
      .catch(() => vivo && setSerie([]));
    return () => {
      vivo = false;
    };
  }, [token, alunoId, exercicio, janela, metrica]);

  useEffect(() => {
    let vivo = true;
    buscarGrupos(token, alunoId, janela)
      .then((r) => vivo && setGrupos(r.data))
      .catch(() => vivo && setGrupos([]));
    return () => {
      vivo = false;
    };
  }, [token, alunoId, janela]);

  useEffect(() => {
    let vivo = true;
    buscarCardio(token, alunoId, janela)
      .then((r) => {
        if (!vivo) return;
        setCardio(r.data);
        // Mantém o esporte escolhido quando ele existe na janela nova.
        setEsporte((atual) =>
          atual && r.data.some((e) => e.sportId === atual) ? atual : (r.data[0]?.sportId ?? null)
        );
      })
      .catch(() => vivo && setCardio([]));
    return () => {
      vivo = false;
    };
  }, [token, alunoId, janela]);

  useEffect(() => {
    if (!esporte) {
      setSerieCardio([]);
      return;
    }
    let vivo = true;
    buscarSerieDeCardio(token, alunoId, esporte, janela, metricaCardio)
      .then((r) => {
        if (!vivo) return;
        setSerieCardio(r.pontos);
        setPaceInvertido(r.menorEhMelhor);
      })
      .catch(() => vivo && setSerieCardio([]));
    return () => {
      vivo = false;
    };
  }, [token, alunoId, esporte, janela, metricaCardio]);

  // As conquistas não têm janela: o recorde que caiu há oito meses continua
  // sendo o recorde, e escondê-lo porque a janela é de 30 dias mentiria.
  useEffect(() => {
    let vivo = true;
    buscarConquistas(token, alunoId)
      .then((r) => {
        if (!vivo) return;
        setConquistas(r.itens);
        setMaisConquistas(r.proximo);
      })
      .catch(() => vivo && setConquistas([]));
    return () => {
      vivo = false;
    };
  }, [token, alunoId]);

  async function verConquistasAntigas() {
    if (!maisConquistas) return;
    try {
      const r = await buscarConquistas(token, alunoId, maisConquistas);
      setConquistas((atual) => [...atual, ...r.itens]);
      setMaisConquistas(r.proximo);
    } catch {
      // Falhar em buscar o passado não pode apagar o que já está na tela.
    }
  }

  async function encerrar() {
    if (!perfil) return;
    const certeza = window.confirm(
      `Encerrar o acompanhamento de ${perfil.aluno.nome}? Ele perde o acesso ao seu treino e você aos dados dele. O histórico fica.`
    );
    if (!certeza) return;
    try {
      await encerrarAluno(token, perfil.vinculo.id);
      voltar();
    } catch {
      setErro("Não foi possível encerrar o acompanhamento.");
    }
  }

  if (carregando) return <p className="vazio">Carregando…</p>;

  if (erro || !perfil) {
    return (
      <>
        <button className="discreto" onClick={voltar}>
          ← Alunos
        </button>
        <p className="erro" style={{ marginTop: 16 }}>
          {erro}
        </p>
      </>
    );
  }

  const abas = perfil.vinculos.flatMap((v) => abasDoVinculo(v.papel, v.escopo));
  // "Conversa" sai uma vez só, mesmo com dois vínculos.
  const unicas = abas.filter(([id], i) => abas.findIndex(([x]) => x === id) === i);
  // `unicas` nunca vem vazia: a ficha exige ao menos um vínculo ativo para
  // existir, e `abasDoVinculo` sempre inclui "conversa" para qualquer papel.
  const aba: Aba =
    abaEscolhida && unicas.some(([id]) => id === abaEscolhida) ? abaEscolhida : unicas[0][0];
  // Quando há só um vínculo, isto é sempre `perfil.vinculo.id` — o mesmo de
  // antes. O `find` só muda de resultado quando a pessoa escolhe no seletor.
  const conversaLinkId =
    perfil.vinculos.find((v) => v.id === linkDaConversa)?.id ?? perfil.vinculo.id;

  const dias = perfil.constancia?.lastCheckIn
    ? Math.floor((Date.now() - new Date(perfil.constancia.lastCheckIn).getTime()) / 86_400_000)
    : null;

  const unidade = unidadeDaMetrica(metrica);
  const esporteAtual = cardio.find((e) => e.sportId === esporte) ?? null;

  // Esteira sem marcar quilômetro não tem pace — e pace é a métrica padrão.
  // Sem isto, o esporte aparece na lista, o coach clica e o gráfico vem vazio,
  // o que parece defeito. Só desvia do PADRÃO: uma escolha explícita fica.
  if (metricaCardio === "pace" && esporteAtual && esporteAtual.melhorPace === 0) {
    setMetricaCardio("duracao");
  }

  const painelDeConquistas = (
            <div className="painel">
      <b>Histórico de conquistas</b>
      {conquistas.length === 0 ? (
        <p className="vazio">Nenhum recorde registrado ainda.</p>
      ) : (
        <div className="linhas" style={{ marginTop: 8 }}>
          {conquistas.map((c) => (
            <div key={c.id} className="linha" style={{ cursor: "default" }}>
              <span className="crescer">
                <span className="nome">{nomeDoExercicio(c.exerciseName)}</span>
                <br />
                <span className="sub">
                  {rotuloDoRecorde(c.type, c.repRange)} · de{" "}
                  {valorDoRecorde(c.type, c.previousValue, c.unit)} para{" "}
                  {valorDoRecorde(c.type, c.value, c.unit)}
                </span>
              </span>
              <span className="sub">
                {new Date(c.achievedAt).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      )}
      {maisConquistas && (
        <button className="discreto" style={{ marginTop: 12 }} onClick={verConquistasAntigas}>
          Ver conquistas mais antigas
        </button>
      )}
    </div>
  );
  const naJanela = janela === 0 ? "no histórico todo" : `em ${rotuloDaJanela(janela).toLowerCase()}`;

  return (
    <>
      <button className="discreto" onClick={voltar}>
        ← Alunos
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "16px 0 8px" }}>
        {perfil.aluno.avatarUrl ? (
          <img className="avatar" style={{ width: 52, height: 52 }} src={perfil.aluno.avatarUrl} alt="" />
        ) : (
          <div className="avatar" style={{ width: 52, height: 52 }} aria-hidden />
        )}
        <div>
          <h1>{perfil.aluno.nome}</h1>
          <p className="sub" style={{ margin: 0 }}>
            {perfil.aluno.username ? `@${perfil.aluno.username} · ` : ""}
            acompanhado desde {new Date(perfil.vinculo.desde).toLocaleDateString("pt-BR")}
          </p>
        </div>
      </div>

      {/* Some inteiro, não mostra zero: ausência é "não me deixou ver", e
          zero seria uma afirmação sobre a vida do aluno (mesma regra do
          comentário em api/src/routes/pro.ts sobre omitir estes campos). */}
      {perfil.constancia && (
        <div className="cartoes" style={{ marginBottom: 16 }}>
          <div className="cartao">
            <div className="num">{perfil.constancia.streak}</div>
            <div className="rotulo">dias seguidos</div>
          </div>
          <div className="cartao">
            <div className="num">{perfil.constancia.week}</div>
            <div className="rotulo">treinos na semana</div>
          </div>
          <div className="cartao">
            <div className="num">{perfil.constancia.total}</div>
            <div className="rotulo">treinos no total</div>
            {dias !== null && (
              <div className="aviso">
                {dias === 0 ? "treinou hoje" : `último há ${dias} ${dias === 1 ? "dia" : "dias"}`}
              </div>
            )}
          </div>
        </div>
      )}

      <nav className="nav" style={{ flexDirection: "row", marginBottom: 16 }}>
        {unicas.map(([id, rotulo]) => (
          <button
            key={id}
            aria-current={aba === id ? "page" : undefined}
            onClick={() => setAbaEscolhida(id)}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {/* A janela fica FORA das abas — não dentro da guarda `evolucao` — porque
          serve as duas telas que dependem dela (Evolução e Nutrição), e as duas
          usam o mesmo período por definição (comentário em `janela`, acima).
          Antes ela vivia dentro do bloco de Evolução, então trocar para
          Nutrição trocava de aba sem trocar de período em silêncio: o
          nutricionista via 90 dias de treino e, ao mudar de aba, continuava
          vendo "90 dias" no cabeçalho mas sem chip nenhum aceso para provar
          isso. Uma barra só, no mesmo lugar, para as duas. */}
      {(aba === "evolucao" || aba === "nutricao") && (
        <div className="chips" role="group" aria-label="Janela de tempo" style={{ marginBottom: 16 }}>
          {JANELAS.map((d) => (
            <button key={d} aria-pressed={janela === d} onClick={() => setJanela(d)}>
              {rotuloDaJanela(d)}
            </button>
          ))}
        </div>
      )}

      {/* `exercicios`/`calendario` estruturalmente vêm juntos com esta aba —
          ela só existe quando `escopo.treinos` é verdadeiro, o mesmo `podeTreinos`
          que faz o backend incluir os dois. A checagem aqui é defensiva: dá ao
          TypeScript o mesmo fato, em vez de assumir undefined como array vazio. */}
      {aba === "evolucao" && perfil.exercicios && perfil.calendario && (
        <>
          <nav className="nav" style={{ flexDirection: "row", marginBottom: 12 }}>
            {(
              [
                ["forca", "Musculação"],
                ["cardio", "Cardio"],
              ] as const
            ).map(([id, rotulo]) => (
              <button
                key={id}
                aria-current={modo === id ? "page" : undefined}
                onClick={() => setModo(id)}
              >
                {rotulo}
              </button>
            ))}
          </nav>

          {modo === "cardio" && (
            <div className="duas-colunas">
              <div className="painel">
                <b>{esporteAtual ? esporteAtual.nome : "Cardio"}</b>
                {esporteAtual && (
                  <p className="sub" style={{ marginTop: 2 }}>
                    {formatarCardio(esporteAtual.distanciaKm, "distancia")} · {esporteAtual.vezes}{" "}
                    {esporteAtual.vezes === 1 ? "sessão" : "sessões"} {naJanela}
                    {esporteAtual.melhorPace > 0 && (
                      <> · melhor pace {formatarCardio(esporteAtual.melhorPace, "pace")}/km</>
                    )}
                  </p>
                )}

                <div className="chips" role="group" aria-label="Métrica" style={{ marginTop: 12 }}>
                  {METRICAS_CARDIO.map((m) => (
                    <button
                      key={m}
                      aria-pressed={metricaCardio === m}
                      onClick={() => setMetricaCardio(m)}
                    >
                      {rotuloDaMetricaCardio(m)}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 12 }}>
                  <Suspense fallback={<p className="vazio">Carregando gráfico…</p>}>
                    <Grafico
                      dados={serieCardio.map((p) => ({ x: p.data, valor: p.valor, ehPR: p.ehPR }))}
                      formatar={(v) => formatarCardio(v, metricaCardio)}
                      menorEhMelhor={paceInvertido}
                    />
                  </Suspense>
                  {paceInvertido && serieCardio.length > 1 && (
                    <p className="sub" style={{ marginTop: 8 }}>
                      Eixo invertido: mais alto é mais rápido.
                    </p>
                  )}
                </div>
              </div>

              <div className="painel">
                <b>O que ele pratica</b>
                {cardio.length === 0 ? (
                  <p className="vazio">Nenhum treino de cardio {naJanela}.</p>
                ) : (
                  <div className="linhas" style={{ marginTop: 8 }}>
                    {cardio.map((e) => (
                      <button
                        key={e.sportId}
                        className="linha"
                        aria-current={esporte === e.sportId ? "true" : undefined}
                        onClick={() => setEsporte(e.sportId)}
                      >
                        <span className="crescer">
                          <span className="nome">{e.nome}</span>
                          <br />
                          <span className="sub">
                            {e.vezes}x · {formatarCardio(e.distanciaKm, "distancia")}
                          </span>
                        </span>
                        {e.delta !== null && (
                          <span className={`selo ${e.delta >= 0 ? "ok" : "neutro"}`}>
                            {/* Melhora no pace é tempo a MENOS: o sinal que o
                                olho espera é o invertido do delta. */}
                            {e.delta >= 0 ? "−" : "+"}
                            {formatarCardio(Math.abs(e.delta), "pace")}/km
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {modo === "forca" && (
          <div className="duas-colunas">
            <div className="painel">
              <b>{exercicio ? exercicio.nome : "Exercícios"}</b>
              {exercicio && (
                <p className="sub" style={{ marginTop: 2 }}>
                  Melhor {exercicio.melhor} kg · {exercicio.vezes}{" "}
                  {exercicio.vezes === 1 ? "treino" : "treinos"} {naJanela}
                  {exercicio.delta !== null && (
                    <>
                      {" · "}
                      <span style={{ color: exercicio.delta >= 0 ? "var(--verde-claro)" : "var(--texto-3)" }}>
                        {exercicio.delta >= 0 ? "+" : "−"}
                        {Math.abs(exercicio.delta)} kg
                      </span>
                    </>
                  )}
                </p>
              )}

              <div className="chips" role="group" aria-label="Métrica" style={{ marginTop: 12 }}>
                {METRICAS.map((m) => (
                  <button key={m} aria-pressed={metrica === m} onClick={() => setMetrica(m)}>
                    {rotuloDaMetrica(m)}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 12 }}>
                <Suspense fallback={<p className="vazio">Carregando gráfico…</p>}>
                  <Grafico
                    dados={serie.map((p) => ({ x: p.data, valor: p.valor, ehPR: p.ehPR }))}
                    formatar={(v) => `${v}${unidade === "kg" ? "kg" : ""}`}
                  />
                </Suspense>
                {serie.some((p) => p.ehPR) && (
                  <p className="sub" style={{ marginTop: 8 }}>
                    ● os pontos marcados são recordes
                  </p>
                )}
              </div>
            </div>

            <div className="painel">
              <b>O que ele treina</b>
              {perfil.exercicios.length === 0 ? (
                <p className="vazio">Nenhum treino de força {naJanela}.</p>
              ) : (
                <div className="linhas" style={{ marginTop: 8 }}>
                  {perfil.exercicios.map((e) => (
                    <button
                      key={e.slug}
                      className="linha"
                      aria-current={exercicio?.slug === e.slug ? "true" : undefined}
                      onClick={() => setExercicio(e)}
                    >
                      <span className="crescer">
                        <span className="nome">{e.nome}</span>
                        <br />
                        <span className="sub">
                          {e.vezes}x · melhor {e.melhor} kg
                        </span>
                      </span>
                      {e.delta !== null && (
                        <span className={`selo ${e.delta >= 0 ? "ok" : "neutro"}`}>
                          {e.delta >= 0 ? "+" : "−"}
                          {Math.abs(e.delta)} kg
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          )}

          {modo === "forca" && (
          <div style={{ marginTop: 16 }}>
            <div className="painel">
              <b>Por grupo muscular</b>
              <p className="sub" style={{ marginTop: 2 }}>
                Séries válidas {naJanela}. O vazio do desenho é onde falta treino.
              </p>
              <div style={{ marginTop: 12 }}>
                <Suspense fallback={<p className="vazio">Carregando radar…</p>}>
                  <RadarDeGrupos dados={grupos} />
                </Suspense>
              </div>
            </div>

          </div>
          )}

          {/* As conquistas ficam FORA do seletor de modo: recorde de corrida é
              conquista do mesmo jeito, e escondê-la em "Musculação" faria a
              lista mentir sobre o que o aluno conquistou. */}
          <div style={{ marginTop: 16 }}>{painelDeConquistas}</div>

          <div className="painel" style={{ marginTop: 16 }}>
            <b>Calendário</b>
            <p className="sub" style={{ marginTop: 2, marginBottom: 12 }}>
              Todos os esportes, não só a musculação.
            </p>
            <Calendario dias={perfil.calendario} />
          </div>
        </>
      )}

      {aba === "treino" && (
        <div className="painel">
          <Prescrever token={token} alunoId={perfil.aluno.id} aoSalvar={carregar} />
        </div>
      )}

      {aba === "nutricao" && (
        <div className="painel">
          <Suspense fallback={<p className="vazio">Carregando gráfico…</p>}>
            <Nutricao token={token} alunoId={perfil.aluno.id} janela={janela} />
          </Suspense>
        </div>
      )}

      {aba === "conversa" && (
        <div className="painel">
          {/* Só aparece com dois vínculos — coach e nutri do mesmo aluno têm
              conversas separadas de verdade, e escondida a escolha a pessoa
              não teria como saber que a outra existe nem como chegar nela. */}
          {perfil.vinculos.length > 1 && (
            <div className="chips" role="group" aria-label="Qual conversa" style={{ marginBottom: 12 }}>
              {perfil.vinculos.map((v) => (
                <button
                  key={v.id}
                  aria-pressed={conversaLinkId === v.id}
                  onClick={() => setLinkDaConversa(v.id)}
                >
                  {v.papel === "coach" ? "Treino" : "Nutrição"}
                </button>
              ))}
            </div>
          )}
          <Conversa
            key={conversaLinkId}
            token={token}
            linkId={conversaLinkId}
            euId={euId}
            nomeDoAluno={perfil.aluno.nome}
          />
        </div>
      )}

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <button className="discreto perigo" onClick={encerrar}>
          Encerrar acompanhamento
        </button>
      </div>
    </>
  );
}
