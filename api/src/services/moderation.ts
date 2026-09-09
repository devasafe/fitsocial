import mongoose from "mongoose";
import { User, type UserDoc } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Barra o acesso de conta banida, suspensa ou excluída.
 *
 * Chamado dentro de requireAuth, que já busca o usuário no banco a cada
 * requisição — por isso um JWT de 30 dias já emitido morre na hora em que a
 * conta é banida, sem precisar de lista negra de tokens nem de Redis.
 */
export async function assertAccountUsable(user: UserDoc): Promise<void> {
  if (user.deletedAt) {
    throw new HttpError(401, "Esta conta foi excluída.");
  }

  if (user.status === "banned") {
    throw new HttpError(403, "Sua conta foi banida.");
  }

  if (user.status === "suspended") {
    const ate = user.suspendedUntil;

    // Suspensão sem prazo é banimento com outro nome — trata como bloqueio.
    if (!ate) throw new HttpError(403, "Sua conta está suspensa.");

    if (ate.getTime() > Date.now()) {
      const dia = ate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
      throw new HttpError(403, `Sua conta está suspensa até ${dia}.`);
    }

    // Prazo vencido: a conta se libera aqui, na primeira vez que tenta usar o
    // app. É o que dispensa cron e worker — o projeto não tem nenhum dos dois.
    await liberarSuspensao(user);
  }
}

/** Devolve a conta ao normal quando a suspensão vence. */
async function liberarSuspensao(user: UserDoc): Promise<void> {
  user.status = "active";
  user.suspendedUntil = null;
  user.contentVisible = true;
  user.statusChangedAt = new Date();
  user.statusChangedBy = null; // ninguém liberou: o prazo acabou
  user.statusReason = "suspensão expirada";
  await user.save();

  await User.updateOne({ _id: user._id }, { $set: { contentVisible: true } });
  await definirVisibilidadeDoConteudo(user._id, true);
  invalidarOcultos();
}

/* ------------------------------------------------------------------ */
/* Conteúdo escondido                                                  */
/* ------------------------------------------------------------------ */

// Quem está oculto é raro e muda pouco, mas é consultado em toda leitura de
// feed. Guardar a lista em memória evita um $lookup em cada consulta; o TTL
// curto cobre o caso de outra instância da API ter banido alguém.
//
// ATENÇÃO: com mais de uma instância no ar, este TTL vira o atraso real da
// propagação de um banimento. É o gatilho para entrar Redis (ver ARQUITETURA §6).
const TTL_MS = 60_000;
let cache: { ids: mongoose.Types.ObjectId[]; em: number } | null = null;

export function invalidarOcultos(): void {
  cache = null;
}

/** Ids de quem está com o conteúdo escondido. */
export async function idsOcultos(): Promise<mongoose.Types.ObjectId[]> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.ids;
  const docs = await User.find({ contentVisible: false }).select("_id").lean();
  cache = { ids: docs.map((d) => d._id), em: Date.now() };
  return cache.ids;
}

/** Filtro pronto para somar às queries de feed: `author: { $nin: [...] }`. */
export async function filtroAutorVisivel(): Promise<{ $nin: mongoose.Types.ObjectId[] } | null> {
  const ids = await idsOcultos();
  return ids.length ? { $nin: ids } : null;
}

/** Marca (ou desmarca) o conteúdo de um usuário como escondido.
 *  Nada é apagado: desfazer devolve os mesmos documentos. */
export async function definirVisibilidadeDoConteudo(
  userId: mongoose.Types.ObjectId,
  visivel: boolean
): Promise<void> {
  const { Post } = await import("../models/Post.js");
  const { Comment } = await import("../models/Comment.js");
  await Promise.all([
    Post.updateMany({ author: userId }, { $set: { hidden: !visivel } }),
    Comment.updateMany({ author: userId }, { $set: { hidden: !visivel } }),
  ]);
}
