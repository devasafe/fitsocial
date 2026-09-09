// Espelha app-android/src/api/client.ts: mesma forma, mesmo tratamento de erro.
// Quem já conhece o cliente do app não precisa aprender outro aqui.

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** A sessão do painel morre com a aba: o token dura 12h e quem opera aqui
 *  apaga contas. Nada de localStorage. */
const CHAVE_TOKEN = "fitsocial.admin.token";

export const sessao = {
  ler: () => {
    try {
      return sessionStorage.getItem(CHAVE_TOKEN);
    } catch {
      return null; // navegador com armazenamento bloqueado
    }
  },
  gravar: (token: string) => {
    try {
      sessionStorage.setItem(CHAVE_TOKEN, token);
    } catch {
      /* segue só em memória nesta aba */
    }
  },
  limpar: () => {
    try {
      sessionStorage.removeItem(CHAVE_TOKEN);
    } catch {
      /* nada a fazer */
    }
  },
};

export class ErroApi extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ErroApi";
  }
}

interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export async function api<T>(
  caminho: string,
  opcoes: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<Envelope<T>> {
  const { method = "GET", body, token } = opcoes;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${caminho}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ErroApi(0, "Sem conexão com a API.");
  }

  const dados = await res.json().catch(() => ({}));

  if (!res.ok) {
    // 401/403 numa rota do painel = a sessão não vale mais. Derruba na hora,
    // em vez de deixar a tela mostrando erro em toda chamada seguinte.
    if (res.status === 401 || res.status === 403) sessao.limpar();
    throw new ErroApi(res.status, (dados as { error?: string }).error ?? `Erro ${res.status}`);
  }

  return dados as Envelope<T>;
}

/* ---------- formatos que a API devolve ---------- */

export interface Admin {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface UsoPorDia {
  dia: string;
  chamadas: number;
  falhas: number;
  tokens: number;
}

export interface UsoPorChave {
  keyLabel: string;
  provider: string;
  chamadas: number;
  falhas: number;
  tokens: number;
  limiteDiario: number | null;
  usoPct: number | null;
}

export const entrar = (email: string, password: string) =>
  api<{ token: string; user: { id: string; name: string; role: string } }>("/admin/session", {
    method: "POST",
    body: { email, password },
  });

export const buscarAdmin = (token: string) => api<Admin>("/admin/me", { token });

export const buscarSerie = (token: string, dias: number) =>
  api<UsoPorDia[]>(`/admin/ai/usage?dias=${dias}`, { token });

export const buscarChaves = (token: string) => api<UsoPorChave[]>("/admin/ai/keys", { token });
