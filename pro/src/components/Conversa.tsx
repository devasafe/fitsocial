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
