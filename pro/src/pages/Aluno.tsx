import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  api,
  buscarAluno,
  encerrarAluno,
  ErroApi,
  type ExercicioNaLista,
  type PerfilDoAluno,
} from "../api";
import { Conversa } from "../components/Conversa";
import { Prescrever } from "../components/Prescrever";

// O Recharts sozinho pesa mais que o resto do painel inteiro. Separado, a
// lista de alunos e a tela de convites não pagam por ele — e é a lista que
// abre primeiro, todo dia.
const Grafico = lazy(() => import("../components/Grafico").then((m) => ({ default: m.Grafico })));

type Aba = "evolucao" | "treino" | "conversa";

interface PontoDaSerie {
  data: string;
  valor: number;
  ehPR: boolean;
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
  const [aba, setAba] = useState<Aba>("evolucao");

  const [exercicio, setExercicio] = useState<ExercicioNaLista | null>(null);
  const [serie, setSerie] = useState<PontoDaSerie[]>([]);

  const carregar = useCallback(async () => {
    try {
      const r = await buscarAluno(token, alunoId);
      setPerfil(r.data);
      setExercicio((atual) => atual ?? r.data.exercicios[0] ?? null);
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
  }, [token, alunoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // A curva do exercício escolhido, buscada à parte: trocar de exercício não
  // deve recarregar o perfil inteiro.
  useEffect(() => {
    if (!exercicio) {
      setSerie([]);
      return;
    }
    let vivo = true;
    api<PontoDaSerie[]>(`/pro/alunos/${alunoId}/exercicios/${exercicio.slug}?dias=90`, { token })
      .then((r) => vivo && setSerie(r.data))
      .catch(() => vivo && setSerie([]));
    return () => {
      vivo = false;
    };
  }, [token, alunoId, exercicio]);

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
        <div className="duas-colunas">
          <div className="painel">
            <b>{exercicio ? exercicio.nome : "Exercícios"}</b>
            {exercicio && (
              <p className="sub" style={{ marginTop: 2 }}>
                Melhor {exercicio.melhor} kg · {exercicio.vezes}{" "}
                {exercicio.vezes === 1 ? "treino" : "treinos"} em 90 dias
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
            <div style={{ marginTop: 12 }}>
              <Suspense fallback={<p className="vazio">Carregando gráfico…</p>}>
                <Grafico
                  dados={serie.map((p) => ({ x: p.data, valor: p.valor }))}
                  formatar={(v) => `${v}kg`}
                />
              </Suspense>
            </div>
          </div>

          <div className="painel">
            <b>O que ele treina</b>
            {perfil.exercicios.length === 0 ? (
              <p className="vazio">Nenhum treino de força nos últimos 90 dias.</p>
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

      {aba === "treino" && (
        <div className="painel">
          <Prescrever token={token} alunoId={perfil.aluno.id} aoSalvar={carregar} />
        </div>
      )}

      {aba === "conversa" && (
        <div className="painel">
          <Conversa token={token} linkId={perfil.vinculo.id} euId={euId} />
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
