import { apiFetch } from "./client";

export interface AlvoDiario {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Os totais são `null` no dia em que não houve registro — nunca zero. */
export interface DiaDeNutricao {
  dia: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  registros: number;
  alvo: AlvoDiario | null;
}

export interface EvolucaoDeNutricao {
  dias: DiaDeNutricao[];
  resumo: {
    diasComRegistro: number;
    diasNaJanela: number;
    mediaKcal: number | null;
    diasDentroDoAlvo: number;
  };
}

export async function buscarEvolucaoDeNutricao(token: string, dias: number) {
  return apiFetch<{
    data: EvolucaoDeNutricao;
    meta: { dias: number; diasPedidos?: number; limitadoPor?: "plano" };
  }>(`/nutrition/evolucao?dias=${dias}`, { token });
}
