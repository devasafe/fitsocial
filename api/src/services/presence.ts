import type { UserDoc } from "../models/User.js";
import { User } from "../models/User.js";
import { UserDailyActive } from "../models/UserDailyActive.js";
import { chaveDoDia } from "../utils/dia.js";

/** Intervalo mínimo entre duas escritas de presença do mesmo usuário. */
const INTERVALO_MS = 10 * 60 * 1000;

/**
 * Marca que a pessoa usou o app agora.
 *
 * Roda dentro de requireAuth, o caminho mais quente da API — passa em toda
 * requisição de todo usuário. Por isso duas travas:
 *
 * 1. Só escreve se passaram 10 minutos desde a última marcação. Quem está
 *    parado não gera escrita nenhuma; quem está usando gera no máximo 6 por hora.
 * 2. Não é aguardado. A pessoa está esperando a resposta dela, não a nossa
 *    métrica — se a escrita falhar, perder um ponto no gráfico é irrelevante
 *    perto de atrasar (ou derrubar) a requisição.
 */
export function marcarPresenca(user: UserDoc, agora = new Date()): Promise<void> {
  const ultimo = user.lastSeenAt?.getTime() ?? 0;
  if (agora.getTime() - ultimo < INTERVALO_MS) return Promise.resolve();

  // Atualiza o documento em memória para o resto desta requisição não repetir.
  user.lastSeenAt = agora;

  const dia = chaveDoDia(agora);

  // Devolve a promise em vez de descartá-la: o middleware não a aguarda (é
  // métrica, não regra de negócio), mas quem precisa de determinismo — teste,
  // script — consegue esperar. Descartar aqui dentro tornaria a função
  // impossível de testar sem sleep.
  return Promise.all([
    User.updateOne({ _id: user._id }, { $set: { lastSeenAt: agora } }),
    UserDailyActive.updateOne(
      { user: user._id, dia },
      { $setOnInsert: { user: user._id, dia, primeiroAcesso: agora } },
      { upsert: true }
    ),
  ])
    .then(() => undefined)
    .catch(() => {
      // Corrida entre duas requisições simultâneas do mesmo usuário estoura a
      // chave única. É exatamente o resultado desejado: uma marcação por dia.
    });
}
