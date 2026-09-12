import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  buscarAluno,
  buscarConquistas,
  buscarGrupos,
  buscarSerie,
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
  type ExercicioNaLista,
  type GrupoTreinado,
  type Janela,
  type Metrica,
  type PerfilDoAluno,
  type PontoDaSerie,
} from "../api";
import { Calendario } from "../components/Calendario";
import { Conversa } from "../components/Conversa";
import { Prescrever } from "../components/Prescrever";

// O Recharts sozinho pesa mais que o resto do painel inteiro. Separado, a
// lista de alunos e a tela de convites não pagam por ele — e é a lista que
// abre primeiro, todo dia.
const Grafico = lazy(() => import("../components/Grafico").then((m) => ({ default: m.Grafico })));
const RadarDeGrupos = lazy(() =>
  import("../components/Radar").then((m) => ({ default: m.RadarDeGrupos }))
);

type Aba = "evolucao" | "treino" | "conversa";

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
  const [aba, setAba] = useState<Aba>("evolucao");

  /**
   * A janela vale para a tela inteira.
   *
   * É o mesmo seletor que o aluno tem na aba Progresso dele, e por isso manda
   * em tudo de uma vez: ver a curva de 90 dias ao lado de um radar de 30 seria
   * comparar coisas que não se comparam, e é o tipo de erro que só aparece
   * depois de uma conversa inteira baseada nele.
   */
  const [janela, setJanela] = useState<Janela>(90);
  const [metrica, setMetrica] = useState<Metrica>("carga_max");

  const [exercicio, setExercicio] = useState<ExercicioNaLista | null>(null);
  const [serie, setSerie] = useState<PontoDaSerie[]>([]);
  const [grupos, setGrupos] = useState<GrupoTreinado[]>([]);
  const [conquistas, setConquistas] = useState<Conquista[]>([]);
  const [maisConquistas, setMaisConquistas] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await buscarAluno(token, alunoId, janela);
      setPerfil(r.data);
      // Mantém o exercício escolhido quando ele existe na janela nova; trocar
      // de janela não pode trocar o assunto embaixo do coach.
      setExercicio((atual) => {
        const lista = r.data.exercicios;
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

  const dias = perfil.constancia.lastCheckIn
    ? Math.floor((Date.now() - new Date(perfil.constancia.lastCheckIn).getTime()) / 86_400_000)
    : null;

  const unidade = unidadeDaMetrica(metrica);
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

      <nav className="nav" style={{ flexDirection: "row", marginBottom: 16 }}>
        {(
          [
            ["evolucao", "Evolução"],
            ["treino", "Prescrever treino"],
            ["conversa", "Conversa"],
          ] as const
        ).map(([id, rotulo]) => (
          <button key={id} aria-current={aba === id ? "page" : undefined} onClick={() => setAba(id)}>
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === "evolucao" && (
        <>
          <div
            className="chips"
            role="group"
            aria-label="Janela de tempo"
            style={{ marginBottom: 16 }}
          >
            {JANELAS.map((d) => (
              <button key={d} aria-pressed={janela === d} onClick={() => setJanela(d)}>
                {rotuloDaJanela(d)}
              </button>
            ))}
          </div>

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

          <div className="duas-colunas" style={{ marginTop: 16 }}>
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
          </div>

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

      {aba === "conversa" && (
        <div className="painel">
          <Conversa
            token={token}
            linkId={perfil.vinculo.id}
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
