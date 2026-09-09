import { useEffect, useState } from "react";
import { buscarAdmin, sessao, type Admin } from "./api";
import { Entrar } from "./pages/Entrar";
import { Ia } from "./pages/Ia";

export function App() {
  const [token, setToken] = useState<string | null>(() => sessao.ler());
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [verificando, setVerificando] = useState(true);

  // Valida a sessão guardada antes de mostrar qualquer coisa: token na aba não
  // é prova de acesso — o papel pode ter sido revogado desde o último uso.
  useEffect(() => {
    if (!token) {
      setVerificando(false);
      return;
    }
    let ativo = true;
    buscarAdmin(token)
      .then((r) => ativo && setAdmin(r.data))
      .catch(() => {
        if (!ativo) return;
        sessao.limpar();
        setToken(null);
      })
      .finally(() => ativo && setVerificando(false));
    return () => {
      ativo = false;
    };
  }, [token]);

  function entrou(novo: string) {
    sessao.gravar(novo);
    setVerificando(true);
    setToken(novo);
  }

  function sair() {
    sessao.limpar();
    setToken(null);
    setAdmin(null);
  }

  if (verificando) return <div className="entrar" />;
  if (!token || !admin) return <Entrar aoEntrar={entrou} />;

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <b>FitSocial</b>
          <span>painel</span>
        </div>

        <nav className="nav">
          <button aria-current="page">Consumo de IA</button>
        </nav>

        <div className="rodape-lateral">
          <div style={{ color: "var(--texto-2)" }}>{admin.name}</div>
          <button
            className="discreto"
            onClick={sair}
            style={{ marginTop: 8, width: "100%" }}
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="conteudo">
        <Ia token={token} />
      </main>
    </div>
  );
}
