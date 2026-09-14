import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buscarColecoes,
  buscarDocumentos,
  editarDocumento,
  apagarDocumento,
  reconciliarContadores,
  type CampoMeta,
  type ColecaoResumo,
  type Documento,
  type MetaDocumentos,
} from "../api";
import { useCamada } from "../hooks/useCamada";
import { useEhCelular } from "../hooks/useEhCelular";

// Os dados, para gente.
//
// A primeira versão desta tela mostrava `_id` numa coluna e o documento como
// JSON cru — e não era descuido de layout: ela não tinha COMO fazer melhor,
// porque o servidor não contava o que cada campo era. Agora ele conta (tipo,
// enum, obrigatório), e é isso que sustenta tudo aqui: enum vira seletor,
// booleano vira chave, data vira "14/09/26 07:32", e `_id` sai da frente.
//
// A regra de leitura: quem abre esta tela quer ACHAR alguém e CONSERTAR um
// campo. Todo o resto — JSON, filtro do Mongo, ids — é saída de emergência, e
// fica atrás de um clique.

const nf = new Intl.NumberFormat("pt-BR");

/** Grupos, para não jogar 24 botões numa linha. */
const GRUPOS: { titulo: string; colecoes: string[] }[] = [
  { titulo: "Contas", colecoes: ["User", "Post", "Comment", "Report", "Notification"] },
  {
    titulo: "Treino",
    colecoes: [
      "Activity",
      "Plan",
      "WorkoutLog",
      "FoodLog",
      "WaterLog",
      "PersonalRecord",
      "ExerciseVideo",
    ],
  },
  { titulo: "Desafios", colecoes: ["Challenge", "ChallengeMember"] },
  {
    titulo: "Acompanhamento",
    colecoes: ["ProfessionalLink", "ProfessionalInvite", "CoachMessage", "ProMessage"],
  },
  {
    titulo: "Cobrança",
    colecoes: ["Assinatura", "Cobranca", "EventoDeCobranca", "Cupom", "CupomUso"],
  },
  { titulo: "Sistema", colecoes: ["AdminAudit"] },
];

/** Nomes em português para os campos que aparecem sempre. */
const ROTULOS: Record<string, string> = {
  _id: "id",
  name: "nome",
  email: "e-mail",
  username: "usuário",
  createdAt: "criado em",
  updatedAt: "atualizado em",
  plan: "plano",
  tier: "acesso",
  status: "situação",
  text: "texto",
  title: "título",
  author: "autor",
  user: "pessoa",
  role: "papel",
  valorCentavos: "valor",
  pagoEm: "pago em",
  validoAte: "vale até",
  startedAt: "começou em",
  achievedAt: "conquistado em",
  actorLabel: "quem fez",
  targetLabel: "no quê",
  reason: "motivo",
  action: "ação",
  revogadoEm: "revogado em",
  primeiraCompraEm: "1ª compra",
};

const rotulo = (campo: string) => ROTULOS[campo] ?? campo.replace(/([A-Z])/g, " $1").toLowerCase();

/** Valores em algo que se lê. Datas, dinheiro e ids ficam legíveis. */
function mostrar(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "sim" : "não";

  // Centavos são inteiros no banco de propósito; na tela são reais.
  if (campo.endsWith("Centavos") && typeof valor === "number") {
    return `R$ ${(valor / 100).toFixed(2).replace(".", ",")}`;
  }

  if (typeof valor === "string") {
    // ISO vira data legível: um `createdAt` cru não diz nada a quem lê.
    if (/^\d{4}-\d{2}-\d{2}T/.test(valor)) {
      return new Date(valor).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      });
    }
    // ObjectId inteiro não cabe e não informa: as últimas seis bastam para
    // conferir de olho, e o valor completo fica no JSON.
    if (/^[0-9a-f]{24}$/.test(valor)) return `…${valor.slice(-6)}`;
    return valor.length > 60 ? `${valor.slice(0, 60)}…` : valor;
  }

  if (Array.isArray(valor)) return valor.length === 0 ? "—" : `${valor.length} itens`;
  if (typeof valor === "object") return "{…}";
  return String(valor);
}

/** O que identifica um documento na lista, sem precisar abrir. */
function titulo(d: Documento): string {
  for (const k of ["name", "nome", "title", "codigo", "email", "action", "exerciseName"]) {
    const v = d[k];
    if (typeof v === "string" && v) return v;
  }
  return `…${String(d._id).slice(-6)}`;
}

export function Dados({ token }: { token: string }) {
  const [colecoes, setColecoes] = useState<ColecaoResumo[] | null>(null);
  const [colecao, setColecao] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [aplicada, setAplicada] = useState("");
  const [docs, setDocs] = useState<Documento[] | null>(null);
  const [meta, setMeta] = useState<MetaDocumentos | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Documento | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [reconciliando, setReconciliando] = useState(false);
  const ehCelular = useEhCelular();

  useCamada(aberto !== null, () => setAberto(null));

  useEffect(() => {
    buscarColecoes(token)
      .then((r) => setColecoes(r.data))
      .catch((e) => setErro((e as Error).message));
  }, [token]);

  const carregar = useCallback(
    async (proximaPagina?: string | null) => {
      if (!colecao) return;
      setErro(null);
      if (proximaPagina) setCarregandoMais(true);
      try {
        const r = await buscarDocumentos(token, colecao, {
          q: aplicada.trim() || undefined,
          limit: 25,
          cursor: proximaPagina ?? null,
        });
        setDocs((antes) => (proximaPagina && antes ? [...antes, ...r.data] : r.data));
        setMeta(r.meta ?? null);
        setCursor(r.meta?.nextCursor ?? null);
      } catch (e) {
        setErro((e as Error).message);
      } finally {
        setCarregandoMais(false);
      }
    },
    [token, colecao, aplicada]
  );

  useEffect(() => {
    if (!colecao) return;
    setDocs(null);
    setCursor(null);
    void carregar();
  }, [carregar, colecao]);

  const colunas = useMemo(() => meta?.colunas ?? [], [meta]);
  const atual = colecoes?.find((c) => c.nome === colecao) ?? null;

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Dados</h1>
          <p className="aviso">
            Para achar alguém e consertar um campo. Toda mudança guarda uma cópia na auditoria —
            mas apagar não se desfaz.
          </p>
        </div>
        {/* Fica no topo, e não escondido: os contadores desnormalizados
            divergem em silêncio, e a única forma de saber é rodar isto. */}
        <button
          className="discreto"
          disabled={reconciliando}
          onClick={async () => {
            setReconciliando(true);
            setErro(null);
            try {
              const r = await reconciliarContadores(token);
              setRecado(
                r.data.postsCorrigidos + r.data.cuponsCorrigidos === 0
                  ? `Tudo certo: ${r.data.postsConferidos} posts conferidos, nada fora do lugar.`
                  : `${r.data.postsCorrigidos} posts e ${r.data.cuponsCorrigidos} cupons corrigidos.`
              );
            } catch (e) {
              setErro((e as Error).message);
            } finally {
              setReconciliando(false);
            }
          }}
        >
          {reconciliando ? "Conferindo…" : "Conferir contagens"}
        </button>
      </div>

      {/* As coleções em grupos: vinte e quatro botões numa linha obrigam a ler
          todos para achar um. */}
      <div className="painel">
        {colecoes === null ? (
          <p className="vazio">Carregando…</p>
        ) : (
          GRUPOS.map((g) => {
            const doGrupo = g.colecoes
              .map((n) => colecoes.find((c) => c.nome === n))
              .filter((c): c is ColecaoResumo => Boolean(c));
            if (doGrupo.length === 0) return null;
            return (
              <div key={g.titulo} style={{ marginBottom: 10 }}>
                <div className="aviso" style={{ marginBottom: 4 }}>
                  {g.titulo}
                </div>
                <div className="filtros" style={{ flexWrap: "wrap" }}>
                  {doGrupo.map((c) => (
                    <button
                      key={c.nome}
                      className={colecao === c.nome ? "ativo" : ""}
                      onClick={() => {
                        setColecao(c.nome);
                        setBusca("");
                        setAplicada("");
                        setRecado(null);
                      }}
                    >
                      {c.nome}{" "}
                      <span className="num" style={{ opacity: 0.6 }}>
                        {nf.format(c.documentos)}
                      </span>
                      {c.soLeitura && <span style={{ marginLeft: 4 }}>&#128274;</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {recado && (
        <p className="aviso" style={{ color: "var(--lime)" }}>
          {recado}
        </p>
      )}
      {erro && <p className="erro">{erro}</p>}

      {colecao && (
        <div className="painel" style={{ marginTop: 12 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAplicada(busca);
            }}
          >
            <label>
              Buscar em {colecao}
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={
                  meta?.buscaveis.length ? meta.buscaveis.slice(0, 3).join(", ") : "texto"
                }
                spellCheck={false}
              />
            </label>
            <p className="aviso">
              Escreva o que quer achar. Para filtro exato, comece com <code>{"{"}</code> e use
              JSON: <code>{'{"status":"banned"}'}</code>
            </p>
          </form>

          {docs === null ? (
            <p className="vazio">Carregando…</p>
          ) : docs.length === 0 ? (
            <p className="vazio">
              {aplicada ? `Nada encontrado para "${aplicada}".` : "Coleção vazia."}
            </p>
          ) : (
            <>
              <p className="aviso">
                {nf.format(docs.length)} de {nf.format(meta?.total ?? 0)}
                {atual?.soLeitura && " · só leitura"}
              </p>

              {ehCelular ? (
                <ul className="lista-cartoes">
                  {docs.map((d) => (
                    <li key={String(d._id)}>
                      <button className="cartao-item" onClick={() => setAberto(d)}>
                        <span className="cartao-titulo">
                          <b>{titulo(d)}</b>
                        </span>
                        <span className="cartao-meta">
                          {colunas.slice(1, 4).map((c) => (
                            <span key={c}>{mostrar(c, d[c])}</span>
                          ))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rolagem-tabela">
                  <table>
                    <thead>
                      <tr>
                        {colunas.map((c) => (
                          <th key={c}>{rotulo(c)}</th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map((d) => (
                        <tr key={String(d._id)}>
                          {colunas.map((c, i) => (
                            <td key={c} style={i === 0 ? undefined : { color: "var(--texto-2)" }}>
                              {mostrar(c, d[c])}
                            </td>
                          ))}
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
              )}

              {cursor && (
                <button
                  className="discreto"
                  onClick={() => void carregar(cursor)}
                  disabled={carregandoMais}
                >
                  {carregandoMais ? "Carregando…" : "Carregar mais"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {aberto && colecao && meta && (
        <Ficha
          token={token}
          colecao={colecao}
          documento={aberto}
          campos={meta.campos}
          soLeitura={meta.soLeitura}
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

// ------------------------------------------------------------------- ficha

/**
 * A ficha do documento: campo a campo, com o editor certo para cada tipo.
 *
 * As mudanças acumulam e vão juntas num salvar só. Pedir motivo por campo
 * faria consertar três coisas custar três confirmações — e o motivo é o mesmo.
 */
function Ficha({
  token,
  colecao,
  documento,
  campos,
  soLeitura,
  aoFechar,
  aoMudar,
}: {
  token: string;
  colecao: string;
  documento: Documento;
  campos: CampoMeta[];
  soLeitura: boolean;
  aoFechar: () => void;
  aoMudar: (recado: string) => void;
}) {
  const id = String(documento._id);
  const [mudancas, setMudancas] = useState<Record<string, unknown>>({});
  const [motivo, setMotivo] = useState("");
  const [verJson, setVerJson] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const visiveis = campos.filter((c) => c.nome !== "__v" && !c.nome.includes("."));
  const temMudanca = Object.keys(mudancas).length > 0;

  function mudar(campo: string, valor: unknown) {
    setMudancas((antes) => {
      const novo = { ...antes };
      // Voltar ao valor original tira o campo da lista: salvar um campo com o
      // mesmo valor gravaria uma linha de auditoria que não diz nada.
      if (String(valor) === String(documento[campo] ?? "")) delete novo[campo];
      else novo[campo] = valor;
      return novo;
    });
  }

  async function salvar() {
    setEnviando(true);
    setErro(null);
    try {
      await editarDocumento(token, colecao, id, mudancas, motivo.trim());
      const quantos = Object.keys(mudancas).length;
      aoMudar(`${quantos === 1 ? "1 campo" : `${quantos} campos`} salvos em ${colecao}.`);
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  async function apagar() {
    setEnviando(true);
    setErro(null);
    try {
      await apagarDocumento(token, colecao, id, motivo.trim(), confirmacao.trim());
      aoMudar("Documento apagado. A cópia ficou na auditoria.");
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  return (
    <div
      className="cortina"
      role="dialog"
      aria-modal="true"
      aria-label={titulo(documento)}
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) aoFechar();
      }}
    >
      <div className="dialogo">
        <h2 style={{ marginBottom: 2 }}>{titulo(documento)}</h2>
        <p className="aviso num" style={{ margin: 0, color: "var(--texto-3)" }}>
          {colecao} · {id}
        </p>

        {apagando ? (
          <>
            <p className="erro" style={{ marginTop: 14 }}>
              Isto apaga do banco e não se desfaz. Uma cópia do documento fica na auditoria, para
              reconstruir à mão se precisar.
            </p>
            <label>
              Digite o id para confirmar
              <input
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder={id}
                spellCheck={false}
                autoFocus
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
                {enviando ? "Apagando…" : "Apagar de vez"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginTop: 14 }}>
              {visiveis.map((c) => (
                <Campo
                  key={c.nome}
                  meta={c}
                  valor={c.nome in mudancas ? mudancas[c.nome] : documento[c.nome]}
                  mudado={c.nome in mudancas}
                  soLeitura={soLeitura}
                  aoMudar={(v) => mudar(c.nome, v)}
                />
              ))}
            </div>

            {/* O JSON continua acessível, atrás de um clique: é o que resolve
                os campos aninhados que a ficha não edita. */}
            <button
              className="discreto"
              onClick={() => setVerJson((v) => !v)}
              style={{ marginTop: 10 }}
            >
              {verJson ? "Esconder JSON" : "Ver JSON completo"}
            </button>
            {verJson && (
              <pre
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: 10,
                  fontSize: 11,
                  maxHeight: 240,
                  overflow: "auto",
                  marginTop: 6,
                }}
              >
                {JSON.stringify(documento, null, 2)}
              </pre>
            )}

            {soLeitura ? (
              <>
                <p className="aviso" style={{ marginTop: 12 }}>
                  Este registro só se lê. A auditoria não pode ser mudada por quem ela vigia, e o
                  livro-razão dos webhooks sustenta a idempotência do pagamento.
                </p>
                <div className="dialogo-acoes">
                  <button className="discreto" onClick={aoFechar}>
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              <>
                {temMudanca && (
                  <label style={{ marginTop: 12 }}>
                    Motivo
                    <input
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Fica registrado na auditoria"
                      minLength={3}
                      autoFocus
                    />
                  </label>
                )}
                {erro && <p className="erro">{erro}</p>}
                <div className="dialogo-acoes">
                  <button className="discreto" onClick={aoFechar} disabled={enviando}>
                    {temMudanca ? "Descartar" : "Fechar"}
                  </button>
                  <button
                    className="discreto"
                    onClick={() => {
                      setApagando(true);
                      setErro(null);
                    }}
                    disabled={enviando}
                    style={{ color: "var(--perigo)", borderColor: "var(--perigo)" }}
                  >
                    Apagar
                  </button>
                  <button
                    className="acao"
                    onClick={() => void salvar()}
                    disabled={enviando || !temMudanca || motivo.trim().length < 3}
                  >
                    {enviando
                      ? "Salvando…"
                      : temMudanca
                        ? `Salvar ${Object.keys(mudancas).length}`
                        : "Salvar"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Um campo, com o editor que o tipo pede. */
function Campo({
  meta,
  valor,
  mudado,
  soLeitura,
  aoMudar,
}: {
  meta: CampoMeta;
  valor: unknown;
  mudado: boolean;
  soLeitura: boolean;
  aoMudar: (v: unknown) => void;
}) {
  const linha = {
    display: "grid",
    gridTemplateColumns: "minmax(90px, 30%) 1fr",
    gap: 10,
    alignItems: "center",
    padding: "7px 0",
    borderTop: "1px solid var(--line)",
  } as const;

  const nome = (
    <span style={{ color: mudado ? "var(--lime)" : "var(--texto-3)", fontSize: 12 }}>
      {rotulo(meta.nome)}
      {mudado && " •"}
    </span>
  );

  /**
   * O que se mostra sem oferecer edição.
   *
   * `_id` e as datas automáticas não se mudam; `ObjectId` de referência só se
   * trocaria colando outro id, e trocar o dono de um documento por um campo de
   * texto é o tipo de conserto que cria dois problemas. Segredo nunca.
   */
  const somenteVer =
    soLeitura ||
    meta.segredo ||
    meta.complexo ||
    meta.nome === "_id" ||
    meta.tipo === "ObjectId" ||
    meta.nome === "createdAt" ||
    meta.nome === "updatedAt";

  if (somenteVer) {
    return (
      <div style={linha}>
        {nome}
        <span style={{ color: "var(--texto-2)", fontSize: 13 }} className="num">
          {mostrar(meta.nome, valor)}
        </span>
      </div>
    );
  }

  // Enum vira seletor: digitar um valor fora da lista grava algo que o resto
  // do sistema não sabe ler, e o schema só recusaria na hora de salvar.
  if (meta.enumValores?.length) {
    return (
      <div style={linha}>
        {nome}
        <select
          value={valor === null || valor === undefined ? "" : String(valor)}
          onChange={(e) => aoMudar(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">—</option>
          {meta.enumValores.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (meta.tipo === "Boolean") {
    return (
      <div style={linha}>
        {nome}
        <label style={{ flexDirection: "row", gap: 8, alignItems: "center", margin: 0 }}>
          <input
            type="checkbox"
            checked={valor === true}
            onChange={(e) => aoMudar(e.target.checked)}
          />
          <span style={{ color: "var(--texto-2)", fontSize: 13 }}>
            {valor === true ? "sim" : "não"}
          </span>
        </label>
      </div>
    );
  }

  if (meta.tipo === "Date") {
    const iso = typeof valor === "string" && valor ? valor.slice(0, 16) : "";
    return (
      <div style={linha}>
        {nome}
        <input
          type="datetime-local"
          value={iso}
          onChange={(e) => aoMudar(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      </div>
    );
  }

  if (meta.tipo === "Number") {
    return (
      <div style={linha}>
        {nome}
        <input
          type="number"
          value={valor === null || valor === undefined ? "" : String(valor)}
          onChange={(e) => aoMudar(e.target.value === "" ? null : Number(e.target.value))}
        />
      </div>
    );
  }

  return (
    <div style={linha}>
      {nome}
      <input
        value={valor === null || valor === undefined ? "" : String(valor)}
        onChange={(e) => aoMudar(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
