// Espelha admin/src/api.ts e app-android/src/api/client.ts: mesma forma, mesmo
// tratamento de erro. Quem conhece um não precisa aprender outro.

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * A sessão morre com a aba.
 *
 * O painel mostra treino, constância e conversa de outras pessoas — dado que
 * elas autorizaram um profissional a ver, não o navegador de quem sentar
 * depois naquele computador. Num notebook de academia isso não é hipótese.
 *
 * O token é o mesmo do app (30 dias), porque a API não exige escopo separado
 * aqui de propósito: o coach também usa o painel pelo celular, dentro do
 * aplicativo. O que encurta a exposição é o `sessionStorage`.
 */
const CHAVE_TOKEN = "rumo.pro.token";

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
    // 401 é sessão morta. 403 aqui NÃO derruba: pode ser um aluno que fechou o
    // escopo, e perder a sessão por causa disso tiraria o coach do painel
    // inteiro por causa de uma tela.
    if (res.status === 401) sessao.limpar();
    throw new ErroApi(res.status, (dados as { error?: string }).error ?? `Erro ${res.status}`);
  }

  return dados as Envelope<T>;
}

/* ---------- entrar ---------- */

export interface Eu {
  id: string;
  name: string;
  email: string;
  pro?: { coach: boolean; nutri: boolean };
}

export const entrar = (email: string, password: string) =>
  fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErroApi(r.status, (d as { error?: string }).error ?? "Não foi possível entrar.");
    return d as { token: string; user: Eu };
  });

export interface Capacidade {
  papel: "coach" | "nutri";
  ativo: boolean;
  limite: number;
  alunos: number;
}

export const buscarCapacidades = (token: string) =>
  api<{ capacidades: Capacidade[] }>("/pro/me", { token });

/* ---------- alunos ---------- */

export interface Escopo {
  treinos: boolean;
  dieta: boolean;
  medidas: boolean;
  fotos: boolean;
}

export interface AlunoNaLista {
  id: string;
  papel: "coach" | "nutri";
  status: string;
  escopo: Escopo;
  desde: string;
  aluno: { id: string; nome: string; username: string | null; avatarUrl: string };
  /** Nulo quando o aluno não abriu os treinos — diferente de não ter treinado. */
  treinos: { ultimoEm: string | null; naSemana: number } | null;
}

export const listarAlunos = (token: string) => api<AlunoNaLista[]>("/pro/alunos", { token });

export interface ExercicioNaLista {
  slug: string;
  nome: string;
  vezes: number;
  melhor: number;
  ultimo: number;
  delta: number | null;
  ultimaVez: string;
}

export interface DiaDoCalendario {
  dia: string;
  treinos: number;
  minutos: number;
}

export interface PerfilDoAluno {
  aluno: { id: string; nome: string; username: string | null; avatarUrl: string; bio: string };
  vinculo: { id: string; papel: "coach" | "nutri"; escopo: Escopo; desde: string };
  constancia: { total: number; week: number; streak: number; lastCheckIn: string | null };
  exercicios: ExercicioNaLista[];
  calendario: DiaDoCalendario[];
}

export const buscarAluno = (token: string, id: string, dias = 90) =>
  api<PerfilDoAluno>(`/pro/alunos/${id}?dias=${dias}`, { token });

export const encerrarAluno = (token: string, linkId: string) =>
  api<{ id: string; status: string }>(`/pro/alunos/${linkId}`, { method: "DELETE", token });

/* ---------- convites ---------- */

export interface Convite {
  code: string;
  papel: "coach" | "nutri";
  usosRestantes: number;
  expiraEm: string;
  /** Quando o convite foi endereçado a alguém pelo @. */
  para: { id: string; nome: string; username: string | null } | null;
}

export interface PessoaEncontrada {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string;
}

/**
 * Busca alguém pelo nome ou @.
 *
 * Usa a busca do app, e não uma do painel: o coach entra com a conta dele, e a
 * pessoa que ele procura é a mesma que qualquer um acharia. Inventar uma busca
 * só para o painel abriria uma segunda regra de quem é visível.
 */
export async function buscarPessoas(token: string, q: string): Promise<PessoaEncontrada[]> {
  // `/social/search` é rota antiga e responde `{users}`, sem o envelope
  // `{data, meta}` do resto. Acomodar aqui é mais honesto que mudar a forma da
  // resposta e quebrar o app instalado, que lê `users`.
  const res = await fetch(`${API_BASE_URL}/social/search?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ErroApi(res.status, "Não foi possível buscar.");
  const dados = (await res.json()) as { users?: PessoaEncontrada[] };
  return dados.users ?? [];
}

export const listarConvites = (token: string) => api<Convite[]>("/pro/convites", { token });

export const criarConvite = (
  token: string,
  papel: "coach" | "nutri",
  usos = 1,
  /** Com `username`, o convite vai direto para a pessoa, como notificação. */
  username?: string
) =>
  api<{
    code: string;
    expiraEm: string;
    usosRestantes: number;
    enviadoPara: { id: string; nome: string; username: string | null } | null;
  }>("/pro/convites", {
    method: "POST",
    body: { papel, usos, ...(username ? { username } : {}) },
    token,
  });

export const revogarConvite = (token: string, code: string) =>
  api<{ code: string }>(`/pro/convites/${code}`, { method: "DELETE", token });

/* ---------- prescrição ---------- */

export interface ExercicioPrescrito {
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string;
}

export interface SessaoPrescrita {
  day: string;
  focus: string;
  exercises: ExercicioPrescrito[];
}

export interface TreinoPrescrito {
  split: string;
  daysPerWeek: number;
  sessions: SessaoPrescrita[];
}

export const prescrever = (token: string, alunoId: string, summary: string, workout: TreinoPrescrito) =>
  api<{ id: string; version: number }>(`/pro/alunos/${alunoId}/treino`, {
    method: "PUT",
    body: { summary, workout },
    token,
  });

/* ---------- conversa ---------- */

export interface Mensagem {
  id: string;
  autor: string;
  texto: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  lidaEm: string | null;
  createdAt: string;
}

export const buscarMensagens = (token: string, linkId: string, cursor?: string | null) =>
  api<Mensagem[]>(
    `/pro/acompanhamentos/${linkId}/mensagens?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    { token }
  );

export const enviarMensagem = (token: string, linkId: string, texto: string) =>
  api<Mensagem>(`/pro/acompanhamentos/${linkId}/mensagens`, {
    method: "POST",
    body: { texto },
    token,
  });

export const buscarNaoLidas = (token: string) =>
  api<{ link: string; naoLidas: number }[]>("/pro/nao-lidas", { token });
