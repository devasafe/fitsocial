import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/token.js";
import { User, type UserDoc } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { calcularPlan, recomputeTier } from "../services/entitlement.js";
import { assertAccountUsable } from "../services/moderation.js";
import { marcarPresenca } from "../services/presence.js";

// Anexa o usuário autenticado ao request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
      /** Escopo do token apresentado ("admin" só em sessão do painel). */
      tokenScope?: string;
    }
  }
}

/** Exige um Bearer token válido e carrega o usuário no request. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new HttpError(401, "Token de autenticação ausente");
    }

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user) {
      throw new HttpError(401, "Usuário não encontrado");
    }

    // Trocar a senha derruba as sessões antigas.
    //
    // O `?? 0` não é detalhe: tokens emitidos antes deste campo existir não
    // trazem `v`, e o default de tokenVersion é 0. Sem isso, subir esta versão
    // deslogaria todo mundo que já estava usando o app.
    if ((payload.v ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new HttpError(401, "Sua senha mudou. Entre de novo.");
    }

    // Banimento e suspensão valem para tokens JÁ emitidos: o usuário é lido do
    // banco a cada requisição, então o corte é imediato.
    await assertAccountUsable(user);

    // O plano é recalculado aqui, e é isto que faz vencimento acontecer sem
    // cron: `calcularPlan` é função pura sobre o documento que acabamos de
    // carregar, então não custa consulta nenhuma, e compara sempre contra o
    // relógio de agora. Sem isto, uma cortesia (ou uma assinatura) vencida
    // continuava valendo para sempre, porque nada recalculava.
    //
    // Aguardado de propósito: é regra de negócio, não métrica. A requisição
    // que vem a seguir vai decidir permissão com este número.
    await recomputeTier(user);

    // Registra o acesso sem bloquear: é métrica, não regra de negócio. A
    // pessoa está esperando a resposta dela, não a nossa estatística.
    void marcarPresenca(user);

    req.user = user;
    req.tokenScope = payload.scope;
    next();
  } catch (err) {
    // HttpError aqui já traz a mensagem certa (banida, suspensa até tal dia).
    // Engolir em um 401 genérico deixaria a pessoa sem saber o que aconteceu.
    if (err instanceof HttpError) return next(err);
    next(new HttpError(401, "Token inválido ou expirado"));
  }
}

/**
 * Exige plano pago.
 *
 * Responde **402**, e não 403.
 *
 * ATENÇÃO ao que isso significa de verdade: o aplicativo NÃO tem interceptor de
 * 402. O único lugar que lê esse status é o `handleGenerate` da Home — em
 * qualquer outra tela, 402 chega como erro comum. Então 402 aqui não abre
 * paywall sozinho; ele é o status certo pela semântica (pagamento necessário) e
 * é o que a tela nova sabe reconhecer. Quem põe este middleware numa rota
 * PRECISA olhar o que a tela correspondente faz com a falha — senão o
 * resultado é um card que some sem explicação.
 *
 * Este middleware existia desde a Fatia 5 devolvendo 403 e nunca foi usado em
 * rota nenhuma.
 *
 * Lê `calcularPlan`, e não `user.tier` cru. O `tier` é cache; a verdade é a
 * função pura, que compara contra o relógio de agora. Na prática o
 * `requireAuth` acabou de recalcular os dois — mas depender do campo aqui
 * seria depender de uma escrita que pode ter falhado.
 */
export function requirePremium(req: Request, _res: Response, next: NextFunction) {
  const user = req.user;
  if (!user || calcularPlan(user) === "free") {
    return next(new HttpError(402, "Este recurso faz parte do plano Pro."));
  }
  next();
}
