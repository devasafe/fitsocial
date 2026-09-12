import { useCallback, useEffect, useRef, useState } from "react";
import { buscarMensagens, enviarMensagem, ErroApi, type Mensagem } from "../api";

/**
 * A conversa com o aluno.
 *
 * Busca ao abrir e ao voltar o foco da aba — não há tempo real no projeto, e
 * um `setInterval` escondido aqui seria pior que a ausência dele: consumo
 * constante para uma tela que fica aberta o dia todo no balcão da academia.
 * WebSocket entra quando a conversa provar que precisa.
 */
export function Conversa({
  token,
  linkId,
  euId,
  encerrado,
}: {
  token: string;
  linkId: string;
  euId: string;
  encerrado?: boolean;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await buscarMensagens(token, linkId);
      // A API devolve da mais nova para trás; a tela lê de cima para baixo.
      setMensagens([...r.data].reverse());
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar a conversa.");
    } finally {
      setCarregando(false);
    }
  }, [token, linkId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Voltar para a aba é o momento em que a pessoa quer ver o que chegou.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === "visible") carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [carregar]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const conteudo = texto.trim();
    if (!conteudo || enviando) return;

    setEnviando(true);
    setErro(null);
    try {
      const r = await enviarMensagem(token, linkId, conteudo);
      setMensagens((atual) => [...atual, r.data]);
      setTexto("");
    } catch (e) {
      // O texto continua na caixa: perder o que a pessoa escreveu por causa de
      // uma falha de rede é o pior jeito de avisar que houve falha.
      setErro(e instanceof ErroApi ? e.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) return <p className="vazio">Carregando conversa…</p>;

  return (
    <div>
      <div className="conversa">
        {mensagens.length === 0 && (
          <p className="vazio" style={{ padding: 8 }}>
            Nenhuma mensagem ainda. Uma palavra no começo da semana costuma valer mais que dez no
            fim.
          </p>
        )}

        {mensagens.map((m) => (
          <div key={m.id} className={`balao ${m.autor === euId ? "meu" : ""}`}>
            {m.imageUrl && <img src={m.imageUrl} alt="" loading="lazy" />}
            {m.texto}
            <span className="quando">
              {new Date(m.createdAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        ))}
        <div ref={fim} />
      </div>

      {erro && (
        <p className="erro" role="alert" style={{ marginTop: 8 }}>
          {erro}
        </p>
      )}

      {encerrado ? (
        <p className="sub" style={{ marginTop: 12 }}>
          Acompanhamento encerrado. O histórico fica, mas não dá para escrever.
        </p>
      ) : (
        <form className="escrever" onSubmit={enviar}>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escreva para o seu aluno…"
            maxLength={2000}
            aria-label="Mensagem"
          />
          <button className="primario" type="submit" disabled={enviando || !texto.trim()}>
            {enviando ? "…" : "Enviar"}
          </button>
        </form>
      )}
    </div>
  );
}
