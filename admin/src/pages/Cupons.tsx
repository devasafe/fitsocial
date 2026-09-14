import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  buscarCupons,
  buscarCupom,
  criarCupom,
  editarCupom,
  revogarCupom,
  reativarCupom,
  type CupomAdmin,
  type FiltroDeCupom,
  type UsoDeCupom,
} from "../api";
import { Dialogo } from "../components/Dialogo";
import { useCamada } from "../hooks/useCamada";
import { useEhCelular } from "../hooks/useEhCelular";

// O painel de cupons.
//
// A tela responde a UMA pergunta acima de todas: quanto cada parceria trouxe, e
// quanto dela é lucro depois de pagar o parceiro. Por isso a linha da lista
// mostra `entraram / pagaram` juntos — um número sozinho não diz nada. Cem
// pessoas entrando e ninguém pagando é um cupom que atrai e não converte, e
// isso é uma informação, não um erro.

const nf = new Intl.NumberFormat("pt-BR");
const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

const TIPOS = [
  { v: "percentual", r: "% de desconto", dica: "20 = 20% off" },
  { v: "valor", r: "R$ de desconto", dica: "10 = R$ 10,00 off" },
  { v: "meses_gratis", r: "meses grátis", dica: "3 = 3 meses de Pro" },
] as const;

export function Cupons({ token }: { token: string }) {
  const [lista, setLista] = useState<CupomAdmin[] | null>(null);
  const [filtro, setFiltro] = useState<FiltroDeCupom>("ativos");
  const [contagens, setContagens] = useState({ ativos: 0, revogados: 0 });
  /**
   * O que acabou de acontecer, dito na tela.
   *
   * Revogar fazia o cupom DESAPARECER da lista de ativos sem nada explicando,
   * e "revogar nao funciona" era a leitura obvia de quem estava olhando.
   */
  const [recado, setRecado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<CupomAdmin | null>(null);
  const [aberto, setAberto] = useState<(CupomAdmin & { usos: UsoDeCupom[] }) | null>(null);
  const [acao, setAcao] = useState<{ cupom: CupomAdmin; revogar: boolean } | null>(null);
  const ehCelular = useEhCelular();

  useCamada(criando, () => setCriando(false));
  useCamada(editando !== null, () => setEditando(null));
  useCamada(aberto !== null, () => setAberto(null));
  useCamada(acao !== null, () => setAcao(null));

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await buscarCupons(token, filtro);
      setLista(r.data);
      if (r.meta) setContagens({ ativos: r.meta.ativos, revogados: r.meta.revogados });
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token, filtro]);

  useEffect(() => {
    setLista(null);
    void carregar();
  }, [carregar]);

  async function abrir(codigo: string) {
    try {
      const r = await buscarCupom(token, codigo);
      setAberto(r.data);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Cupons</h1>
          <p className="aviso">
            Desconto mexe no preço; parceria marca de onde a pessoa veio. Um cupom pode ser os
            dois.
          </p>
        </div>
        <button onClick={() => setCriando(true)}>Novo cupom</button>
      </div>

      <div className="filtros">
        {(
          [
            { v: "ativos" as const, r: `Ativos (${contagens.ativos})` },
            { v: "revogados" as const, r: `Revogados (${contagens.revogados})` },
            { v: "todos" as const, r: "Todos" },
          ]
        ).map((f) => (
          <button
            key={f.v}
            className={filtro === f.v ? "ativo" : ""}
            onClick={() => {
              setFiltro(f.v);
              setRecado(null);
            }}
          >
            {f.r}
          </button>
        ))}
      </div>

      {recado && (
        <p className="aviso" style={{ color: "var(--lime)" }}>
          {recado}
        </p>
      )}
      {erro && <p className="erro">{erro}</p>}

      <div className="painel">
        {lista === null ? (
          <p className="vazio">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="vazio">
            {filtro === "revogados"
              ? "Nenhum cupom revogado."
              : "Nenhum cupom ainda. Crie um para fechar parceria ou fazer uma campanha."}
          </p>
        ) : ehCelular ? (
          <ul className="lista-cartoes">
            {lista.map((c) => (
              <li key={c.id}>
                <button className="cartao-item" onClick={() => void abrir(c.codigo)}>
                  <span className="cartao-titulo">
                    <b>{c.codigo}</b>
                    {c.revogadoEm && <span className="aviso">revogado</span>}
                  </span>
                  <span className="cartao-sub">
                    {c.parceiro ? c.parceiro.nome : c.descricao || "campanha"}
                  </span>
                  <span className="cartao-meta">
                    {c.desconto && <span>{c.desconto.rotulo}</span>}
                    <span className="num">
                      {nf.format(c.relatorio.entraram)} entraram · {nf.format(c.relatorio.pagaram)}{" "}
                      pagando
                    </span>
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
                  <th>Código</th>
                  <th>Desconto</th>
                  <th>Parceiro</th>
                  <th className="dir">Entraram</th>
                  <th className="dir">Pagando</th>
                  <th className="dir">Receita</th>
                  <th className="dir">Comissão</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id} style={c.revogadoEm ? { opacity: 0.5 } : undefined}>
                    <td>
                      <b>{c.codigo}</b>
                      {c.revogadoEm && (
                        <span className="aviso" style={{ marginLeft: 6 }}>
                          revogado
                        </span>
                      )}
                      {c.descricao && (
                        <div className="aviso" style={{ color: "var(--texto-3)" }}>
                          {c.descricao}
                        </div>
                      )}
                    </td>
                    <td>{c.desconto ? c.desconto.rotulo : "—"}</td>
                    <td>
                      {c.parceiro ? (
                        <>
                          {c.parceiro.nome}
                          <span className="aviso" style={{ marginLeft: 6 }}>
                            {c.parceiro.comissaoPercentual}%
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="dir num">{nf.format(c.relatorio.entraram)}</td>
                    <td className="dir num">{nf.format(c.relatorio.pagaram)}</td>
                    <td className="dir num">{c.relatorio.receitaFormatada}</td>
                    <td className="dir num" style={{ color: "var(--texto-2)" }}>
                      {c.relatorio.comissaoFormatada}
                    </td>
                    <td className="dir">
                      <button className="discreto" onClick={() => void abrir(c.codigo)}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {criando && (
        <FormularioDeCupom
          token={token}
          aoFechar={() => setCriando(false)}
          aoCriar={() => {
            setCriando(false);
            void carregar();
          }}
        />
      )}

      {editando && (
        <FormularioDeCupom
          token={token}
          editando={editando}
          aoFechar={() => setEditando(null)}
          aoCriar={() => {
            setEditando(null);
            void carregar();
          }}
        />
      )}

      {aberto && (
        <Detalhe
          cupom={aberto}
          aoFechar={() => setAberto(null)}
          aoEditar={() => {
            setEditando(aberto);
            setAberto(null);
          }}
          aoPedirAcao={(revogar) => {
            setAcao({ cupom: aberto, revogar });
            setAberto(null);
          }}
        />
      )}

      {acao && (
        <Dialogo
          titulo={
            acao.revogar ? `Revogar ${acao.cupom.codigo}?` : `Reativar ${acao.cupom.codigo}?`
          }
          descricao={
            acao.revogar
              ? "Ninguém mais consegue usar esse código. Quem já entrou por ele continua contando no relatório do parceiro — o cupom não é apagado."
              : "O código volta a valer para usos novos."
          }
          rotuloAcao={acao.revogar ? "Revogar" : "Reativar"}
          perigoso={acao.revogar}
          aoConfirmar={async (motivo) => {
            const codigo = acao.cupom.codigo;
            if (acao.revogar) {
              await revogarCupom(token, codigo, motivo);
              // O cupom sai da aba de ativos. Dizer PARA ONDE ele foi é o que
              // separa "funcionou" de "sumiu sem explicação".
              setRecado(`${codigo} foi revogado. Ele está na aba Revogados.`);
            } else {
              await reativarCupom(token, codigo, motivo);
              setRecado(`${codigo} voltou a valer. Ele está na aba Ativos.`);
            }
            void carregar();
          }}
          aoFechar={() => setAcao(null)}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ criar

function FormularioDeCupom({
  token,
  editando,
  aoFechar,
  aoCriar,
}: {
  token: string;
  /** Quando vem preenchido, o formulario edita em vez de criar. */
  editando?: CupomAdmin | null;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const ehEdicao = Boolean(editando);
  const [codigo, setCodigo] = useState(editando?.codigo ?? "");
  const [descricao, setDescricao] = useState(editando?.descricao ?? "");
  const [temDesconto, setTemDesconto] = useState(editando ? Boolean(editando.desconto) : true);
  const [tipo, setTipo] = useState<"percentual" | "valor" | "meses_gratis">(
    editando?.desconto?.tipo ?? "percentual"
  );
  const [valor, setValor] = useState(
    // Centavos voltam a reais so na tela; na API o valor trafega em centavos.
    editando?.desconto
      ? editando.desconto.tipo === "valor"
        ? (editando.desconto.valor / 100).toFixed(2)
        : String(editando.desconto.valor)
      : ""
  );
  const [temParceiro, setTemParceiro] = useState(Boolean(editando?.parceiro));
  const [nome, setNome] = useState(editando?.parceiro?.nome ?? "");
  const [contato, setContato] = useState(editando?.parceiro?.contato ?? "");
  const [comissao, setComissao] = useState(
    editando?.parceiro ? String(editando.parceiro.comissaoPercentual) : ""
  );
  const [limite, setLimite] = useState(editando?.limiteDeUsos ? String(editando.limiteDeUsos) : "");
  const [validade, setValidade] = useState(
    editando?.validoAte ? editando.validoAte.slice(0, 10) : ""
  );
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const corpo = {
        descricao: descricao.trim() || undefined,
        desconto: temDesconto
          ? {
              tipo,
              // Reais viram CENTAVOS aqui, na borda. Dinheiro fracionário
              // atravessando a API é como um centavo vira três.
              valor: tipo === "valor" ? Math.round(Number(valor) * 100) : Number(valor),
            }
          : null,
        parceiro: temParceiro
          ? {
              nome: nome.trim(),
              contato: contato.trim() || undefined,
              comissaoPercentual: Number(comissao) || 0,
            }
          : null,
        limiteDeUsos: limite ? Number(limite) : null,
        validoAte: validade || null,
      };

      if (editando) {
        // O codigo NAO vai: ele esta gravado em cada conta que entrou por
        // aqui, e renomear apagaria o historico de quem tem a receber.
        await editarCupom(token, editando.codigo, { ...corpo, motivo: motivo.trim() });
      } else {
        await criarCupom(token, { ...corpo, codigo: codigo.trim() || undefined });
      }
      aoCriar();
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  const dica = TIPOS.find((t) => t.v === tipo)?.dica ?? "";

  return (
    <div
      className="cortina"
      role="dialog"
      aria-modal="true"
      aria-label="Novo cupom"
      // Só no alvo exato: um arrasto que termine sobre a cortina não pode
      // fechar um formulário meio preenchido.
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) aoFechar();
      }}
    >
      <form className="dialogo" onSubmit={enviar}>
        <h2>{ehEdicao ? "Editar " + editando!.codigo : "Novo cupom"}</h2>

        {ehEdicao && (
          <p className="aviso">
            O código não muda: ele está gravado em cada conta que entrou por ele. O que você
            alterar aqui vale só para quem usar de agora em diante — quem já assinou mantém o
            preço, e as comissões já pagas não se movem.
          </p>
        )}

        {!ehEdicao && (
          <label>
            Código
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="deixe vazio para sortear"
              maxLength={40}
            />
          </label>
        )}
        {!ehEdicao && (
          <p className="aviso">
            O que a pessoa digita. Vazio = o sistema sorteia um código sem letras que se confundem.
          </p>
        )}

        <label>
          Para que é (só você vê)
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Parceria com a academia X"
            maxLength={200}
          />
        </label>

        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>
            <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={temDesconto}
                onChange={(e) => setTemDesconto(e.target.checked)}
              />
              Dá desconto
            </label>
          </legend>
          {temDesconto && (
            <>
              <div className="filtros">
                {TIPOS.map((t) => (
                  <button
                    key={t.v}
                    type="button"
                    className={tipo === t.v ? "ativo" : ""}
                    onClick={() => setTipo(t.v)}
                  >
                    {t.r}
                  </button>
                ))}
              </div>
              <label>
                Valor
                <input
                  type="number"
                  min={1}
                  step={tipo === "valor" ? "0.01" : "1"}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder={dica}
                  required={temDesconto}
                />
              </label>
              <p className="aviso">
                {tipo === "meses_gratis"
                  ? "Meses grátis não passam pelo gateway: a pessoa já entra com o Pro e a cobrança só começa depois."
                  : "O desconto vale enquanto a assinatura durar."}
              </p>
            </>
          )}
        </fieldset>

        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>
            <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={temParceiro}
                onChange={(e) => setTemParceiro(e.target.checked)}
              />
              É de parceria
            </label>
          </legend>
          {temParceiro && (
            <>
              <label>
                Nome do parceiro
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required={temParceiro}
                  maxLength={120}
                />
              </label>
              <label>
                Contato
                <input
                  value={contato}
                  onChange={(e) => setContato(e.target.value)}
                  placeholder="@instagram, WhatsApp, e-mail"
                  maxLength={200}
                />
              </label>
              <label>
                Comissão (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={comissao}
                  onChange={(e) => setComissao(e.target.value)}
                  placeholder="30"
                />
              </label>
              <p className="aviso">
                Percentual de cada pagamento que fica para o parceiro. Gravado no momento da
                venda: mudar depois não reescreve o que já foi vendido.
              </p>
            </>
          )}
        </fieldset>

        <label>
          Limite de usos
          <input
            type="number"
            min={1}
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            placeholder="sem limite"
          />
        </label>

        <label>
          Válido até
          <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
        </label>

        {ehEdicao && (
          <label>
            Motivo
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Fica registrado na auditoria"
              minLength={3}
              required
            />
          </label>
        )}

        {erro && <p className="erro">{erro}</p>}

        <div className="dialogo-acoes">
          <button type="button" className="discreto" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="submit"
            className="acao"
            disabled={enviando || (ehEdicao && motivo.trim().length < 3)}
          >
            {enviando ? "Salvando…" : ehEdicao ? "Salvar" : "Criar cupom"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ----------------------------------------------------------------- detalhe

function Detalhe({
  cupom,
  aoFechar,
  aoEditar,
  aoPedirAcao,
}: {
  cupom: CupomAdmin & { usos: UsoDeCupom[] };
  aoFechar: () => void;
  aoEditar: () => void;
  aoPedirAcao: (revogar: boolean) => void;
}) {
  const r = cupom.relatorio;
  return (
    <div
      className="cortina"
      role="dialog"
      aria-modal="true"
      aria-label={cupom.codigo}
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="dialogo">
        <h2>{cupom.codigo}</h2>
        <p style={{ color: "var(--texto-2)", margin: 0 }}>
          {cupom.descricao || "sem descrição"}
          {cupom.revogadoEm && ` · revogado em ${dataCurta(cupom.revogadoEm)}`}
        </p>

        {cupom.parceiro && (
          <p className="aviso" style={{ marginTop: 4 }}>
            {cupom.parceiro.nome}
            {cupom.parceiro.contato && ` · ${cupom.parceiro.contato}`} ·{" "}
            {cupom.parceiro.comissaoPercentual}% de comissão
          </p>
        )}

        <div className="stats-3" style={{ marginTop: 12 }}>
          <div>
            <div className="num" style={{ fontSize: 22 }}>
              {nf.format(r.entraram)}
            </div>
            <div className="aviso">entraram</div>
          </div>
          <div>
            <div className="num" style={{ fontSize: 22 }}>
              {nf.format(r.pagaram)}
            </div>
            <div className="aviso">pagando</div>
          </div>
          <div>
            <div className="num" style={{ fontSize: 22 }}>
              {nf.format(r.gratis)}
            </div>
            <div className="aviso">ainda no grátis</div>
          </div>
        </div>

        <div className="stats-3" style={{ marginTop: 8 }}>
          <div>
            <div className="num" style={{ fontSize: 18 }}>
              {r.receitaFormatada}
            </div>
            <div className="aviso">receita</div>
          </div>
          <div>
            <div className="num" style={{ fontSize: 18, color: "var(--texto-2)" }}>
              {r.comissaoFormatada}
            </div>
            <div className="aviso">comissão do parceiro</div>
          </div>
          <div>
            <div className="num" style={{ fontSize: 18, color: "var(--lime)" }}>
              {r.liquidoFormatado}
            </div>
            <div className="aviso">sobra para você</div>
          </div>
        </div>

        {cupom.usos.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 13, marginBottom: 6 }}>Quem entrou</h3>
            <div className="rolagem-tabela" style={{ maxHeight: 240, overflowY: "auto" }}>
              <table>
                <tbody>
                  {cupom.usos.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.nome}
                        <div className="aviso" style={{ color: "var(--texto-3)" }}>
                          {u.email}
                        </div>
                      </td>
                      <td style={{ color: u.primeiraCompraEm ? "var(--lime)" : "var(--texto-3)" }}>
                        {u.primeiraCompraEm ? "pagando" : "grátis"}
                      </td>
                      <td className="dir num" style={{ color: "var(--texto-2)" }}>
                        {dataCurta(u.entrouEm)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="dialogo-acoes">
          <button className="discreto" onClick={aoFechar}>
            Fechar
          </button>
          <button className="discreto" onClick={aoEditar}>
            Editar
          </button>
          {cupom.revogadoEm ? (
            <button className="acao" onClick={() => aoPedirAcao(false)}>Reativar</button>
          ) : (
            <button className="acao perigosa" onClick={() => aoPedirAcao(true)}>
              Revogar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
