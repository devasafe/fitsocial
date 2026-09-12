import { useCallback, useEffect, useState } from "react";
import { buscarNaoLidas, listarAlunos, type AlunoNaLista } from "../api";

/** Quantos dias desde o último treino. Nulo quando nunca treinou. */
function diasSemTreinar(ultimoEm: string | null): number | null {
  if (!ultimoEm) return null;
  return Math.floor((Date.now() - new Date(ultimoEm).getTime()) / 86_400_000);
}

/**
 * O sinal que a lista dá antes de o coach perguntar.
 *
 * A ordem de leitura de uma lista de alunos não é alfabética — é "quem precisa
 * de mim hoje". Sete dias é o corte porque uma semana inteira sem treinar é o
 * ponto em que a pessoa deixou de ter um imprevisto e passou a estar sumindo.
 */
function situacao(a: AlunoNaLista): { texto: string; classe: string; peso: number } {
  if (!a.treinos) return { texto: "sem acesso", classe: "neutro", peso: 1 };

  const dias = diasSemTreinar(a.treinos.ultimoEm);
  if (dias === null) return { texto: "nunca treinou", classe: "sumido", peso: 3 };
  if (dias >= 7) return { texto: `${dias} dias sem treinar`, classe: "sumido", peso: 3 };
  if (dias >= 4) return { texto: `${dias} dias sem treinar`, classe: "atencao", peso: 2 };
  return { texto: `${a.treinos.naSemana}x na semana`, classe: "ok", peso: 0 };
}

export function Alunos({ token, abrir }: { token: string; abrir: (alunoId: string) => void }) {
  const [lista, setLista] = useState<AlunoNaLista[]>([]);
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await listarAlunos(token);
      setLista(r.data);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar seus alunos.");
    } finally {
      setCarregando(false);
    }
    // As não lidas são enfeite: falhar aqui não pode esvaziar a lista.
    try {
      const n = await buscarNaoLidas(token);
      setNaoLidas(Object.fromEntries(n.data.map((x) => [x.link, x.naoLidas])));
    } catch {
      setNaoLidas({});
    }
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (carregando) return <p className="vazio">Carregando…</p>;
  if (erro) return <p className="erro">{erro}</p>;

  if (lista.length === 0) {
    return (
      <>
        <h1>Alunos</h1>
        <div className="painel" style={{ marginTop: 16 }}>
          <p style={{ marginTop: 0 }}>Você ainda não acompanha ninguém.</p>
          <p className="sub" style={{ marginBottom: 0 }}>
            Gere um convite em <b>Convites</b> e mande o link para o seu aluno. Ele aceita, escolhe
            o que abrir, e aparece aqui.
          </p>
        </div>
      </>
    );
  }

  // Quem precisa de atenção primeiro; dentro do mesmo peso, o que sumiu há mais
  // tempo. Ordem alfabética seria bonita e inútil.
  const ordenada = [...lista].sort((a, b) => {
    const pa = situacao(a).peso;
    const pb = situacao(b).peso;
    if (pa !== pb) return pb - pa;
    return (diasSemTreinar(b.treinos?.ultimoEm ?? null) ?? 0) - (diasSemTreinar(a.treinos?.ultimoEm ?? null) ?? 0);
  });

  const precisam = ordenada.filter((a) => situacao(a).peso >= 2).length;

  return (
    <>
      <h1>Alunos</h1>
      <p className="sub" style={{ marginBottom: 24 }}>
        {lista.length} {lista.length === 1 ? "pessoa" : "pessoas"}
        {precisam > 0 && ` · ${precisam} ${precisam === 1 ? "precisa" : "precisam"} de atenção`}
      </p>

      <div className="painel">
        <div className="linhas">
          {ordenada.map((a) => {
            const s = situacao(a);
            const naoLidasAqui = naoLidas[a.id] ?? 0;
            return (
              <button key={a.id} className="linha" onClick={() => abrir(a.aluno.id)}>
                {a.aluno.avatarUrl ? (
                  <img className="avatar" src={a.aluno.avatarUrl} alt="" />
                ) : (
                  <div className="avatar" aria-hidden />
                )}

                <span className="crescer">
                  <span className="nome">{a.aluno.nome}</span>
                  {a.aluno.username && <span className="sub"> @{a.aluno.username}</span>}
                  <br />
                  <span className="sub">
                    {a.papel === "coach" ? "Treino" : "Nutrição"} · desde{" "}
                    {new Date(a.desde).toLocaleDateString("pt-BR")}
                  </span>
                </span>

                {naoLidasAqui > 0 && <span className="bolinha">{naoLidasAqui}</span>}
                <span className={`selo ${s.classe}`}>{s.texto}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
