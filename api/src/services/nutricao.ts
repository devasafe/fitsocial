import mongoose from "mongoose";
import { Plan } from "../models/Plan.js";
import { FoodLog } from "../models/FoodLog.js";
import { chaveDoDia, ultimosDias } from "../utils/dia.js";

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
 * O alvo de um dia é o da última versão COM DIETA criada até o fim daquele dia
 * — comparar o passado inteiro contra a meta de hoje faria uma troca de dieta
 * pintar de vermelho dias que foram acertos.
 *
 * LIMITE CONHECIDO: DUAS rotas editam a dieta NO LUGAR, sem criar versão, e o
 * histórico de meta que este cálculo lê não registra nenhuma delas:
 *
 *   - `PUT /plans/current` — edição manual do plano;
 *   - `POST /plans/diet` (`routes/plans.ts`) — quando já existe plano, ele faz
 *     `atual.diet = ...; atual.save()`. É o caminho MAIS USADO para passar a
 *     ter dieta, e o mais silencioso: nem a versão sobe, nem o `createdAt` do
 *     documento muda.
 *
 * A consequência concreta é o `createdAt` mentir sobre desde quando a meta
 * existe. Um plano só de treino criado em 01/06 que ganha dieta em 14/09
 * continua com `createdAt` de 01/06, então o alvo de hoje passa a ser atribuído
 * a junho, julho e agosto inteiros — dias em que não havia dieta nenhuma, e que
 * aparecem julgados contra uma meta que ninguém tinha.
 *
 * Fazer `/plans/diet` versionar mexe em `planLink.planVersion` e no lock
 * otimista de `PUT /plans/current/agenda`: é decisão de produto, e está com o
 * dono. Até lá, o limite fica documentado aqui em vez de escondido.
 */
export async function alvosPorDia(
  userId: mongoose.Types.ObjectId,
  dias: string[]
): Promise<Map<string, AlvoDiario | null>> {
  const planos = await Plan.find({ user: userId, diet: { $ne: null } })
    .select("diet createdAt")
    // Ordena por `version`, e não por `createdAt`: os índices de `Plan` são
    // { user } e { user, version }, então `createdAt` obrigaria a ordenar em
    // memória. `version` é monotônico com `createdAt` — os cinco caminhos que
    // criam plano fazem `(atual?.version ?? 0) + 1`. Quem define `desde`
    // continua sendo o `createdAt`; só a ORDEM de leitura mudou.
    .sort({ version: 1 })
    .lean();

  // Um par (dia em que passou a valer, alvo), já no fuso de São Paulo — o mesmo
  // fuso em que `FoodLog.date` é gravado, senão os dois desalinham na virada.
  const trocas = planos.map((p) => ({
    // Plano sem `createdAt` (documento anterior ao `timestamps`, ou inserido
    // por script/driver cru) vale DESDE SEMPRE. O padrão de `chaveDoDia` é
    // `new Date()`: sem esta guarda, o plano passaria a valer "a partir de
    // hoje", a janela inteira voltaria com `alvo: null` e a tela diria "0 dias
    // dentro da meta" para quem registrou trinta — sem erro e sem log. Entre os
    // dois erros possíveis, atribuir a meta a dias demais é o lado seguro.
    desde: p.createdAt ? chaveDoDia(p.createdAt as Date) : "0000-00-00",
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

/** Um dia da janela. Os totais são `null` quando não houve registro nenhum. */
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
    /** Média só dos dias COM registro. A tela nunca a mostra sozinha. */
    mediaKcal: number | null;
    diasDentroDoAlvo: number;
  };
}

/** Quanto o consumo pode se afastar do alvo e ainda contar como acerto. */
const TOLERANCIA = 0.1;

/**
 * A aderência da pessoa ao longo da janela.
 *
 * Quem monta o buraco é o servidor, e não a tela: senão cada cliente inventa a
 * própria regra para o dia vazio, e o APK instalado inventaria uma diferente do
 * painel do nutricionista.
 */
export async function evolucaoDeNutricao(
  userId: mongoose.Types.ObjectId,
  dias: number
): Promise<EvolucaoDeNutricao> {
  const datas = ultimosDias(dias);

  // `date` é string yyyy-mm-dd, então a comparação lexicográfica é a cronológica
  // — e o índice { user, date } atende este $match direto.
  const linhas = await FoodLog.aggregate<{
    _id: string; kcal: number; proteinG: number; carbsG: number; fatG: number; registros: number;
  }>([
    { $match: { user: userId, date: { $gte: datas[0], $lte: datas[datas.length - 1] } } },
    {
      $group: {
        _id: "$date",
        kcal: { $sum: "$kcal" },
        proteinG: { $sum: "$proteinG" },
        carbsG: { $sum: "$carbsG" },
        fatG: { $sum: "$fatG" },
        registros: { $sum: 1 },
      },
    },
  ]);

  const porDia = new Map(linhas.map((l) => [l._id, l]));
  const alvos = await alvosPorDia(userId, datas);

  const serie: DiaDeNutricao[] = datas.map((dia) => {
    const l = porDia.get(dia);
    const alvo = alvos.get(dia) ?? null;
    if (!l) {
      return { dia, kcal: null, proteinG: null, carbsG: null, fatG: null, registros: 0, alvo };
    }
    return {
      dia,
      kcal: l.kcal,
      proteinG: l.proteinG,
      carbsG: l.carbsG,
      fatG: l.fatG,
      registros: l.registros,
      alvo,
    };
  });

  const comRegistro = serie.filter((d) => d.kcal !== null);
  const dentro = comRegistro.filter(
    (d) => d.alvo && Math.abs(d.kcal! - d.alvo.kcal) <= d.alvo.kcal * TOLERANCIA
  );

  return {
    dias: serie,
    resumo: {
      diasComRegistro: comRegistro.length,
      diasNaJanela: datas.length,
      mediaKcal: comRegistro.length
        ? Math.round(comRegistro.reduce((s, d) => s + d.kcal!, 0) / comRegistro.length)
        : null,
      diasDentroDoAlvo: dentro.length,
    },
  };
}
