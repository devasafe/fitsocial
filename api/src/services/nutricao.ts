import mongoose from "mongoose";
import { Plan } from "../models/Plan.js";
import { chaveDoDia } from "../utils/dia.js";

/** A meta de um dia. Macros em inglês, como o resto do domínio de nutrição. */
export interface AlvoDiario {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

interface DietaDoPlano {
  dailyCalories?: number;
  macros?: { proteinG?: number; carbsG?: number; fatG?: number };
}

/**
 * Qual meta valia em cada dia pedido.
 *
 * O `Plan` é versionado: cada geração, reajuste, importação ou prescrição cria
 * uma versão nova. O alvo de um dia é o da última versão COM DIETA criada até o
 * fim daquele dia — comparar o passado inteiro contra a meta de hoje faria uma
 * troca de dieta pintar de vermelho dias que foram acertos.
 *
 * LIMITE CONHECIDO: `PUT /plans/current` edita a dieta NO LUGAR, sem criar
 * versão. Uma edição manual sobrescreve a meta histórica, e não há como
 * recuperá-la. Quando a prescrição de dieta do nutricionista for construída
 * (frente 3), ela precisa criar versão, como a de treino já faz.
 */
export async function alvosPorDia(
  userId: mongoose.Types.ObjectId,
  dias: string[]
): Promise<Map<string, AlvoDiario | null>> {
  const planos = await Plan.find({ user: userId, diet: { $ne: null } })
    .select("diet createdAt")
    .sort({ createdAt: 1 })
    .lean();

  // Um par (dia em que passou a valer, alvo), já no fuso de São Paulo — o mesmo
  // fuso em que `FoodLog.date` é gravado, senão os dois desalinham na virada.
  const trocas = planos.map((p) => ({
    desde: chaveDoDia(p.createdAt as Date),
    alvo: alvoDe(p.diet as DietaDoPlano | null),
  }));

  const mapa = new Map<string, AlvoDiario | null>();
  for (const dia of dias) {
    let vigente: AlvoDiario | null = null;
    // As trocas estão em ordem; a última que já tinha começado é a que vale.
    for (const t of trocas) {
      if (t.desde <= dia) vigente = t.alvo;
      else break;
    }
    mapa.set(dia, vigente);
  }
  return mapa;
}

function alvoDe(diet: DietaDoPlano | null): AlvoDiario | null {
  if (!diet?.dailyCalories) return null;
  return {
    kcal: diet.dailyCalories,
    proteinG: diet.macros?.proteinG ?? 0,
    carbsG: diet.macros?.carbsG ?? 0,
    fatG: diet.macros?.fatG ?? 0,
  };
}
