import { useEffect, useState } from "react";
import { buscarCapacidades, sessao, type Capacidade, type Eu } from "./api";
import { Entrar } from "./pages/Entrar";
import { Alunos } from "./pages/Alunos";
import { Aluno } from "./pages/Aluno";
import { Convites } from "./pages/Convites";
import { MARCA } from "./marca";

// Seção no hash, como no painel administrativo: dá URL para marcar nos
// favoritos e para voltar do botão do navegador, sem trazer um roteador para
// três telas.
//
// `#/aluno/<id>` é a única rota com parâmetro.
function lerHash(): { secao: string; alunoId?: string } {
  const bruto = window.location.hash.slice(2);
  const [secao, param] = bruto.split("/");
  if (secao === "aluno" && param) return { secao: "aluno", alunoId: param };
  return { secao: secao || "alunos" };
}

const SECOES = [
  { id: "alunos", rotulo: "Alunos" },
  { id: "convites", rotulo: "Convidar" },
] as const;

export function App() {
  const [token, setToken] = useState<string | null>(() => sessao.ler());
  const [eu, setEu] = useState<Eu | null>(null);
  const [capacidades, setCapacidades] = useState<Capacidade[]>([]);
  const [verificando, setVerificando] = useState(true);
  const [rota, setRota] = useState(lerHash);

  useEffect(() => {
    const ouvir = () => setRota(lerHash());
    window.addEventListener("hashchange", ouvir);
    return () => window.removeEventListener("hashchange", ouvir);
  }, []);

  // Valida a sessão guardada antes de mostrar qualquer coisa: token na aba não
  // é prova de acesso — a liberação profissional pode ter sido revogada desde
  // o último uso, e a API confere isso a cada requisição.
  useEffect(() => {
    if (!token) {
      setVerificando(false);
      return;
    }
    let ativo = true;
    buscarCapacidades(token)
      .then((r) => {
        if (!ativo) return;
        setCapacidades(r.data.capacidades);
        setSemAcesso(r.data.capacidades.length === 0);
      })
      .catch(() => {
        if (!ativo) return;
        // 403 aqui significa conta sem acesso profissional — não é sessão
        // inválida, e por isso a mensagem é outra.
        setSemAcesso(true);
      })
      .finally(() => ativo && setVerificando(false));
    return () => {
      ativo = false;
    };
  }, [token]);

  const [semAcesso, setSemAcesso] = useState(false);

  function entrou(novo: string, quem: Eu) {
    sessao.gravar(novo);
    setEu(quem);
    setVerificando(true);
    setSemAcesso(false);
    setToken(novo);
  }

  function sair() {
    sessao.limpar();
    setToken(null);
    setEu(null);
    setCapacidades([]);
    setSemAcesso(false);
  }

  function irPara(hash: string) {
    window.location.hash = `#/${hash}`;
    setRota(lerHash());
  }

  if (verificando) return <div className="entrar" />;
  if (!token) return <Entrar aoEntrar={entrou} />;

  if (semAcesso) {
    return (
      <div className="entrar">
        <div style={{ maxWidth: 380, textAlign: "center" }}>
          <div className="marca" style={{ justifyContent: "center", marginBottom: 16 }}>
            <b>{MARCA}</b>
            <span>pro</span>
          </div>
          <h1>Conta sem acesso profissional</h1>
          <p className="sub" style={{ marginTop: 8 }}>
            Esta conta entra no aplicativo normalmente, mas ainda não foi liberada como coach ou
            nutricionista. Fale com o suporte para liberar.
          </p>
          <button className="discreto" style={{ marginTop: 16 }} onClick={sair}>
            Sair
          </button>
        </div>
      </div>
    );
  }

  const totalAlunos = capacidades.reduce((s, c) => s + c.alunos, 0);
  const totalLimite = capacidades.reduce((s, c) => s + c.limite, 0);

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <b>{MARCA}</b>
          <span>pro</span>
        </div>

        <nav className="nav">
          {SECOES.map((s) => (
            <button
              key={s.id}
              aria-current={rota.secao === s.id || (s.id === "alunos" && rota.secao === "aluno") ? "page" : undefined}
              onClick={() => irPara(s.id)}
            >
              {s.rotulo}
            </button>
          ))}
        </nav>

        <div className="rodape-lateral">
          <div style={{ color: "var(--texto-2)" }}>
            {eu?.name ?? "Profissional"}
            <br />
            <span className="sub">
              {totalAlunos} de {totalLimite}
            </span>
          </div>
          <button className="discreto" onClick={sair}>
            Sair
          </button>
        </div>
      </aside>

      <main className="conteudo">
        {rota.secao === "convites" ? (
          <Convites token={token} />
        ) : rota.secao === "aluno" && rota.alunoId ? (
          <Aluno
            token={token}
            alunoId={rota.alunoId}
            euId={eu?.id ?? ""}
            voltar={() => irPara("alunos")}
          />
        ) : (
          <Alunos token={token} abrir={(id) => irPara(`aluno/${id}`)} />
        )}
      </main>
    </div>
  );
}
