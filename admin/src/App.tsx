import { useEffect, useState } from "react";
import { buscarAdmin, sessao, type Admin } from "./api";
import { Entrar } from "./pages/Entrar";
import { Ia } from "./pages/Ia";
import { Usuarios } from "./pages/Usuarios";

export function App() {
  const [token, setToken] = useState<string | null>(() => sessao.ler());
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [verificando, setVerificando] = useState(true);
  // Seção no hash: dá URL para marcar nos favoritos sem trazer um roteador.
  const [seccao, setSeccao] = useState(() => window.location.hash.slice(2) || "ia");

  useEffect(() => {
    const ouvir = () => setSeccao(window.location.hash.slice(2) || "ia");
    window.addEventListener("hashchange", ouvir);
    return () => window.removeEventListener("hashchange", ouvir);
  }, []);

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
          {[
            { id: "ia", rotulo: "Consumo de IA" },
            { id: "usuarios", rotulo: "Usuários" },
          ].map((item) => (
            <button
              key={item.id}
              aria-current={seccao === item.id ? "page" : undefined}
              onClick={() => {
                window.location.hash = `#/${item.id}`;
                setSeccao(item.id);
              }}
            >
              {item.rotulo}
            </button>
          ))}
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
        {seccao === "usuarios" ? <Usuarios token={token} /> : <Ia token={token} />}
      </main>
    </div>
  );
}
