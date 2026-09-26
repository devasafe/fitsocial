import mongoose from "mongoose";
import { Activity } from "../models/Activity.js";
import { computeStats } from "./adherence.js";
import { enviarPush } from "./push/index.js";

/**
 * O lembrete de sequência em risco.
 *
 * Roda uma vez por noite, disparado de fora (ver `routes/lembretes.ts`): este
 * projeto não tem cron nem worker, e a decisão é antiga e deliberada — está
 * escrita em `services/moderation.ts`. Um agendador externo chamando uma rota
 * mantém isso de pé; um `setInterval` no boot criaria um processo de fundo
 * invisível e mandaria o aviso duplicado no dia em que houvesse duas
 * instâncias.
 *
 * Quem é avisado: só quem tem sequência viva E ainda não treinou hoje. Avisar
 * quem já treinou é o caminho mais curto para a pessoa desligar tudo.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Janela de histórico que entra na conta.
 *
 * A sequência ATUAL só depende dos dias seguidos até hoje, então sessenta dias
 * é folga larga — quem estiver acima disso já está muito além do que este
 * lembrete precisa saber. Carregar as atividades e agrupar em memória segue o
 * que `growthMetrics.ts` já faz, e vale enquanto a base couber com sobra; se um
 * dia não couber, o caminho é agregar por usuário no próprio Mongo.
 */
const JANELA_DIAS = 60;

export interface ResultadoDoLembrete {
  /** Quantas pessoas tinham sequência viva e o dia acabando. */
  candidatos: number;
  /** Para quantas o push realmente saiu (as outras desligaram ou já foram avisadas). */
  avisados: number;
}

export async function avisarSequenciasEmRisco(): Promise<ResultadoDoLembrete> {
  const desde = new Date(Date.now() - JANELA_DIAS * DIA_MS);

  const atividades = await Activity.find(
    { startedAt: { $gte: desde } },
    { user: 1, startedAt: 1 }
  ).lean();

  const porPessoa = new Map<string, Date[]>();
  for (const a of atividades) {
    const k = String(a.user);
    const lista = porPessoa.get(k);
    if (lista) lista.push(a.startedAt as Date);
    else porPessoa.set(k, [a.startedAt as Date]);
  }

  let candidatos = 0;
  let avisados = 0;

  for (const [id, datas] of porPessoa) {
    const s = computeStats(datas.map((date) => ({ date })));
    if (!s.emRisco) continue;
    candidatos++;

    const dias = s.streak === 1 ? "1 dia seguido" : `${s.streak} dias seguidos`;
    // O número precisa estar na mensagem: "não perca sua sequência" sem dizer
    // qual não informa o que está em jogo.
    const entregues = await enviarPush(new mongoose.Types.ObjectId(id), "sequencia_em_risco", {
      title: "Sua sequência está em jogo",
      body: `São ${dias}. Um treino hoje mantém a conta de pé.`,
      data: { tipo: "sequencia" },
    });
    if (entregues > 0) avisados++;
  }

  return { candidatos, avisados };
}
