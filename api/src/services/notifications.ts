import mongoose from "mongoose";
import { Notification, type NotificationType } from "../models/Notification.js";
import { User } from "../models/User.js";

/**
 * Enquanto a linha continua não lida e recebeu algo nas últimas 24h, o assunto
 * é o mesmo e tudo cai nela.
 *
 * A janela por tempo existe para o caso do post que continua rendendo curtida
 * uma semana depois: aquilo já é outro momento, e merece voltar a chamar
 * atenção. Já a leitura fecha o assunto — depois que a pessoa viu, a curtida
 * seguinte é notícia de novo.
 */
const JANELA_DE_AGRUPAMENTO_MS = 24 * 60 * 60 * 1000;

/** Qual chave das preferências manda em cada tipo. */
const PREFERENCIA: Record<NotificationType, "interacoes" | "desafios" | "sistema" | "sempre"> = {
  like: "interacoes",
  comment: "interacoes",
  follow: "interacoes",
  challenge_join: "desafios",
  denuncia_resolvida: "sistema",
  // Sem opção de desligar, de propósito: seu conteúdo saiu do ar, e você
  // precisa saber disso mesmo com tudo silenciado. Não é divulgação, é aviso.
  post_removido: "sempre",
  // Também sem opção, e pelo mesmo motivo: um convite PEDE resposta. Silenciado,
  // ele vira um profissional esperando indefinidamente por alguém que nunca
  // soube que foi convidado. E não há risco de virar ruído — o teto é de dez
  // alunos, e um convite endereçado só existe depois que alguém digitou o @.
  convite_pro: "sempre",
};

interface Preferencias {
  novosPosts?: boolean;
  interacoes?: boolean;
  desafios?: boolean;
  sistema?: boolean;
}

/** Lê as preferências de quem vai receber. O padrão é receber. */
export async function preferenciasDe(userId: mongoose.Types.ObjectId): Promise<Preferencias> {
  const dono = await User.findById(userId).select("settings.notificacoes").lean();
  const prefs = (dono?.settings as { notificacoes?: Preferencias } | null)?.notificacoes;
  return prefs ?? {};
}

export function aceita(prefs: Preferencias, tipo: NotificationType): boolean {
  const chave = PREFERENCIA[tipo];
  if (chave === "sempre") return true;
  return prefs[chave] !== false;
}

/** "Ana" · "Ana e mais 1" · "Ana e mais 4" — sempre com um nome na frente. */
function quem(nome: string, total: number): string {
  return total <= 1 ? nome : `${nome} e mais ${total - 1}`;
}

function frase(tipo: NotificationType, nome: string, total: number): string {
  const sujeito = quem(nome, total);
  const plural = total > 1;
  switch (tipo) {
    case "like":
      return `${sujeito} ${plural ? "curtiram" : "curtiu"} seu post`;
    case "comment":
      return `${sujeito} ${plural ? "comentaram" : "comentou"} no seu post`;
    case "follow":
      return `${sujeito} ${plural ? "começaram" : "começou"} a te seguir`;
    default:
      return sujeito;
  }
}

/** O texto de fora vira o texto final, recomposto quando o assunto agrupa. */
function textoDeFora(
  texto: NovaNotificacao["text"],
  nome: string,
  total: number
): string | undefined {
  if (typeof texto === "function") return texto(quem(nome, total), total);
  return texto;
}

export interface NovaNotificacao {
  userId: mongoose.Types.ObjectId; // destinatário
  actorId?: mongoose.Types.ObjectId; // quem gerou (ausente = moderação)
  actorName?: string;
  type: NotificationType;
  /** Texto próprio, quando a frase padrão não serve.
   *
   *  String para avisos do sistema, que não agrupam. Função para o que agrupa e
   *  precisa carregar um detalhe — o nome do desafio, por exemplo: sem ela, a
   *  segunda pessoa a entrar sobrescreveria a linha com o nome dela sozinha, e
   *  o "e mais 2" se perderia. */
  text?: string | ((quem: string, total: number) => string);
  targetKind?: string;
  targetId?: mongoose.Types.ObjectId;
}

/**
 * Cria ou atualiza uma notificação in-app.
 *
 * Três travas contra virar spam, em ordem de importância:
 * 1. a preferência é conferida ANTES de gravar — desligar o aviso não pode
 *    significar "continua acumulando, só não mostra";
 * 2. o mesmo assunto atualiza a linha existente em vez de criar outra;
 * 3. ninguém é notificado da própria ação.
 *
 * Nunca derruba a ação principal: notificação é acessório do que aconteceu.
 * Devolve se algo foi de fato gravado.
 */
export async function createNotification(params: NovaNotificacao): Promise<boolean> {
  const { userId, actorId, type } = params;
  if (actorId && userId.equals(actorId)) return false;

  try {
    if (!aceita(await preferenciasDe(userId), type)) return false;

    const groupKey = params.targetId ? `${type}:${params.targetKind ?? ""}:${params.targetId}` : "";
    const nome = params.actorName ?? "";

    if (groupKey && actorId) {
      const desde = new Date(Date.now() - JANELA_DE_AGRUPAMENTO_MS);
      const aberta = await Notification.findOne({
        user: userId,
        groupKey,
        read: false,
        updatedAt: { $gte: desde },
      });

      if (aberta) {
        // Só conta gente nova: a mesma pessoa comentando três vezes é uma
        // pessoa, e "3 pessoas comentaram" seria mentira.
        const jaEsta = aberta.actors.some((a) => a.equals(actorId));
        if (!jaEsta) aberta.actors.push(actorId);
        aberta.actor = actorId;
        const total = aberta.actors.length;
        aberta.text = textoDeFora(params.text, nome, total) ?? frase(type, nome, total);
        // `updatedAt` sobe sozinho no save, e é por ele que a lista ordena:
        // um assunto que acabou de receber algo volta para o topo.
        await aberta.save();
        return true;
      }
    }

    await Notification.create({
      user: userId,
      actor: actorId ?? null,
      type,
      text: textoDeFora(params.text, nome, 1) ?? frase(type, nome, 1),
      targetKind: params.targetKind ?? "",
      targetId: params.targetId,
      groupKey,
      actors: actorId ? [actorId] : [],
    });
    return true;
  } catch {
    /* notificação é best-effort */
    return false;
  }
}

/** Vários destinatários do mesmo aviso — usado quando uma denúncia é decidida. */
export async function notificarVarios(
  userIds: mongoose.Types.ObjectId[],
  base: Omit<NovaNotificacao, "userId">
): Promise<number> {
  const unicos = [...new Map(userIds.map((id) => [id.toString(), id])).values()];
  const resultados = await Promise.all(
    unicos.map((userId) => createNotification({ ...base, userId }))
  );
  return resultados.filter(Boolean).length;
}
