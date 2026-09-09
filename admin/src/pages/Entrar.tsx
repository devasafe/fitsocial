import { useState, type FormEvent } from "react";
import { entrar, ErroApi } from "../api";

export function Entrar({ aoEntrar }: { aoEntrar: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await entrar(email, senha);
      aoEntrar(r.data.token);
    } catch (err) {
      setErro(
        err instanceof ErroApi && err.status === 429
          ? "Muitas tentativas. Espere um minuto."
          : "E-mail ou senha não conferem."
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="entrar">
      <form onSubmit={enviar}>
        <div style={{ marginBottom: 6 }}>
          <h1>Painel do FitSocial</h1>
          <p className="selo" style={{ marginTop: 6 }}>
            Sua sessão aqui vale 12 horas e é separada da do aplicativo.
          </p>
        </div>

        {erro && (
          <div className="erro" role="alert">
            {erro}
          </div>
        )}

        <div>
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="senha">Senha</label>
          <input
            id="senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>

        <button className="acao" type="submit" disabled={enviando}>
          {enviando ? "Entrando" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
