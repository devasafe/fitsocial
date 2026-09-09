import mongoose from "mongoose";
import { AiUsage } from "../models/AiUsage.js";
import { env } from "../config/env.js";
import { setAiTelemetrySink, type AiCallRecord } from "./ai/telemetry.js";
import { agruparPorDia, FUSO } from "../utils/dia.js";

/** Liga a telemetria da IA ao banco. Chamado uma vez, no boot da API.
 *  Fora daqui a camada de IA continua sem saber que Mongo existe. */
export function installAiTelemetry(): void {
  setAiTelemetrySink(persistAiUsage);
}

/** Grava o registro sem bloquear a resposta em curso. Se o insert falhar, a
 *  chamada de IA que o usuário pediu já foi respondida — perder a métrica é
 *  bem menos grave do que derrubar o pedido dele. */
function persistAiUsage(record: AiCallRecord): void {
  void AiUsage.create({
    provider: record.provider,
    model: record.model,
    keyLabel: record.keyLabel,
    keyFingerprint: record.keyFingerprint ?? "",
    chainIndex: record.chainIndex,
    feature: record.feature,
    user: record.userId && mongoose.isValidObjectId(record.userId) ? record.userId : undefined,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    totalTokens: record.totalTokens,
    latencyMs: record.latencyMs,
    ok: record.ok,
    errorKind: record.errorKind ?? null,
  }).catch((err: Error) => {
    console.warn(`[ai] não consegui gravar a telemetria: ${err.message}`);
  });
}

export interface UsagePorChave {
  keyLabel: string;
  provider: string;
  chamadas: number;
  falhas: number;
  tokens: number;
  /** Teto diário configurado em AI_DAILY_LIMITS; null quando não há. */
  limiteDiario: number | null;
}

export interface UsagePorDia {
  dia: string; // yyyy-mm-dd (UTC)
  chamadas: number;
  falhas: number;
  tokens: number;
}

/** Consumo agregado por chave no período — é o que responde "qual chave está
 *  perto de estourar". Sem `desde`, considera o dia corrente em UTC. */
export async function usagePorChave(desde: Date = inicioDoDiaUTC()): Promise<UsagePorChave[]> {
  const linhas = await AiUsage.aggregate<{
    _id: { keyLabel: string; provider: string };
    chamadas: number;
    falhas: number;
    tokens: number;
  }>([
    { $match: { createdAt: { $gte: desde } } },
    {
      $group: {
        _id: { keyLabel: "$keyLabel", provider: "$provider" },
        chamadas: { $sum: 1 },
        falhas: { $sum: { $cond: ["$ok", 0, 1] } },
        tokens: { $sum: "$totalTokens" },
      },
    },
    { $sort: { "_id.keyLabel": 1 } },
  ]);

  return linhas.map((l) => ({
    keyLabel: l._id.keyLabel,
    provider: l._id.provider,
    chamadas: l.chamadas,
    falhas: l.falhas,
    tokens: l.tokens,
    limiteDiario: env.aiDailyLimits[l._id.keyLabel] ?? null,
  }));
}

/** Série diária para o gráfico do painel. */
export async function usagePorDia(dias = 30): Promise<UsagePorDia[]> {
  const desde = new Date(inicioDoDiaUTC().getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
  const linhas = await AiUsage.aggregate<{
    _id: string;
    chamadas: number;
    falhas: number;
    tokens: number;
  }>([
    { $match: { createdAt: { $gte: desde } } },
    {
      $group: {
        // Mesmo fuso do dashboard: dois gráficos no mesmo painel não podem
        // cortar o dia em horas diferentes.
        _id: agruparPorDia("createdAt"),
        chamadas: { $sum: 1 },
        falhas: { $sum: { $cond: ["$ok", 0, 1] } },
        tokens: { $sum: "$totalTokens" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return linhas.map((l) => ({ dia: l._id, chamadas: l.chamadas, falhas: l.falhas, tokens: l.tokens }));
}

/** Começo do dia de hoje em São Paulo, expresso no instante UTC correspondente.
 *  Datas são UTC no banco (convenção do CLAUDE.md); a borda converte. */
function inicioDoDiaUTC(): Date {
  const agora = new Date();
  const hojeSP = agora.toLocaleDateString("en-CA", { timeZone: FUSO });
  // -03:00 é o offset de São Paulo (o país não usa mais horário de verão).
  return new Date(`${hojeSP}T00:00:00-03:00`);
}
