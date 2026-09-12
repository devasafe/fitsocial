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

/**
 * Quem sou eu, a partir do token guardado.
 *
 * Precisa existir separado do login porque a sessão sobrevive ao recarregar a
 * página, e o usuário não: sem isto, depois de um F5 o painel não sabia quem
 * era o dono da sessão — e a conversa deixava de distinguir quem falou o quê,
 * porque a comparação era com um id vazio.
 */
export async function buscarEu(token: string): Promise<Eu> {
  const r = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new ErroApi(r.status, "Sessão inválida.");
  const d = (await r.json()) as { user: Eu };
  return d.user;
}

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

/** As janelas que o painel oferece — as mesmas da aba do aluno. */
export const JANELAS = [30, 90, 365, 0] as const;
export type Janela = (typeof JANELAS)[number];

export function rotuloDaJanela(dias: Janela): string {
  if (dias === 0) return "Tudo";
  if (dias === 365) return "1 ano";
  return `${dias} dias`;
}

/** As métricas plotáveis — também as mesmas da aba do aluno. */
export const METRICAS = ["carga_max", "rm_estimado", "volume", "series", "reps"] as const;
export type Metrica = (typeof METRICAS)[number];

export function rotuloDaMetrica(m: Metrica): string {
  switch (m) {
    case "carga_max":
      return "Carga";
    case "rm_estimado":
      return "1RM est.";
    case "volume":
      return "Volume";
    case "series":
      return "Séries";
    case "reps":
      return "Repetições";
  }
}

/** Unidade do eixo, para o rótulo do gráfico não mentir a métrica. */
export function unidadeDaMetrica(m: Metrica): string {
  switch (m) {
    case "carga_max":
    case "rm_estimado":
    case "volume":
      return "kg";
    case "series":
      return "séries";
    case "reps":
      return "reps";
  }
}

export interface PontoDaSerie {
  data: string;
  valor: number;
  /** Neste treino o aluno bateu o próprio recorde. */
  ehPR: boolean;
}

export const buscarSerie = (
  token: string,
  alunoId: string,
  slug: string,
  dias: Janela,
  metrica: Metrica
) =>
  api<PontoDaSerie[]>(
    `/pro/alunos/${alunoId}/exercicios/${encodeURIComponent(slug)}?dias=${dias}&metrica=${metrica}`,
    { token }
  );

/* ---------- cardio ---------- */

export const METRICAS_CARDIO = ["pace", "distancia", "duracao", "velocidade"] as const;
export type MetricaCardio = (typeof METRICAS_CARDIO)[number];

export function rotuloDaMetricaCardio(m: MetricaCardio): string {
  switch (m) {
    case "pace":
      return "Pace";
    case "distancia":
      return "Distância";
    case "duracao":
      return "Duração";
    case "velocidade":
      return "Velocidade";
  }
}

/** Pace vem em segundos por quilômetro e se lê em minutos: 300 é "5:00". */
export function formatarCardio(v: number, m: MetricaCardio): string {
  switch (m) {
    case "pace": {
      const min = Math.floor(v / 60);
      const seg = Math.round(v % 60);
      // 59,6 s arredonda para 60: vira o minuto seguinte, não "5:60".
      return seg === 60 ? `${min + 1}:00` : `${min}:${String(seg).padStart(2, "0")}`;
    }
    case "distancia":
      return `${v.toFixed(1).replace(".", ",")} km`;
    case "duracao":
      return `${Math.round(v)} min`;
    case "velocidade":
      return `${v.toFixed(1).replace(".", ",")} km/h`;
  }
}

export interface EsporteNaLista {
  sportId: string;
  nome: string;
  vezes: number;
  distanciaKm: number;
  /** Segundos por quilômetro. Zero quando nenhuma sessão teve distância. */
  melhorPace: number;
  ultimoPace: number;
  /** Positivo é melhora: o pace CAIU. Nulo quando só houve uma sessão. */
  delta: number | null;
  ultimaVez: string;
}

export const buscarCardio = (token: string, alunoId: string, dias: Janela) =>
  api<EsporteNaLista[]>(`/pro/alunos/${alunoId}/cardio?dias=${dias}`, { token });

export async function buscarSerieDeCardio(
  token: string,
  alunoId: string,
  sportId: string,
  dias: Janela,
  metrica: MetricaCardio
): Promise<{ pontos: PontoDaSerie[]; menorEhMelhor: boolean }> {
  const r = await api<PontoDaSerie[]>(
    `/pro/alunos/${alunoId}/cardio/${encodeURIComponent(sportId)}?dias=${dias}&metrica=${metrica}`,
    { token }
  );
  return { pontos: r.data, menorEhMelhor: (r.meta?.menorEhMelhor as boolean) ?? false };
}

export interface GrupoTreinado {
  grupo: string;
  series: number;
}

export const buscarGrupos = (token: string, alunoId: string, dias: Janela) =>
  api<GrupoTreinado[]>(`/pro/alunos/${alunoId}/grupos?dias=${dias}`, { token });

export interface Conquista {
  id: string;
  exerciseName: string;
  exerciseSlug: string;
  type: string;
  repRange: string | null;
  value: number;
  previousValue: number;
  unit: string;
  achievedAt: string;
}

/**
 * O histórico de conquistas, paginado por cursor — a mesma lista que o aluno
 * rola no app dele. Sem o cursor, o coach parava nas mais recentes e não tinha
 * como pedir o começo da história, que é justamente onde há mais o que ler.
 */
export async function buscarConquistas(
  token: string,
  alunoId: string,
  cursor?: string | null
): Promise<{ itens: Conquista[]; proximo: string | null }> {
  const r = await api<Conquista[]>(
    `/pro/alunos/${alunoId}/conquistas?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    { token }
  );
  return { itens: r.data, proximo: (r.meta?.nextCursor as string | null) ?? null };
}

/**
 * Os mesmos rótulos de `app-android/src/api/prs.ts`.
 *
 * Duplicar aqui é deliberado: o painel não compartilha build com o app, e a
 * alternativa seria um pacote comum para dois textos. O que não pode divergir
 * é o TEXTO — coach e aluno olham a mesma conquista, e chamar o mesmo recorde
 * de duas coisas diferentes é como uma conversa começa errada.
 */
export function rotuloDoRecorde(type: string, repRange: string | null): string {
  switch (type) {
    case "carga_max":
      return "Carga máxima";
    case "rm_estimado":
      return "1RM estimado";
    case "carga_faixa":
      return `Carga · ${repRange} reps`;
    case "best_dist":
      return "Maior distância";
    case "best_time":
      return `Melhor tempo · ${repRange}`;
    case "aulas":
      return "Aulas";
    case "horas":
      return "Horas de treino";
    case "wod_time":
      return `Tempo · ${repRange}`;
    case "wod_score":
      return `Score · ${repRange}`;
    case "wod_load":
      return `Carga · ${repRange}`;
    default:
      return type;
  }
}

/**
 * "jiu_jitsu" vira "Jiu jitsu".
 *
 * O `exerciseName` de um recorde nem sempre é nome de exercício: nos recordes
 * de aulas e de horas ele é o id do esporte, cru. Mesma função do
 * `sportLabel` do app, pelo mesmo motivo de sempre — os dois lados olham a
 * mesma conquista.
 */
export function nomeDoExercicio(nome: string): string {
  const s = nome.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function mmss(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function valorDoRecorde(type: string, value: number, unit: string): string {
  switch (type) {
    case "best_dist":
      return `${Math.round((value / 1000) * 100) / 100} km`;
    case "best_time":
    case "wod_time":
      return mmss(value);
    case "aulas":
      return `${value} aulas`;
    case "horas":
      return `${value} h`;
    default:
      return `${Math.round(value * 10) / 10} ${unit}`;
  }
}

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

/**
 * Manda uma foto na conversa.
 *
 * Dois passos, e é assim no app também: sobe pelo `POST /uploads`, que
 * reencoda e descarta o EXIF — inclusive a coordenada de GPS —, e só então a
 * mensagem carrega a URL. Nada de imagem em base64 dentro do corpo da
 * mensagem, que incharia o banco e a resposta de toda a conversa.
 */
export async function enviarFoto(token: string, linkId: string, file: File): Promise<Mensagem> {
  const form = new FormData();
  form.append("image", file);

  // Sem `Content-Type`: o navegador precisa montar o boundary do multipart.
  const up = await fetch(`${API_BASE_URL}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!up.ok) {
    const d = (await up.json().catch(() => ({}))) as { error?: string };
    throw new ErroApi(up.status, d.error ?? "Não foi possível enviar a foto.");
  }
  const { url, width, height } = (await up.json()) as {
    url: string;
    width?: number;
    height?: number;
  };

  const r = await api<Mensagem>(`/pro/acompanhamentos/${linkId}/mensagens`, {
    method: "POST",
    body: { imageUrl: url, imageWidth: width, imageHeight: height },
    token,
  });
  return r.data;
}
