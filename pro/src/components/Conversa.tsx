import { useCallback, useEffect, useRef, useState } from "react";
import {
  buscarMensagens,
  enviarMensagem,
  enviarFoto,
  ErroApi,
  type Mensagem,
} from "../api";

/**
 * A conversa com o aluno.
 *
 * Busca ao abrir e ao voltar o foco da aba — não há tempo real no projeto, e
 * um `setInterval` escondido aqui seria pior que a ausência dele: consumo
 * constante para uma tela que fica aberta o dia todo no balcão da academia.
 */
export function Conversa({
  token,
  linkId,
  euId,
  nomeDoAluno,
  encerrado,
}: {
  token: string;
  linkId: string;
  euId: string;
  nomeDoAluno: string;
  encerrado?: boolean;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [subindoFoto, setSubindoFoto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** Foto aberta em tela cheia. A conversa mostra miniatura; o detalhe do
   *  agachamento só se vê grande. */
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);

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

  /**
   * Atualiza sozinho enquanto a conversa está ABERTA e a aba VISÍVEL.
   *
   * É o tempo real que esta conversa precisa, sem WebSocket. O intervalo só
   * existe com a tela na frente da pessoa: minimizou ou trocou de aba, para —
   * e é isso que separa isto de um `setInterval` solto, que ficaria batendo na
   * API o dia todo no balcão da academia.
   *
   * Oito segundos porque a conversa aqui é assíncrona: ninguém digita esperando
   * resposta no mesmo segundo, e cada segundo a menos multiplica requisição por
   * nada.
   */
  useEffect(() => {
    const atualizar = () => {
      if (document.visibilityState === "visible") carregar();
    };
    document.addEventListener("visibilitychange", atualizar);
    const relogio = setInterval(atualizar, 8000);
    return () => {
      document.removeEventListener("visibilitychange", atualizar);
      clearInterval(relogio);
    };
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

  async function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Limpa já: sem isto, escolher a MESMA foto de novo não dispara o evento.
    e.target.value = "";
    if (!file) return;

    setSubindoFoto(true);
    setErro(null);
    try {
      const msg = await enviarFoto(token, linkId, file);
      setMensagens((atual) => [...atual, msg]);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível enviar a foto.");
    } finally {
      setSubindoFoto(false);
    }
  }

  if (carregando) return <p className="vazio">Carregando conversa…</p>;

  return (
    <div>
      {/* Tela cheia por cima de tudo. Fecha no clique, no Esc e no botão —
          três saídas, porque uma foto que não fecha é uma tela travada. */}
      {ampliada && (
        <div
          className="cortina-foto"
          role="dialog"
          aria-modal="true"
          aria-label="Foto ampliada"
          onClick={() => setAmpliada(null)}
          onKeyDown={(e) => e.key === "Escape" && setAmpliada(null)}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <button className="discreto fechar-foto" onClick={() => setAmpliada(null)}>
            Fechar
          </button>
          <img src={ampliada} alt="Foto ampliada" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      <div className="conversa">
        {mensagens.length === 0 && (
          <p className="vazio" style={{ padding: 8 }}>
            Nenhuma mensagem ainda. Uma palavra no começo da semana costuma valer mais que dez no
            fim.
          </p>
        )}

        {mensagens.map((m, i) => {
          const meu = m.autor === euId;
          // O nome só aparece quando o lado muda: repetir "Você" em cinco
          // mensagens seguidas é ruído, e some quem está falando de verdade.
          const mudouDeLado = i === 0 || mensagens[i - 1].autor !== m.autor;
          return (
            <div key={m.id} className={`fala ${meu ? "minha" : "dele"}`}>
              {mudouDeLado && <span className="quem">{meu ? "Você" : nomeDoAluno}</span>}
              <div className="balao">
                {m.imageUrl && (
                  <img
                    src={m.imageUrl}
                    alt="Foto enviada na conversa"
                    loading="lazy"
                    onClick={() => setAmpliada(m.imageUrl)}
                    style={{ cursor: "zoom-in" }}
                  />
                )}
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
            </div>
          );
        })}
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
            ref={arquivo}
            type="file"
            accept="image/*"
            onChange={escolherFoto}
            style={{ display: "none" }}
          />
          <button
            type="button"
            className="discreto"
            onClick={() => arquivo.current?.click()}
            disabled={subindoFoto}
            title="Enviar foto"
            aria-label="Enviar foto"
          >
            {subindoFoto ? "…" : "Foto"}
          </button>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={`Escreva para ${nomeDoAluno.split(" ")[0]}…`}
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
