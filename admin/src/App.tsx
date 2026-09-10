import { lazy, Suspense, useEffect, useState } from "react";
import { buscarAdmin, sessao, type Admin } from "./api";
import { Entrar } from "./pages/Entrar";
import { Ia } from "./pages/Ia";
import { Usuarios } from "./pages/Usuarios";
import { Denuncias } from "./pages/Denuncias";

// O Painel carrega o Recharts, que sozinho pesa mais que o resto do app
// inteiro. Separado, a tela de login e a de usuários não pagam por ele.
const Painel = lazy(() => import("./pages/Painel").then((m) => ({ default: m.Painel })));

export function App() {
  const [token, setToken] = useState<string | null>(() => sessao.ler());
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [verificando, setVerificando] = useState(true);
  // Seção no hash: dá URL para marcar nos favoritos sem trazer um roteador.
  const [seccao, setSeccao] = useState(() => window.location.hash.slice(2) || "painel");

  useEffect(() => {
    const ouvir = () => setSeccao(window.location.hash.slice(2) || "painel");
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
            { id: "painel", rotulo: "Crescimento" },
            { id: "usuarios", rotulo: "Usuários" },
            { id: "denuncias", rotulo: "Denúncias" },
            { id: "ia", rotulo: "Consumo de IA" },
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
        {seccao === "usuarios" ? (
          <Usuarios token={token} />
        ) : seccao === "denuncias" ? (
          <Denuncias token={token} />
        ) : seccao === "ia" ? (
          <Ia token={token} />
        ) : (
          <Suspense fallback={<p className="vazio">Carregando…</p>}>
            <Painel token={token} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
