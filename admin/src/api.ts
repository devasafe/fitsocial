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

interface Envelope<T, M = Record<string, unknown>> {
  data: T;
  /** Opcional: rota que nao tem nada a dizer no `meta` devolve `{}`. */
  meta?: M;
}

export async function api<T, M = Record<string, unknown>>(
  caminho: string,
  opcoes: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<Envelope<T, M>> {
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

  return dados as Envelope<T, M>;
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
  /** O plano de verdade, calculado pelo mesmo motor que o aplicativo usa. */
  planoEfetivo?: "free" | "pro" | "pro_plus";
  /** Como a linha deve aparecer: "Grátis", "Pro", "Pro Coach", "Pro Nutri", "Pro+". */
  rotuloDoPlano?: string;
  /** Por que esta conta tem o acesso que tem. É o que separa quem paga. */
  origemDoPlano?:
    | "gratis"
    | "cortesia"
    | "fundador"
    | "cupom"
    | "assinatura"
    | "inadimplente"
    | "profissional"
    | "patrocinio"
    | "legado";
  premiumSource: string | null;
  premiumUntil: string | null;
  assinaturaAte?: string | null;
  assinaturaStatus?: string | null;
  produtoAssinado?: string | null;
  cortesiaAte?: string | null;
  /** Quantos profissionais bancam o Pro desta pessoa. */
  vinculosPatrocinados?: number;
  /** Por qual cupom esta pessoa chegou. */
  cupom?: string | null;
  cupomEm?: string | null;
  status: string;
  statusEfetivo: string;
  statusReason: string;
  suspendedUntil: string | null;
  contentVisible: boolean;
  /** Capacidade profissional: quem já é coach/nutri, com que teto e até quando. */
  pro?: {
    coach: { ativo: boolean; limite: number; validoAte: string | null };
    nutri: { ativo: boolean; limite: number; validoAte: string | null };
  };
  createdAt: string;
}

export interface DetalheUsuario {
  user: UsuarioAdmin;
  contagens: { posts: number; atividades: number };
  auditoria: { acao: string; motivo: string; quando: string; por: string }[];
  /**
   * Os cupons desta pessoa. Opcional porque um servidor anterior a esta versão
   * não manda o campo, e a ficha não pode quebrar por isso.
   *
   * Pode ter mais de um: quem entra pelo cupom de um parceiro e usa um de
   * campanha no checkout tem os dois, e os dois contam.
   */
  cupons?: CupomNaFicha[];
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

/**
 * Libera ou tira o acesso profissional.
 *
 * `limite` ausente mantém o teto que a conta já tinha — renovar o acesso de um
 * coach não pode devolvê-lo ao padrão sem querer.
 */
export const definirPro = (
  token: string,
  id: string,
  capacidade: "coach" | "nutri",
  grant: boolean,
  durationDays: number | null,
  reason: string,
  limite?: number
) =>
  api<UsuarioAdmin>(`/admin/users/${id}/pro`, {
    method: "POST",
    body: { capacidade, grant, durationDays, reason, limite },
    token,
  });

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
    /** Quantas contas em cada plano, incluindo as grátis. */
    porPlano?: { plano: string; total: number }[];
    /** Quantos têm dinheiro entrando. `premium` inclui cortesia e patrocínio. */
    pagantes?: number;
    taxa: number;
    taxaPagante?: number;
    ativacao: number;
  };
  acessoDesde: string | null;
}

export const buscarPanorama = (token: string, dias: number) =>
  api<Panorama>(`/admin/metrics/overview?dias=${dias}`, { token });

/* ---------- denúncias ---------- */

export interface DenunciaAgrupada {
  reportId: string;
  targetKind: string;
  targetId: string;
  denuncias: number;
  motivos: string[];
  primeira: string;
  ultima: string;
  conteudo: { texto: string; imageUrl: string; autorLabel: string };
  /** false quando o autor apagou antes de alguém analisar. */
  aindaNoAr: boolean;
  autor: { id: string; nome: string; username: string | null; status: string } | null;
}

export const buscarDenuncias = (token: string, status: string) =>
  api<DenunciaAgrupada[]>(`/admin/reports?status=${status}`, { token });

export const resolverDenuncia = (
  token: string,
  reportId: string,
  decision: "removido" | "mantido",
  reason: string
) =>
  api<{ decision: string; denunciasFechadas: number }>(`/admin/reports/${reportId}/resolve`, {
    method: "POST",
    body: { decision, reason },
    token,
  });

/* ---------- cupons ---------- */

export interface CupomAdmin {
  id: string;
  codigo: string;
  descricao: string;
  /** `null` quando o cupom só rastreia origem, sem mexer em preço. */
  desconto: { tipo: "percentual" | "valor" | "meses_gratis"; valor: number; rotulo: string } | null;
  /** `null` quando é campanha nossa, sem ninguém para pagar. */
  parceiro: { nome: string; contato: string; comissaoPercentual: number } | null;
  produtos: string[];
  ciclos: string[];
  limiteDeUsos: number | null;
  usos: number;
  validoAte: string | null;
  revogadoEm: string | null;
  criadoEm: string;
  relatorio: {
    /** Quantas pessoas CHEGARAM por ele, pagantes ou não. */
    entraram: number;
    pagaram: number;
    /** Entraram e ainda não pagaram. Diz se o cupom converte ou só atrai. */
    gratis: number;
    receitaCentavos: number;
    receitaFormatada: string;
    comissaoCentavos: number;
    comissaoFormatada: string;
    /** O que sobra depois de pagar o parceiro. */
    liquidoCentavos: number;
    liquidoFormatado: string;
  };
}

/** O histórico de cupons de UMA pessoa, como a ficha dela mostra. */
export interface CupomNaFicha {
  id: string;
  codigo: string;
  descricao: string;
  parceiro: string | null;
  /** O cupom foi encerrado depois — o uso continua valendo. */
  revogado: boolean;
  origem: "cadastro" | "checkout";
  entrouEm: string;
  primeiraCompraEm: string | null;
  totalPagoFormatado: string;
  comissaoFormatada: string;
}

export interface UsoDeCupom {
  id: string;
  user: string;
  nome: string;
  email: string;
  plano: string;
  origem: "cadastro" | "checkout";
  entrouEm: string;
  primeiraCompraEm: string | null;
  totalPagoCentavos: number;
  comissaoCentavos: number;
}

export type FiltroDeCupom = "ativos" | "revogados" | "todos";

/**
 * Lista os cupons. O `meta` traz a contagem das abas.
 *
 * Sem os contadores a tela nao pode dizer "Revogados (1)", e quem acabou de
 * revogar um cupom fica sem saber para onde ele foi.
 */
export const buscarCupons = (token: string, status: FiltroDeCupom = "ativos") =>
  api<CupomAdmin[], { total: number; ativos: number; revogados: number }>(
    `/admin/cupons?status=${status}`,
    { token }
  );

export const buscarCupom = (token: string, codigo: string) =>
  api<CupomAdmin & { usos: UsoDeCupom[] }>(`/admin/cupons/${encodeURIComponent(codigo)}`, { token });

export interface NovoCupom {
  codigo?: string;
  descricao?: string;
  desconto?: { tipo: "percentual" | "valor" | "meses_gratis"; valor: number } | null;
  parceiro?: { nome: string; contato?: string; comissaoPercentual: number } | null;
  limiteDeUsos?: number | null;
  validoAte?: string | null;
}

export const criarCupom = (token: string, dados: NovoCupom) =>
  api<CupomAdmin>("/admin/cupons", { method: "POST", body: dados, token });

export interface EdicaoDeCupom extends NovoCupom {
  /** Obrigatório: vai para a auditoria, como toda ação do painel. */
  motivo: string;
}

/**
 * Edita o cupom. O código NÃO muda.
 *
 * Ele está gravado em cada conta que entrou por aqui; renomear apagaria o
 * histórico de quem tem a receber. Campos ausentes ficam como estão — só
 * `null` explícito remove.
 */
export const editarCupom = (token: string, codigo: string, dados: EdicaoDeCupom) =>
  api<CupomAdmin>(`/admin/cupons/${encodeURIComponent(codigo)}`, {
    method: "PATCH",
    body: dados,
    token,
  });

export const revogarCupom = (token: string, codigo: string, motivo: string) =>
  api<CupomAdmin>(`/admin/cupons/${encodeURIComponent(codigo)}/revogar`, {
    method: "POST",
    body: { motivo },
    token,
  });

export const reativarCupom = (token: string, codigo: string, motivo: string) =>
  api<CupomAdmin>(`/admin/cupons/${encodeURIComponent(codigo)}/reativar`, {
    method: "POST",
    body: { motivo },
    token,
  });
