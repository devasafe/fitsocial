import { useCallback, useEffect, useState } from "react";
import {
  buscarNaoLidas,
  enviarRecadoEmLote,
  listarAlunos,
  type AlunoNaLista,
  type ResultadoDoRecado,
} from "../api";

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

  // Modo de recado: escrever uma vez e mandar para vários. Começa com NINGUÉM
  // marcado de propósito — o custo de esquecer de marcar é um recado que não
  // sai; o de vir tudo marcado é a turma inteira recebendo o que era para uma
  // pessoa só, e isso não tem desfazer.
  const [selecionando, setSelecionando] = useState(false);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [texto, setTexto] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDoRecado | null>(null);
  const [erroDoRecado, setErroDoRecado] = useState<string | null>(null);

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

  function alternarMarcado(linkId: string) {
    setMarcados((atual) =>
      atual.includes(linkId) ? atual.filter((x) => x !== linkId) : [...atual, linkId]
    );
  }

  // Sair do modo limpa TUDO, inclusive o texto já digitado: um recado meio
  // escrito que sobrevive até a próxima vez é candidato a sair para a turma
  // errada.
  function sairDoModo() {
    setSelecionando(false);
    setMarcados([]);
    setTexto("");
    setFoto(null);
    setErroDoRecado(null);
  }

  async function mandarRecado(linkIds: string[]) {
    setEnviando(true);
    setErroDoRecado(null);
    try {
      const r = await enviarRecadoEmLote(token, linkIds, texto, foto);
      setResultado(r);
      setSelecionando(false);
      setMarcados([]);
      setTexto("");
      setFoto(null);
      // As não lidas do painel não mudam com o que EU mando, mas a lista traz
      // "último contato" — que acabou de mudar para todo mundo que recebeu.
      carregar();
    } catch (e) {
      setErroDoRecado(
        e instanceof Error ? e.message : "Não foi possível enviar o recado."
      );
    } finally {
      setEnviando(false);
    }
  }

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
      <p className="sub" style={{ marginBottom: 16 }}>
        {lista.length} {lista.length === 1 ? "pessoa" : "pessoas"}
        {precisam > 0 && ` · ${precisam} ${precisam === 1 ? "precisa" : "precisam"} de atenção`}
      </p>

      {/* O resultado do último envio fica na tela até ser dispensado. Some
          sozinho seria a pior opção: quando alguém ficou de fora, é a única
          chance de o profissional saber disso. */}
      {resultado && (
        <div className="painel" style={{ marginBottom: 16 }}>
          <p style={{ marginTop: 0, marginBottom: resultado.recusados.length ? 8 : 0 }}>
            Recado enviado para {resultado.enviados}{" "}
            {resultado.enviados === 1 ? "pessoa" : "pessoas"}.
          </p>
          {resultado.recusados.length > 0 && (
            <p className="sub" style={{ marginBottom: 8 }}>
              {resultado.recusados.length}{" "}
              {resultado.recusados.length === 1 ? "não recebeu" : "não receberam"}:{" "}
              {resultado.recusados[0].motivo}
            </p>
          )}
          <button className="discreto" onClick={() => setResultado(null)}>
            Fechar
          </button>
        </div>
      )}

      {!selecionando ? (
        <button
          className="discreto"
          style={{ marginBottom: 16 }}
          onClick={() => {
            setResultado(null);
            setSelecionando(true);
          }}
        >
          Mandar recado para vários
        </button>
      ) : (
        <div className="painel" style={{ marginBottom: 16 }}>
          <p className="sub" style={{ marginTop: 0 }}>
            Cada pessoa recebe o recado na conversa dela, em separado. Ninguém vê quem mais
            recebeu, e a resposta chega só para você.
          </p>

          <div className="campo">
            <label htmlFor="recado">Recado</label>
            <textarea
              id="recado"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Amanhã o treino começa 7h."
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="campo">
            <label htmlFor="recado-foto">Foto (opcional)</label>
            <input
              id="recado-foto"
              type="file"
              accept="image/*"
              onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
            />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="primario"
              disabled={enviando || marcados.length === 0 || (!texto.trim() && !foto)}
              onClick={() => mandarRecado(marcados)}
            >
              {enviando
                ? "Enviando…"
                : `Enviar para ${marcados.length} ${marcados.length === 1 ? "pessoa" : "pessoas"}`}
            </button>
            <button
              className="discreto"
              disabled={enviando}
              onClick={() =>
                setMarcados(marcados.length === ordenada.length ? [] : ordenada.map((a) => a.id))
              }
            >
              {marcados.length === ordenada.length ? "Desmarcar todos" : "Marcar todos"}
            </button>
            <button className="discreto" disabled={enviando} onClick={sairDoModo}>
              Cancelar
            </button>
          </div>

          {erroDoRecado && (
            <p className="erro" style={{ marginBottom: 0 }}>
              {erroDoRecado}
            </p>
          )}
        </div>
      )}

      <div className="painel">
        <div className="linhas">
          {ordenada.map((a) => {
            const s = situacao(a);
            const naoLidasAqui = naoLidas[a.id] ?? 0;
            const marcado = marcados.includes(a.id);
            return (
              // No modo de recado a linha marca em vez de abrir: com os dois
              // comportamentos juntos, um toque distraído levaria embora da
              // tela levando a seleção inteira junto.
              <button
                key={a.id}
                className="linha"
                aria-pressed={selecionando ? marcado : undefined}
                onClick={() => (selecionando ? alternarMarcado(a.id) : abrir(a.aluno.id))}
              >
                {selecionando && (
                  <input
                    type="checkbox"
                    checked={marcado}
                    readOnly
                    tabIndex={-1}
                    aria-hidden
                    style={{ width: 18, height: 18, flex: "none" }}
                  />
                )}
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
