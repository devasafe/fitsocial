import { useState } from "react";
import { entrar, ErroApi, type Eu } from "../api";
import { MARCA } from "../marca";

/**
 * Entrada do painel.
 *
 * É o mesmo login do app — a conta do coach é a conta dele de sempre, porque
 * ele também treina. Não há cadastro aqui: quem chega neste endereço já tem
 * conta e recebeu a liberação profissional.
 */
export function Entrar({ aoEntrar }: { aoEntrar: (token: string, eu: Eu) => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await entrar(email.trim(), senha);
      aoEntrar(r.token, r.user);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Não foi possível entrar.");
      setEnviando(false);
    }
  }

  return (
    <div className="entrar">
      <form onSubmit={enviar}>
        <div className="marca" style={{ marginBottom: 24 }}>
          <b>{MARCA}</b>
          <span>pro</span>
        </div>

        <h1 style={{ marginBottom: 4 }}>Entrar</h1>
        <p className="sub" style={{ marginBottom: 24 }}>
          Use a mesma conta do aplicativo.
        </p>

        <div className="campo">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="campo">
          <label htmlFor="senha">Senha</label>
          <input
            id="senha"
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
        </div>

        {erro && (
          <p className="erro" role="alert" style={{ marginBottom: 12 }}>
            {erro}
          </p>
        )}

        <button className="primario" type="submit" disabled={enviando} style={{ width: "100%" }}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
