import { lazy, Suspense, useEffect, useState } from "react";
import { buscarAdmin, sessao, type Admin } from "./api";
import { Entrar } from "./pages/Entrar";
import { Ia } from "./pages/Ia";
import { Usuarios } from "./pages/Usuarios";
import { Denuncias } from "./pages/Denuncias";
import { MARCA } from "./marca";

// O Painel carrega o Recharts, que sozinho pesa mais que o resto do app
// inteiro. Separado, a tela de login e a de usuários não pagam por ele.
const Painel = lazy(() => import("./pages/Painel").then((m) => ({ default: m.Painel })));

// As quatro seções, num lugar só: a lateral do desktop e a barra do celular
// leem da mesma lista.
//
// `curto` existe porque "Consumo de IA" não cabe num quarto de 360px, e
// truncar com reticências seria pior que escolher a palavra certa. Os glifos
// são os mesmos do app (RootNavigator.tsx) — quatro símbolos não justificam
// trazer uma biblioteca de ícones.
const SECOES = [
  { id: "painel", rotulo: "Crescimento", curto: "Crescimento", icone: "◆" },
  { id: "usuarios", rotulo: "Usuários", curto: "Usuários", icone: "●" },
  { id: "denuncias", rotulo: "Denúncias", curto: "Denúncias", icone: "⚑" },
  { id: "ia", rotulo: "Consumo de IA", curto: "IA", icone: "▲" },
] as const;

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

  function irPara(id: string) {
    window.location.hash = `#/${id}`;
    setSeccao(id);
  }

  if (verificando) return <div className="entrar" />;
  if (!token || !admin) return <Entrar aoEntrar={entrou} />;

  return (
    <div className="app">
      {/* Lateral no desktop, barra inferior no celular. São elementos
          diferentes no DOM, e não a mesma coisa reordenada por CSS: a ordem de
          tabulação e a leitura por leitor de tela seguem o DOM, não o visual. */}
      <aside className="lateral">
        <div className="marca">
          <b>{MARCA}</b>
          <span>painel</span>
        </div>

        <nav className="nav">
          {SECOES.map((item) => (
            <button
              key={item.id}
              aria-current={seccao === item.id ? "page" : undefined}
              onClick={() => irPara(item.id)}
            >
              {item.rotulo}
            </button>
          ))}
        </nav>

        <div className="rodape-lateral">
          <div style={{ color: "var(--texto-2)" }}>{admin.name}</div>
          <button className="discreto sair" onClick={sair}>
            Sair
          </button>
        </div>
      </aside>

      {/* O título da seção não vem aqui: cada página já imprime o próprio h1. */}
      <header className="cab-movel">
        <div className="marca">
          <b>{MARCA}</b>
          <span>painel</span>
        </div>
        <span className="quem">{admin.name}</span>
        <button className="discreto" onClick={sair}>
          Sair
        </button>
      </header>

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

      <nav className="barra-inferior" aria-label="Seções">
        {SECOES.map((item) => (
          <button
            key={item.id}
            aria-current={seccao === item.id ? "page" : undefined}
            onClick={() => irPara(item.id)}
          >
            <span className="icone" aria-hidden>
              {item.icone}
            </span>
            {item.curto}
          </button>
        ))}
      </nav>
    </div>
  );
}
