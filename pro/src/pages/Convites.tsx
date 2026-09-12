import { useCallback, useEffect, useRef, useState } from "react";
import {
  buscarCapacidades,
  buscarPessoas,
  criarConvite,
  listarConvites,
  revogarConvite,
  ErroApi,
  type Capacidade,
  type Convite,
  type PessoaEncontrada,
} from "../api";

/**
 * O link que o coach manda no WhatsApp.
 *
 * Caminho, e não hash: o app na web usa history API, e o Caddy dele já serve o
 * index.html para qualquer caminho. Quem abrir sem ter conta cai no cadastro e
 * o código fica guardado até a conta existir.
 */
function linkDoConvite(code: string): string {
  return `https://fit.satriz.club/convite/${code}`;
}

export function Convites({ token }: { token: string }) {
  const [convites, setConvites] = useState<Convite[]>([]);
  const [capacidades, setCapacidades] = useState<Capacidade[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  // Busca de pessoa, para o convite endereçado.
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<PessoaEncontrada[]>([]);
  const [buscando, setBuscando] = useState(false);
  const tempoDaBusca = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [c, cap] = await Promise.all([listarConvites(token), buscarCapacidades(token)]);
      setConvites(c.data);
      setCapacidades(cap.data.capacidades);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar os convites.");
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Espera a pessoa parar de digitar: uma busca por tecla castigaria a API por
  // nada, e a lista piscaria a cada letra.
  useEffect(() => {
    if (tempoDaBusca.current) clearTimeout(tempoDaBusca.current);
    const termo = busca.trim().replace(/^@/, "");
    if (termo.length < 2) {
      setAchados([]);
      return;
    }
    setBuscando(true);
    tempoDaBusca.current = setTimeout(async () => {
      try {
        setAchados(await buscarPessoas(token, termo));
      } catch {
        setAchados([]);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => {
      if (tempoDaBusca.current) clearTimeout(tempoDaBusca.current);
    };
  }, [busca, token]);

  const papelPadrao = capacidades[0]?.papel ?? "coach";

  async function convidar(pessoa: PessoaEncontrada) {
    setErro(null);
    setAviso(null);
    if (!pessoa.username) {
      setErro(`${pessoa.name} ainda não escolheu um nome de usuário. Mande o link em vez disso.`);
      return;
    }
    try {
      await criarConvite(token, papelPadrao, 1, pessoa.username);
      setAviso(`Convite enviado para ${pessoa.name}. Ele recebe um aviso no aplicativo.`);
      setBusca("");
      setAchados([]);
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível enviar o convite.");
    }
  }

  async function gerarLink(papel: "coach" | "nutri") {
    setErro(null);
    setAviso(null);
    try {
      await criarConvite(token, papel, 1);
      await carregar();
    } catch (e) {
      // O 409 de lotação é informação, não falha: a mensagem da API já diz
      // quantos de quantos, e é isso que o coach precisa ler.
      setErro(e instanceof ErroApi ? e.message : "Não foi possível gerar o convite.");
    }
  }

  async function copiar(code: string) {
    try {
      await navigator.clipboard.writeText(linkDoConvite(code));
      setCopiado(code);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      setErro("Não consegui copiar. Selecione o link e copie manualmente.");
    }
  }

  async function revogar(code: string) {
    try {
      await revogarConvite(token, code);
      await carregar();
    } catch {
      setErro("Não foi possível cancelar este convite.");
    }
  }

  if (carregando) return <p className="vazio">Carregando…</p>;

  const lotado = capacidades.every((c) => c.alunos >= c.limite);

  return (
    <>
      <h1>Convidar</h1>
      <p className="sub" style={{ marginBottom: 24 }}>
        Procure a pessoa pelo nome ou @ e mande o convite direto. Quem ainda não tem conta entra
        pelo link.
      </p>

      <div className="cartoes" style={{ marginBottom: 24 }}>
        {capacidades.map((c) => (
          <div key={c.papel} className="cartao">
            <div className="num">
              {c.alunos}
              <span style={{ fontSize: 16, color: "var(--texto-3)" }}> / {c.limite}</span>
            </div>
            <div className="rotulo">{c.papel === "coach" ? "alunos" : "pacientes"}</div>
            <div className="aviso">
              {c.alunos >= c.limite
                ? "Limite atingido — encerre um acompanhamento para abrir vaga."
                : `${c.limite - c.alunos} ${c.limite - c.alunos === 1 ? "vaga" : "vagas"}`}
            </div>
          </div>
        ))}
      </div>

      {/* Convite endereçado: o caminho principal. O link solto virou a saída
          para quem ainda não tem conta, e por isso ficou abaixo. */}
      <div className="painel" style={{ marginBottom: 16 }}>
        <div className="campo" style={{ marginBottom: achados.length ? 12 : 0 }}>
          <label htmlFor="busca">Quem você quer convidar</label>
          <input
            id="busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="nome ou @usuario"
            autoComplete="off"
            disabled={lotado}
          />
        </div>

        {buscando && <p className="sub">Procurando…</p>}

        {!buscando && busca.trim().length >= 2 && achados.length === 0 && (
          <p className="sub">
            Ninguém encontrado. Se a pessoa ainda não tem conta, mande o link de convite abaixo.
          </p>
        )}

        {achados.length > 0 && (
          <div className="linhas">
            {achados.map((p) => (
              <div key={p.id} className="linha" style={{ cursor: "default" }}>
                {p.avatarUrl ? (
                  <img className="avatar" src={p.avatarUrl} alt="" />
                ) : (
                  <div className="avatar" aria-hidden />
                )}
                <span className="crescer">
                  <span className="nome">{p.name}</span>
                  <br />
                  <span className="sub">{p.username ? `@${p.username}` : "sem nome de usuário"}</span>
                </span>
                <button className="primario" onClick={() => convidar(p)}>
                  Convidar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {aviso && <p style={{ color: "var(--verde-claro)" }}>{aviso}</p>}
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      <h2>Ou mande um link</h2>
      <p className="sub" style={{ marginTop: -8, marginBottom: 12 }}>
        Para quem ainda não tem conta no aplicativo. Quem abrir o link cria a conta já vinculado a
        você.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {capacidades.map((c) => (
          <button
            key={c.papel}
            className="discreto"
            disabled={c.alunos >= c.limite}
            onClick={() => gerarLink(c.papel)}
          >
            Gerar link de {c.papel === "coach" ? "treino" : "nutrição"}
          </button>
        ))}
      </div>

      <h2>Convites em aberto</h2>
      {convites.length === 0 ? (
        <p className="vazio">Nenhum convite esperando resposta.</p>
      ) : (
        <div className="painel">
          <div className="linhas">
            {convites.map((c) => (
              <div key={c.code} className="linha" style={{ cursor: "default" }}>
                <span className="crescer">
                  {c.para ? (
                    <>
                      <span className="nome">{c.para.nome}</span>
                      {c.para.username && <span className="sub"> @{c.para.username}</span>}
                      <br />
                      <span className="sub">
                        aguardando resposta · até {new Date(c.expiraEm).toLocaleDateString("pt-BR")}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="codigo">{c.code}</span>
                      <br />
                      <span className="sub">
                        link aberto · {c.papel === "coach" ? "Treino" : "Nutrição"} · até{" "}
                        {new Date(c.expiraEm).toLocaleDateString("pt-BR")}
                        {c.usosRestantes > 1 && ` · ${c.usosRestantes} usos`}
                      </span>
                    </>
                  )}
                </span>

                {/* O link só serve para o convite aberto: no endereçado, quem
                    tem que abrir é a pessoa, pelo aviso que recebeu. */}
                {!c.para && (
                  <button className="discreto" onClick={() => copiar(c.code)}>
                    {copiado === c.code ? "Copiado!" : "Copiar link"}
                  </button>
                )}
                <button className="discreto perigo" onClick={() => revogar(c.code)}>
                  Cancelar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
