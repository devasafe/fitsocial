import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  buscarColecoes,
  buscarDocumentos,
  editarDocumento,
  apagarDocumento,
  type ColecaoResumo,
  type Documento,
} from "../api";
import { useCamada } from "../hooks/useCamada";

// Acesso direto às coleções.
//
// Existe porque o Mongo NÃO está exposto na internet — e não deve estar. Sem
// isto, apagar um documento errado exigia o console web do provedor da VPS e
// mongosh digitado à mão: mais lento, sem registro nenhum, e com o risco de um
// `deleteMany` sem filtro.
//
// A tela é deliberadamente sem graça. Ela mexe no banco sem rede de proteção,
// e o que a torna aceitável não é a interface: é o servidor guardar uma cópia
// do documento na auditoria antes de qualquer mudança.

const nf = new Intl.NumberFormat("pt-BR");

/** O JSON do documento, identado, para ler e editar. */
function comoJson(d: Documento): string {
  return JSON.stringify(d, null, 2);
}

/** Um rótulo curto para a linha da lista, sem precisar abrir. */
function resumo(d: Documento): string {
  for (const k of ["name", "title", "codigo", "email", "nome"]) {
    const v = d[k];
    if (typeof v === "string" && v) return v;
  }
  return String(d._id ?? "");
}

export function Dados({ token }: { token: string }) {
  const [colecoes, setColecoes] = useState<ColecaoResumo[] | null>(null);
  const [colecao, setColecao] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [docs, setDocs] = useState<Documento[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Documento | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  useCamada(aberto !== null, () => setAberto(null));

  useEffect(() => {
    buscarColecoes(token)
      .then((r) => setColecoes(r.data))
      .catch((e) => setErro((e as Error).message));
  }, [token]);

  const carregar = useCallback(
    async (maisPagina = false) => {
      if (!colecao) return;
      setErro(null);
      try {
        const r = await buscarDocumentos(token, colecao, {
          q: filtro.trim() || undefined,
          limit: 25,
          cursor: maisPagina ? cursor : null,
        });
        setDocs((antes) => (maisPagina && antes ? [...antes, ...r.data] : r.data));
        setCursor(r.meta?.nextCursor ?? null);
        setTotal(r.meta?.total ?? 0);
      } catch (e) {
        setErro((e as Error).message);
      }
    },
    // `cursor` de fora de propósito: incluí-lo recriaria a função a cada
    // página e o efeito abaixo recarregaria a lista do começo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, colecao, filtro]
  );

  useEffect(() => {
    if (!colecao) return;
    setDocs(null);
    setCursor(null);
    void carregar();
  }, [carregar, colecao]);

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Dados</h1>
          <p className="aviso">
            Acesso direto às coleções. Toda mudança guarda uma cópia do documento na auditoria —
            mas apagar não tem como desfazer pelo banco.
          </p>
        </div>
      </div>

      {recado && (
        <p className="aviso" style={{ color: "var(--lime)" }}>
          {recado}
        </p>
      )}
      {erro && <p className="erro">{erro}</p>}

      <div className="painel">
        {colecoes === null ? (
          <p className="vazio">Carregando…</p>
        ) : (
          <div className="filtros" style={{ flexWrap: "wrap" }}>
            {colecoes.map((c) => (
              <button
                key={c.nome}
                className={colecao === c.nome ? "ativo" : ""}
                onClick={() => {
                  setColecao(c.nome);
                  setFiltro("");
                  setRecado(null);
                }}
              >
                {c.nome} <span className="num">{nf.format(c.documentos)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {colecao && (
        <div className="painel" style={{ marginTop: 12 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void carregar();
            }}
          >
            <label>
              Filtro
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder={'{"email": "alguem@teste.com"}'}
                spellCheck={false}
              />
            </label>
            <p className="aviso">
              JSON, igual ao Compass. Vazio = tudo. Exemplos:{" "}
              <code>{'{"status": "banned"}'}</code> · <code>{'{"tier": "premium"}'}</code>
            </p>
          </form>

          {docs === null ? (
            <p className="vazio">Carregando…</p>
          ) : docs.length === 0 ? (
            <p className="vazio">Nenhum documento com esse filtro.</p>
          ) : (
            <>
              <p className="aviso">
                {nf.format(docs.length)} de {nf.format(total)}
              </p>
              <div className="rolagem-tabela">
                <table>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={String(d._id)}>
                        <td>
                          {resumo(d)}
                          <div className="aviso num" style={{ color: "var(--texto-3)" }}>
                            {String(d._id)}
                          </div>
                        </td>
                        <td className="dir">
                          <button className="discreto" onClick={() => setAberto(d)}>
                            Abrir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cursor && (
                <button className="discreto" onClick={() => void carregar(true)}>
                  Carregar mais
                </button>
              )}
            </>
          )}
        </div>
      )}

      {aberto && colecao && (
        <Editor
          token={token}
          colecao={colecao}
          documento={aberto}
          aoFechar={() => setAberto(null)}
          aoMudar={(msg) => {
            setAberto(null);
            setRecado(msg);
            void carregar();
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ editor

function Editor({
  token,
  colecao,
  documento,
  aoFechar,
  aoMudar,
}: {
  token: string;
  colecao: string;
  documento: Documento;
  aoFechar: () => void;
  aoMudar: (recado: string) => void;
}) {
  const id = String(documento._id);
  const [campos, setCampos] = useState("{}");
  const [motivo, setMotivo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [apagando, setApagando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const parsed = JSON.parse(campos) as Documento;
      if (Object.keys(parsed).length === 0) throw new Error("Nenhum campo para mudar.");
      await editarDocumento(token, colecao, id, parsed, motivo.trim());
      aoMudar(`${colecao}/${id} atualizado.`);
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  async function apagar() {
    setEnviando(true);
    setErro(null);
    try {
      await apagarDocumento(token, colecao, id, motivo.trim(), confirmacao.trim());
      aoMudar(`${colecao}/${id} apagado. A cópia ficou na auditoria.`);
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <div
      className="cortina"
      role="dialog"
      aria-modal="true"
      aria-label={`${colecao} ${id}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) aoFechar();
      }}
    >
      <div className="dialogo">
        <h2>
          {colecao} <span className="num" style={{ fontSize: 12 }}>{id}</span>
        </h2>

        <div style={{ marginTop: 8 }}>
          <label>Documento</label>
          <textarea
            readOnly
            value={comoJson(documento)}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 200,
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              background: "var(--surface-2)",
              color: "var(--texto-2)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 8,
            }}
          />
        </div>

        {apagando ? (
          <>
            <p className="erro" style={{ marginTop: 12 }}>
              Apagar não tem como desfazer pelo banco. Uma cópia fica na auditoria.
            </p>
            <label>
              Digite o id para confirmar
              <input
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder={id}
                spellCheck={false}
              />
            </label>
            <label>
              Motivo
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Fica registrado na auditoria"
                minLength={3}
              />
            </label>
            {erro && <p className="erro">{erro}</p>}
            <div className="dialogo-acoes">
              <button className="discreto" onClick={() => setApagando(false)} disabled={enviando}>
                Voltar
              </button>
              <button
                className="acao perigosa"
                onClick={() => void apagar()}
                disabled={enviando || confirmacao.trim() !== id || motivo.trim().length < 3}
              >
                {enviando ? "Apagando…" : "Apagar"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={salvar}>
            <label style={{ marginTop: 12 }}>
              Campos a mudar (JSON)
              <textarea
                value={campos}
                onChange={(e) => setCampos(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 80,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 12,
                  background: "var(--surface-2)",
                  color: "var(--texto)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: 8,
                }}
              />
            </label>
            <p className="aviso">
              Só os campos informados mudam; o resto do documento fica como está.
            </p>
            <label>
              Motivo
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Fica registrado na auditoria"
                minLength={3}
              />
            </label>
            {erro && <p className="erro">{erro}</p>}
            <div className="dialogo-acoes">
              <button type="button" className="discreto" onClick={aoFechar} disabled={enviando}>
                Fechar
              </button>
              <button
                type="button"
                className="discreto"
                onClick={() => {
                  setApagando(true);
                  setErro(null);
                }}
                disabled={enviando}
                style={{ color: "var(--perigo)" }}
              >
                Apagar
              </button>
              <button
                type="submit"
                className="acao"
                disabled={enviando || motivo.trim().length < 3 || campos.trim() === "{}"}
              >
                {enviando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
