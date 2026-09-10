import { useCallback, useEffect, useState } from "react";
import { buscarDenuncias, resolverDenuncia, type DenunciaAgrupada } from "../api";
import { Dialogo } from "../components/Dialogo";
import { empilharCamada, useCamada } from "../hooks/useCamada";

const FILTROS = [
  { v: "pendente", r: "Pendentes" },
  { v: "resolvida", r: "Removidas" },
  { v: "rejeitada", r: "Mantidas" },
  { v: "todas", r: "Todas" },
];

const MOTIVOS: Record<string, string> = {
  spam: "spam",
  ofensivo: "ofensivo",
  assedio: "assédio",
  improprio: "impróprio",
  odio: "discurso de ódio",
  enganoso: "enganoso",
  outro: "outro",
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

export function Denuncias({ token }: { token: string }) {
  const [status, setStatus] = useState("pendente");
  const [lista, setLista] = useState<DenunciaAgrupada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [decidindo, setDecidindo] = useState<{ item: DenunciaAgrupada; remover: boolean } | null>(null);

  // Voltar e Esc fecham a folha. O hook observa o estado daqui porque é ele
  // que existe antes e depois dela — dentro do Dialogo, o envio bem-sucedido
  // desmonta o componente sem ele nunca ver "fechado".
  useCamada(decidindo !== null, () => setDecidindo(null));

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await buscarDenuncias(token, status);
      setLista(r.data);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token, status]);

  useEffect(() => {
    setLista(null);
    void carregar();
  }, [carregar]);

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Denúncias</h1>
          <p>
            Agrupadas por conteúdo: várias denúncias sobre o mesmo post viram um item só,
            porque a decisão é sobre o conteúdo, não sobre cada denúncia.
          </p>
        </div>
        <div className="filtros">
          {FILTROS.map((f) => (
            <button key={f.v} className="discreto" aria-pressed={status === f.v} onClick={() => setStatus(f.v)}>
              {f.r}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="erro" role="alert" style={{ marginBottom: 16 }}>
          {erro}
        </div>
      )}

      {lista === null ? (
        <p className="vazio">Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="painel">
          <p className="vazio">
            {status === "pendente"
              ? "Nenhuma denúncia esperando análise."
              : "Nada por aqui."}
          </p>
        </div>
      ) : (
        lista.map((d) => (
          <div className="painel" key={d.reportId} style={{ marginBottom: 12 }}>
            <div className="denuncia-linha">
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="num" style={{ fontSize: 20 }}>
                    {d.denuncias}
                  </span>
                  <span style={{ color: "var(--texto-2)" }}>
                    {d.denuncias === 1 ? "denúncia" : "denúncias"}
                  </span>
                  {!d.aindaNoAr && <span className="aviso">o autor já apagou este post</span>}
                </div>

                <div className="motivos">
                  {d.motivos.map((m) => (
                    <span key={m}>{MOTIVOS[m] ?? m}</span>
                  ))}
                </div>

                <blockquote
                  style={{
                    background: "var(--surface-2)",
                    borderLeft: "3px solid var(--line-forte)",
                    borderRadius: 8,
                    margin: "12px 0",
                    padding: "10px 14px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {d.conteudo.texto || <span className="aviso">(publicação sem texto)</span>}
                </blockquote>

                {d.conteudo.imageUrl && (
                  <img
                    src={d.conteudo.imageUrl}
                    alt="Publicação denunciada"
                    className="midia-denuncia"
                  />
                )}

                <div className="cartao-meta">
                  <span>{d.autor ? `por ${d.autor.nome}` : "autor desconhecido"}</span>
                  {d.autor?.status && d.autor.status !== "active" && (
                    <span>conta {d.autor.status}</span>
                  )}
                  <span>{quando(d.primeira)}</span>
                </div>
              </div>

              {status === "pendente" && (
                <div className="acoes-lateral">
                  {/* Destrutivo por último: no celular estes dois ficam lado a
                      lado, e o vermelho não pode ser o alvo mais à mão. */}
                  <button
                    className="discreto"
                    onClick={() => {
                      empilharCamada();
                      setDecidindo({ item: d, remover: false });
                    }}
                  >
                    Manter post
                  </button>
                  <button
                    className="discreto perigo"
                    onClick={() => {
                      empilharCamada();
                      setDecidindo({ item: d, remover: true });
                    }}
                  >
                    Remover post
                  </button>
                </div>
              )}
            </div>
          </div>
        ))
      )}

      {decidindo && (
        <Dialogo
          titulo={decidindo.remover ? "Remover esta publicação?" : "Manter esta publicação?"}
          descricao={
            decidindo.remover
              ? "O post sai do feed e do perfil, e o autor perde o acesso a ele. Todas as denúncias sobre este conteúdo são fechadas juntas."
              : "O post continua no ar e as denúncias sobre ele são encerradas. Quem denunciou não é avisado da decisão."
          }
          rotuloAcao={decidindo.remover ? "Remover" : "Manter"}
          perigoso={decidindo.remover}
          aoConfirmar={async (motivo) => {
            await resolverDenuncia(
              token,
              decidindo.item.reportId,
              decidindo.remover ? "removido" : "mantido",
              motivo
            );
            await carregar();
          }}
          aoFechar={() => setDecidindo(null)}
        />
      )}
    </>
  );
}
