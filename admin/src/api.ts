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

/* ---------- usuários ---------- */

export interface UsuarioAdmin {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: string;
  tier: string;
  tierEfetivo: "free" | "premium";
  premiumSource: string | null;
  premiumUntil: string | null;
  status: string;
  statusEfetivo: string;
  statusReason: string;
  suspendedUntil: string | null;
  contentVisible: boolean;
  createdAt: string;
}

export interface DetalheUsuario {
  user: UsuarioAdmin;
  contagens: { posts: number; atividades: number };
  auditoria: { acao: string; motivo: string; quando: string; por: string }[];
}

export interface FiltroUsuarios {
  q?: string;
  status?: string;
  tier?: string;
  cursor?: string | null;
}

export function listarUsuarios(token: string, f: FiltroUsuarios = {}) {
  const p = new URLSearchParams({ limit: "25" });
  if (f.q) p.set("q", f.q);
  if (f.status) p.set("status", f.status);
  if (f.tier) p.set("tier", f.tier);
  if (f.cursor) p.set("cursor", f.cursor);
  return api<UsuarioAdmin[]>(`/admin/users?${p}`, { token });
}

export const buscarUsuario = (token: string, id: string) =>
  api<DetalheUsuario>(`/admin/users/${id}`, { token });

export const banirUsuario = (token: string, id: string, reason: string) =>
  api<UsuarioAdmin>(`/admin/users/${id}/ban`, { method: "POST", body: { reason }, token });

export const desbanirUsuario = (token: string, id: string, reason: string) =>
  api<UsuarioAdmin>(`/admin/users/${id}/unban`, { method: "POST", body: { reason }, token });

export const suspenderUsuario = (token: string, id: string, until: string, reason: string) =>
  api<UsuarioAdmin>(`/admin/users/${id}/suspend`, { method: "POST", body: { until, reason }, token });

export const definirPremium = (
  token: string,
  id: string,
  grant: boolean,
  durationDays: number | null,
  reason: string
) =>
  api<UsuarioAdmin>(`/admin/users/${id}/premium`, {
    method: "POST",
    body: { grant, durationDays, reason },
    token,
  });

/* ---------- painel de crescimento ---------- */

export interface PontoDaSerie {
  dia: string;
  valor: number;
}

export interface SerieAtivos {
  dia: string;
  registraram: number;
  abriram: number;
}

export interface Panorama {
  totais: {
    contas: number; premium: number; banidas: number; suspensas: number;
    treinos: number; posts: number; ativos7d: number;
  };
  series: {
    novos: PontoDaSerie[];
    ativos: SerieAtivos[];
    treinos: PontoDaSerie[];
    posts: PontoDaSerie[];
    comentarios: PontoDaSerie[];
    coach: PontoDaSerie[];
  };
  retencao: {
    d1: number; d7: number; d30: number;
    base: { d1: number; d7: number; d30: number };
  };
  conversao: {
    premium: number;
    porOrigem: { origem: string; total: number }[];
    taxa: number;
    ativacao: number;
  };
  acessoDesde: string | null;
}

export const buscarPanorama = (token: string, dias: number) =>
  api<Panorama>(`/admin/metrics/overview?dias=${dias}`, { token });
