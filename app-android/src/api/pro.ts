import { apiFetch } from "./client";

// O lado do aluno do RUMO Pro: aceitar o convite de um profissional e
// controlar o que fica aberto para ele.

export type PapelPro = "coach" | "nutri";

export interface Escopo {
  treinos: boolean;
  dieta: boolean;
  medidas: boolean;
  fotos: boolean;
}

export interface ConvitePreview {
  code: string;
  papel: PapelPro;
  profissional: { id: string; nome: string; username: string | null; avatarUrl: string };
  jaVinculado: boolean;
}

export interface Acompanhamento {
  id: string;
  papel: PapelPro;
  escopo: Escopo;
  desde: string;
  profissional: { id: string; nome: string; username: string | null; avatarUrl: string };
}

export function rotuloDoPapel(papel: PapelPro): string {
  return papel === "coach" ? "treinador" : "nutricionista";
}

/** O que cada parte do escopo abre, dito para quem vai decidir. */
export const O_QUE_ABRE: { chave: keyof Escopo; titulo: string; explica: string }[] = [
  {
    chave: "treinos",
    titulo: "Meus treinos",
    explica: "Tudo que você registra: exercícios, cargas, frequência e recordes.",
  },
  {
    chave: "dieta",
    titulo: "Minha alimentação",
    explica: "O que você anota no diário e a dieta do seu plano.",
  },
  {
    chave: "medidas",
    titulo: "Peso e medidas",
    explica: "Seus números de corpo ao longo do tempo.",
  },
  {
    chave: "fotos",
    titulo: "Fotos de evolução",
    explica: "As fotos que você tirar para acompanhar mudanças no corpo.",
  },
];

export interface ConviteRecebido {
  code: string;
  papel: PapelPro;
  expiraEm: string;
  profissional: { id: string; nome: string; username: string | null; avatarUrl: string };
}

/**
 * Os convites que mandaram para mim e que ainda valem.
 *
 * A notificação avisa na hora; esta lista é onde o convite continua existindo
 * depois — inclusive dias depois, se a pessoa tiver deslizado o aviso sem ler.
 */
export async function listarConvitesRecebidos(token: string): Promise<ConviteRecebido[]> {
  const r = await apiFetch<{ data: ConviteRecebido[] }>("/pro/convites-recebidos", { token });
  return r.data;
}

export async function verConvite(token: string, code: string): Promise<ConvitePreview> {
  const r = await apiFetch<{ data: ConvitePreview }>(`/pro/convites/${encodeURIComponent(code)}`, {
    token,
  });
  return r.data;
}

export async function aceitarConvite(
  token: string,
  code: string,
  escopo: Partial<Escopo>
): Promise<{ id: string }> {
  const r = await apiFetch<{ data: { id: string } }>(
    `/pro/convites/${encodeURIComponent(code)}/aceitar`,
    { method: "POST", body: escopo, token }
  );
  return r.data;
}

export async function listarAcompanhamentos(token: string): Promise<Acompanhamento[]> {
  const r = await apiFetch<{ data: Acompanhamento[] }>("/pro/acompanhamentos", { token });
  return r.data;
}

export async function ajustarEscopo(
  token: string,
  id: string,
  escopo: Partial<Escopo>
): Promise<Acompanhamento> {
  const r = await apiFetch<{ data: Acompanhamento }>(`/pro/acompanhamentos/${id}`, {
    method: "PATCH",
    body: escopo,
    token,
  });
  return r.data;
}

export async function encerrarAcompanhamento(token: string, id: string): Promise<void> {
  await apiFetch(`/pro/acompanhamentos/${id}`, { method: "DELETE", token });
}

// ---------------------------------------------------------------- conversa

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

/**
 * As mensagens do acompanhamento, da mais nova para trás.
 *
 * A MESMA rota que o painel do profissional usa: a conversa é uma só, e ter um
 * caminho para cada lado seria duplicar a regra de quem pode ler — que é o
 * tipo de duplicação que acaba discordando de si mesma.
 */
export async function buscarMensagens(
  token: string,
  linkId: string,
  cursor?: string | null
): Promise<{ itens: Mensagem[]; nextCursor: string | null; encerrado: boolean }> {
  const q = new URLSearchParams({ limit: "30" });
  if (cursor) q.set("cursor", cursor);

  const r = await apiFetch<{
    data: Mensagem[];
    meta: { nextCursor: string | null; encerrado: boolean };
  }>(`/pro/acompanhamentos/${linkId}/mensagens?${q}`, { token });

  return { itens: r.data, nextCursor: r.meta.nextCursor, encerrado: r.meta.encerrado };
}

export async function enviarMensagem(
  token: string,
  linkId: string,
  corpo: { texto?: string; imageUrl?: string; imageWidth?: number; imageHeight?: number }
): Promise<Mensagem> {
  const r = await apiFetch<{ data: Mensagem }>(`/pro/acompanhamentos/${linkId}/mensagens`, {
    method: "POST",
    body: corpo,
    token,
  });
  return r.data;
}

/** Quantas não lidas em cada acompanhamento — o ponto ao lado do nome. */
export async function buscarNaoLidas(token: string): Promise<Record<string, number>> {
  const r = await apiFetch<{ data: { link: string; naoLidas: number }[] }>("/pro/nao-lidas", { token });
  return Object.fromEntries(r.data.map((x) => [x.link, x.naoLidas]));
}
