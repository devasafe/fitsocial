import { useCallback, useEffect, useState } from "react";
import {
  listarUsuarios, buscarUsuario, banirUsuario, desbanirUsuario,
  suspenderUsuario, definirPremium,
  type UsuarioAdmin, type DetalheUsuario,
} from "../api";
import { Dialogo } from "../components/Dialogo";
import { Selo } from "../components/Selo";

type Acao = "banir" | "desbanir" | "suspender" | "premium" | "tirarPremium";

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function Usuarios({ token }: { token: string }) {
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [status, setStatus] = useState("");
  const [lista, setLista] = useState<UsuarioAdmin[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const [selecionado, setSelecionado] = useState<DetalheUsuario | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [dias, setDias] = useState(7);

  // Espera a digitacao parar antes de consultar: sem isso, cada tecla vira uma
  // requisicao e a lista pisca.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(
    async (proximoCursor: string | null = null) => {
      setErro(null);
      try {
        const r = await listarUsuarios(token, { q: buscaAtiva, status, cursor: proximoCursor });
        setLista((atual) => (proximoCursor && atual ? [...atual, ...r.data] : r.data));
        setCursor((r.meta?.nextCursor as string | null) ?? null);
        setTotal((r.meta?.total as number) ?? 0);
      } catch (e) {
        setErro((e as Error).message);
      }
    },
    [token, buscaAtiva, status]
  );

  useEffect(() => {
    setLista(null);
    void carregar(null);
  }, [carregar]);

  async function abrir(id: string) {
    setSelecionado(null);
    const r = await buscarUsuario(token, id);
    setSelecionado(r.data);
  }

  async function aplicar(motivo: string) {
    const alvo = selecionado!.user;
    if (acao === "banir") await banirUsuario(token, alvo.id, motivo);
    if (acao === "desbanir") await desbanirUsuario(token, alvo.id, motivo);
    if (acao === "suspender") {
      const ate = new Date(Date.now() + dias * 86400000).toISOString();
      await suspenderUsuario(token, alvo.id, ate, motivo);
    }
    if (acao === "premium") await definirPremium(token, alvo.id, true, dias || null, motivo);
    if (acao === "tirarPremium") await definirPremium(token, alvo.id, false, null, motivo);

    await abrir(alvo.id);
    await carregar(null);
  }

  const u = selecionado?.user;

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Usuários</h1>
          <p>
            {total > 0 ? total + " contas" : "Nenhuma conta"} no FitSocial. Toda ação daqui pede
            um motivo e fica registrada.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, e-mail ou username"
          style={{ maxWidth: 340 }}
          aria-label="Buscar usuários"
        />
        {[
          { v: "", r: "Todas" },
          { v: "active", r: "Ativas" },
          { v: "suspended", r: "Suspensas" },
          { v: "banned", r: "Banidas" },
        ].map((f) => (
          <button
            key={f.v}
            className="discreto"
            aria-pressed={status === f.v}
            onClick={() => setStatus(f.v)}
          >
            {f.r}
          </button>
        ))}
      </div>

      {erro && (
        <div className="erro" role="alert" style={{ marginBottom: 16 }}>
          {erro}
        </div>
      )}

      <div className="painel">
        {lista === null ? (
          <p className="vazio">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="vazio">Nenhuma conta com esses filtros.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Plano</th>
                <th>Conta</th>
                <th className="dir">Cadastro</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.name}
                    {x.role === "admin" && (
                      <span className="aviso" style={{ marginLeft: 6 }}>admin</span>
                    )}
                  </td>
                  <td style={{ color: "var(--texto-2)" }}>{x.email}</td>
                  <td style={{ color: x.tierEfetivo === "premium" ? "var(--lime)" : undefined }}>
                    {x.tierEfetivo === "premium" ? "premium" : "grátis"}
                    {x.premiumSource === "admin" && (
                      <span className="aviso" style={{ marginLeft: 6 }}>cortesia</span>
                    )}
                  </td>
                  <td><Selo estado={x.statusEfetivo} /></td>
                  <td className="dir num" style={{ color: "var(--texto-2)" }}>
                    {dataCurta(x.createdAt)}
                  </td>
                  <td className="dir">
                    <button className="discreto" onClick={() => void abrir(x.id)}>Abrir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {cursor && (
          <div style={{ marginTop: 14, textAlign: "center" }}>
            <button className="discreto" onClick={() => void carregar(cursor)}>
              Carregar mais
            </button>
          </div>
        )}
      </div>

      {u && selecionado && (
        <div className="cortina" role="dialog" aria-modal="true" aria-label={"Conta de " + u.name}>
          <div className="dialogo" style={{ width: 520 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2>{u.name}</h2>
              <button className="discreto" onClick={() => setSelecionado(null)}>Fechar</button>
            </div>
            <p style={{ color: "var(--texto-2)", margin: "6px 0 0" }}>
              {u.email}{u.username ? " · @" + u.username : ""}
            </p>

            <div style={{ display: "flex", gap: 22, margin: "16px 0" }}>
              <div>
                <div className="num" style={{ fontSize: 22 }}>{selecionado.contagens.posts}</div>
                <div className="aviso">posts</div>
              </div>
              <div>
                <div className="num" style={{ fontSize: 22 }}>{selecionado.contagens.atividades}</div>
                <div className="aviso">treinos</div>
              </div>
              <div>
                <div style={{ fontSize: 15, paddingTop: 3 }}><Selo estado={u.statusEfetivo} /></div>
                <div className="aviso">
                  {u.suspendedUntil ? "até " + dataCurta(u.suspendedUntil) : u.statusReason || "—"}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {u.statusEfetivo === "banned" || u.statusEfetivo === "suspended" ? (
                <button className="discreto" onClick={() => setAcao("desbanir")}>Reativar conta</button>
              ) : (
                <>
                  <button className="discreto" onClick={() => setAcao("suspender")}>Suspender</button>
                  <button className="discreto perigo" onClick={() => setAcao("banir")}>Banir</button>
                </>
              )}
              {u.premiumSource === "admin" ? (
                <button className="discreto" onClick={() => setAcao("tirarPremium")}>Tirar cortesia</button>
              ) : (
                <button className="discreto" onClick={() => setAcao("premium")}>Dar premium</button>
              )}
            </div>

            {selecionado.auditoria.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h2 style={{ fontSize: 14, marginBottom: 8 }}>Histórico</h2>
                {selecionado.auditoria.map((a, i) => (
                  <div key={i} style={{ borderTop: "1px solid var(--line)", padding: "7px 0" }}>
                    <span className="num" style={{ fontSize: 12, color: "var(--texto-3)" }}>
                      {dataCurta(a.quando)}
                    </span>{" "}
                    <span>{a.acao}</span>
                    {a.motivo && <span style={{ color: "var(--texto-2)" }}> — {a.motivo}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {acao && u && (
        <Dialogo
          titulo={
            acao === "banir" ? "Banir " + u.name + "?"
            : acao === "desbanir" ? "Reativar " + u.name + "?"
            : acao === "suspender" ? "Suspender " + u.name + "?"
            : acao === "premium" ? "Dar premium a " + u.name + "?"
            : "Tirar a cortesia de " + u.name + "?"
          }
          descricao={
            acao === "banir"
              ? "A pessoa perde o acesso na hora, mesmo com o app aberto, e o conteúdo dela some do feed. Nada é apagado: reativar devolve tudo."
              : acao === "desbanir"
              ? "A conta volta ao normal e o conteúdo reaparece no feed."
              : acao === "suspender"
              ? "Bloqueio temporário. A conta se libera sozinha quando o prazo acabar."
              : acao === "premium"
              ? "Cortesia dada por você. A loja não derruba: se uma assinatura expirar, isto continua valendo."
              : "A pessoa volta ao plano grátis, a menos que tenha assinatura própria."
          }
          rotuloAcao={
            acao === "banir" ? "Banir"
            : acao === "desbanir" ? "Reativar"
            : acao === "suspender" ? "Suspender"
            : acao === "premium" ? "Dar premium"
            : "Tirar cortesia"
          }
          perigoso={acao === "banir"}
          extra={
            acao === "suspender" || acao === "premium" ? (
              <div style={{ marginTop: 14 }}>
                <label htmlFor="dias">
                  {acao === "suspender" ? "Dias de suspensão" : "Dias de cortesia (0 = sem prazo)"}
                </label>
                <input
                  id="dias"
                  type="number"
                  min={acao === "suspender" ? 1 : 0}
                  max={365}
                  value={dias}
                  onChange={(e) => setDias(Number(e.target.value))}
                />
              </div>
            ) : null
          }
          aoConfirmar={aplicar}
          aoFechar={() => setAcao(null)}
        />
      )}
    </>
  );
}
