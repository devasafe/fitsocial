import { Router } from "express";
import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { User, publicUser } from "../models/User.js";
import {
  Assinatura,
  PROVEDORES,
  type AssinaturaDoc,
  type Provedor,
} from "../models/Assinatura.js";
import { aplicarEventoDeCompra, recomputeTier } from "../services/entitlement.js";
import {
  CATALOGO,
  CICLOS,
  PRODUTOS,
  emReais,
  itemDoCatalogo,
} from "../services/pagamentos/catalogo.js";
import {
  cancelarAssinatura,
  iniciarAssinatura,
  processarWebhook,
} from "../services/pagamentos/assinaturas.js";

export const billingRouter = Router();

/**
 * O webhook dos provedores novos, com o corpo CRU.
 *
 * Montado num router à parte e com `express.raw` porque `app.ts` aplica
 * `express.json()` globalmente: verificação de assinatura é calculada sobre os
 * bytes exatos, e `JSON.parse` seguido de re-serialização muda espaçamento e
 * ordem de chave. Se isso for descoberto depois, TODO evento assinado falha na
 * verificação e ninguém entende por quê.
 *
 * Por isso ele é exportado separado e montado ANTES do parser global.
 */
export const webhookRouter = Router();

webhookRouter.post(
  "/billing/webhook/:provedor",
  express.raw({ type: "*/*", limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const nome = String(req.params.provedor);
    if (!(PROVEDORES as readonly string[]).includes(nome)) {
      // 404 e não 400: um provedor que não existe não deve nem confirmar que a
      // rota existe para quem estiver varrendo.
      throw new HttpError(404, "Provedor desconhecido.");
    }

    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));
    const r = await processarWebhook(nome as Provedor, req.headers as Record<string, unknown>, corpo);

    if (!r.aceito) {
      // 401 para quem não provou ser o gateway. O provedor reenvia, e é isso
      // que a gente quer quando o segredo estiver errado — melhor reenviar do
      // que perder o evento em silêncio.
      throw new HttpError(401, "Webhook não autenticado.");
    }

    // 200 sempre que o evento foi aceito, mesmo quando ignorado: o gateway lê
    // qualquer outra coisa como falha e reenvia em laço.
    res.json({ received: true });
  })
);

// Tipos de evento do RevenueCat que indicam assinatura ATIVA vs perdida.
const ACTIVE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
]);
const INACTIVE_EVENTS = new Set(["EXPIRATION", "BILLING_ISSUE"]);

/**
 * Webhook do RevenueCat. Configure o RevenueCat para usar o _id do usuário como
 * app_user_id; aqui atualizamos o tier conforme o evento. Este é o ponto de
 * integração real da assinatura.
 */
billingRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    // Se um segredo estiver configurado, exige-o no header Authorization.
    if (env.revenuecatWebhookAuth) {
      if (req.headers.authorization !== env.revenuecatWebhookAuth) {
        throw new HttpError(401, "Webhook não autorizado");
      }
    }

    const event = req.body?.event ?? {};
    const appUserId: string | undefined = event.app_user_id;
    const type: string | undefined = event.type;

    if (appUserId && mongoose.isValidObjectId(appUserId) && type) {
      let tier: "free" | "premium" | null = null;
      if (ACTIVE_EVENTS.has(type)) tier = "premium";
      else if (INACTIVE_EVENTS.has(type)) tier = "free";

      if (tier) {
        // Não escreve `tier` direto: a camada de precedência decide, para um
        // EXPIRATION da loja não derrubar uma cortesia dada pelo painel.
        await aplicarEventoDeCompra(appUserId, tier === "premium");
      }
    }

    // Webhooks devem receber 200 para não sofrerem re-tentativas.
    res.json({ received: true });
  })
);

/**
 * Upgrade de DESENVOLVIMENTO: promove o usuário a premium sem passar pela loja.
 * Serve para testar o fluxo freemium ponta a ponta. Bloqueado em produção.
 */
billingRouter.post(
  "/dev-upgrade",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (env.isProd) {
      throw new HttpError(403, "Indisponível em produção");
    }
    const user = req.user!;

    // Passa pelo MESMO caminho da cortesia do admin, e não escreve `tier`
    // direto. Desde que `recomputeTier` roda no `requireAuth`, um `tier`
    // escrito à mão é recalculado e desfeito na requisição seguinte — o botão
    // pareceria não funcionar, e levaria meia hora para alguém entender por quê.
    const jaTem = user.premiumSource === "admin";
    user.set("premiumSource", jaTem ? null : "admin");
    user.set("premiumUntil", null);
    await user.save();
    await recomputeTier(user);

    res.json({ user: publicUser(user) });
  })
);

// ----------------------------------------------------------------- catálogo

/** O que está à venda. Preço vem do servidor, nunca escrito na tela. */
billingRouter.get("/produtos", (_req, res) => {
  res.json({
    data: PRODUTOS.map((p) => {
      const item = CATALOGO[p];
      const economia = Math.max(0, item.precoCentavos.mensal * 12 - item.precoCentavos.anual);
      return {
        produto: item.produto,
        nome: item.nome,
        resumo: item.resumo,
        beneficios: item.beneficios,
        precoCentavos: item.precoCentavos,
        // Quanto o anual economiza, calculado aqui e não na tela: é a mesma
        // regra do preço — conta feita no aplicativo fica congelada na versão
        // instalada e passa a mentir quando o catálogo muda.
        economiaAnualCentavos: economia,
        // Quantas mensalidades o anual economiza, arredondado para baixo. É o
        // "3 meses grátis" da tela — calculado, para não virar mentira no dia
        // em que alguém mexer no preço e esquecer do texto.
        mesesGratisNoAnual: Math.floor(economia / item.precoCentavos.mensal),
        precoFormatado: {
          mensal: emReais(item.precoCentavos.mensal),
          anual: emReais(item.precoCentavos.anual),
        },
        limiteDeAlunos: item.limiteDeAlunos,
      };
    }),
    meta: {},
  });
});

// ---------------------------------------------------------------- checkout

const checkoutSchema = z.object({
  produto: z.enum(PRODUTOS),
  ciclo: z.enum(CICLOS),
});

/**
 * Abre o pagamento e devolve para onde mandar a pessoa.
 *
 * Rate limit baixo: cada chamada cria um cliente e uma assinatura no gateway.
 * Sem teto, um laço na tela enche a conta do Asaas de lixo.
 */
billingRouter.post(
  "/checkout",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 5, name: "checkout" }),
  asyncHandler(async (req, res) => {
    const { produto, ciclo } = checkoutSchema.parse(req.body);
    const { assinatura, urlDeCheckout } = await iniciarAssinatura(req.user!, produto, ciclo);

    res.status(201).json({
      data: {
        assinatura: assinatura._id.toString(),
        produto,
        ciclo,
        valorCentavos: assinatura.precoCentavos,
        urlDeCheckout,
      },
      meta: {},
    });
  })
);

/** O formato que a tela de assinatura lê. Um lugar só, para as duas rotas. */
function comoAssinatura(a: AssinaturaDoc) {
  return {
    id: a._id.toString(),
    produto: a.produto,
    nome: itemDoCatalogo(a.produto)?.nome ?? a.produto,
    ciclo: a.ciclo,
    status: a.status,
    valorCentavos: a.precoCentavos,
    valorFormatado: emReais(a.precoCentavos),
    validoAte: a.validoAte ?? null,
    renovaEm: a.renovaEm ?? null,
    // Cancelar não tira o acesso na hora: quem cancelou comprou aquele ciclo,
    // e ele vale até o fim.
    cancelaNoFimDoCiclo: a.cancelaNoFimDoCiclo,
  };
}

/** A assinatura corrente desta pessoa, se houver. */
billingRouter.get(
  "/assinatura",
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = await Assinatura.findOne({
      user: req.user!._id,
      status: { $in: ["ativa", "inadimplente", "cancelada"] },
    }).sort({ createdAt: -1 });

    res.json({ data: a ? comoAssinatura(a) : null, meta: {} });
  })
);

/**
 * Cancelar a renovação.
 *
 * Existe junto com o botão de assinar, e não depois: publicar um caminho de
 * entrada sem caminho de saída é entregar uma armadilha — a pessoa põe o cartão
 * e só consegue tirar falando com alguém.
 *
 * NÃO pede senha, ao contrário de excluir a conta (`auth.ts`), e a diferença é
 * deliberada: excluir apaga dados para sempre, cancelar não tira nada de
 * ninguém — o acesso segue até o fim do ciclo já pago e dá para assinar de novo
 * no mesmo minuto. Cancelar tem de ser tão fácil quanto contratar; pedir senha
 * aqui seria fricção do lado errado.
 */
billingRouter.delete(
  "/assinatura",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 5, name: "cancelar-assinatura" }),
  asyncHandler(async (req, res) => {
    const a = await cancelarAssinatura(req.user!);
    res.json({ data: comoAssinatura(a), meta: {} });
  })
);
