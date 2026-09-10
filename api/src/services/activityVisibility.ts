import mongoose from "mongoose";
import { User, type UserDoc } from "../models/User.js";
import { Follow } from "../models/Follow.js";

// Quem pode ver o treino de quem. Uma regra só, num lugar só — espalhar isso
// pelas rotas é como um treino acaba visível onde não devia.

/** Visibilidade que uma atividade nova recebe, conforme a escolha da pessoa.
 *
 *  Enquanto `activitiesPublic` for null (ninguém decidiu ainda), vale o
 *  comportamento antigo: nada fica público por omissão. */
export function visibilidadeParaNovaAtividade(user: UserDoc): "public" | "followers" {
  return user.settings?.activitiesPublic === true ? "public" : "followers";
}

/** Filtro da VITRINE: quais atividades de `dono` aparecem listadas no perfil
 *  dele para `espectador`.
 *
 *  Exige a preferência ligada — é isto que impede treino de aparecer no perfil
 *  de quem nunca decidiu mostrar. Abrir um treino específico por link é outra
 *  regra, em `podeVerAtividade`. */
export async function filtroDeAtividadesVisiveis(
  donoId: mongoose.Types.ObjectId,
  espectadorId: mongoose.Types.ObjectId
): Promise<mongoose.FilterQuery<unknown>> {
  const base = { user: donoId };

  if (donoId.equals(espectadorId)) return base;

  const dono = await User.findById(donoId).select("settings");
  // Quem não decidiu, ou decidiu que não, não expõe treino nenhum.
  if (dono?.settings?.activitiesPublic !== true) {
    return { ...base, _id: null }; // filtro que não casa com nada
  }

  const segue = await Follow.exists({ follower: espectadorId, following: donoId });
  return {
    ...base,
    visibility: segue ? { $in: ["public", "followers"] } : "public",
  };
}

/**
 * Uma atividade pode ser ABERTA por este espectador?
 *
 * Aqui vale a visibilidade da própria atividade, não a preferência de perfil.
 * São controles diferentes de propósito:
 *
 *   settings.activitiesPublic  → a vitrine: meus treinos aparecem no meu perfil
 *   Activity.visibility        → o item: quem consegue abrir este treino
 *
 * Quem marcou um treino específico como público escolheu mostrar aquele treino.
 * Bloquear por causa da preferência de vitrine seria ignorar o que a pessoa
 * pediu — e quebraria links de treinos já compartilhados.
 */
export async function podeVerAtividade(
  atividade: { user: mongoose.Types.ObjectId; visibility?: string | null },
  espectadorId: mongoose.Types.ObjectId
): Promise<boolean> {
  if (atividade.user.equals(espectadorId)) return true;
  if (atividade.visibility === "public") return true;
  if (atividade.visibility === "followers") {
    return Boolean(await Follow.exists({ follower: espectadorId, following: atividade.user }));
  }
  return false;
}

/** O traçado de GPS sai do payload quando o dono não o tornou público.
 *
 *  Distância, tempo e ritmo continuam; só o caminho some. Devolve uma cópia —
 *  mexer no documento carregado arriscaria persistir a versão podada. */
export async function podarRotaSePrivada<T extends Record<string, unknown>>(
  payload: T,
  donoId: mongoose.Types.ObjectId,
  espectadorId: mongoose.Types.ObjectId
): Promise<T> {
  if (donoId.equals(espectadorId)) return payload;

  const dono = await User.findById(donoId).select("settings");
  if (dono?.settings?.routesPublic === true) return payload;

  const { points, polyline, ...resto } = payload as Record<string, unknown>;
  void points;
  void polyline;
  return resto as T;
}
