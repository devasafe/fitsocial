import { useCallback, useEffect, useState } from "react";
import { buscarNaoLidas, listarAlunos, type AlunoNaLista } from "../api";

/** Quantos dias desde o último treino. Nulo quando nunca treinou. */
function diasSemTreinar(ultimoEm: string | null): number | null {
  if (!ultimoEm) return null;
  return Math.floor((Date.now() - new Date(ultimoEm).getTime()) / 86_400_000);
}

/**
 * Quantos dias desde o último registro de comida. Nulo quando nunca registrou.
 *
 * `ultimoRegistroEm` chega como `yyyy-mm-dd` — uma CHAVE de dia, não um
 * instante como `treinos.ultimoEm`. Meio-dia evita a mesma armadilha de fuso
 * que `comoData()` de `Calendario.tsx` já resolve para o calendário de treino:
 * meia-noite fica perto demais da borda e um arredondamento joga a data para o
 * dia vizinho. `Math.max(0, …)` cobre o caso do registro de hoje: se são 9h e
 * o meio-dia âncora ainda não chegou, a subtração dá negativo sem ele.
 */
function diasSemRegistrar(ultimoRegistroEm: string | null): number | null {
  if (!ultimoRegistroEm) return null;
  const dias = Math.floor((Date.now() - new Date(`${ultimoRegistroEm}T12:00:00`).getTime()) / 86_400_000);
  return Math.max(0, dias);
}

/** Dias sem contato, no sinal do papel: treino para o coach, comida para o nutri. */
function diasSemContato(a: AlunoNaLista): number | null {
  return a.papel === "nutri"
    ? diasSemRegistrar(a.nutricao?.ultimoRegistroEm ?? null)
    : diasSemTreinar(a.treinos?.ultimoEm ?? null);
}

/**
 * O sinal que a lista dá antes do profissional perguntar.
 *
 * A ordem de leitura de uma lista de alunos não é alfabética — é "quem precisa
 * de mim hoje". Mas "precisar" não é o mesmo sinal para os dois papéis: o
 * coach quer saber quem sumiu do treino, o nutricionista quer saber quem
 * parou de registrar comida — por isso a função bifurca por `a.papel` em vez
 * de olhar sempre `a.treinos`. Sete dias é o corte porque uma semana inteira
 * sem contato é o ponto em que a pessoa deixou de ter um imprevisto e passou a
 * estar sumindo — vale para as duas coisas.
 */
function situacao(a: AlunoNaLista): { texto: string; classe: string; peso: number } {
  if (a.papel === "nutri") {
    if (!a.nutricao) return { texto: "sem acesso", classe: "neutro", peso: 1 };

    const dias = diasSemRegistrar(a.nutricao.ultimoRegistroEm);
    if (dias === null) return { texto: "nunca registrou", classe: "sumido", peso: 3 };
    if (dias >= 7) return { texto: `${dias} dias sem registrar`, classe: "sumido", peso: 3 };
    if (dias >= 4) return { texto: `${dias} dias sem registrar`, classe: "atencao", peso: 2 };
    return { texto: `${a.nutricao.diasComRegistroNaSemana}x na semana`, classe: "ok", peso: 0 };
  }

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
    return (diasSemContato(b) ?? 0) - (diasSemContato(a) ?? 0);
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
