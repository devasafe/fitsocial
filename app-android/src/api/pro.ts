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
