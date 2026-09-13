import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";

// Carimba a ORIGEM do premium de quem tem `tier: "premium"` e nenhuma.
//
// O primeiro webhook do RevenueCat que foi para produção fazia
// `User.updateOne({_id}, { tier })` e mais nada. Quem comprou naquela época tem
// `tier: "premium"`, `premiumSource: null` e nenhum `plan` — não há no
// documento nada que explique por que aquela pessoa é premium.
//
// `calcularPlan` tem um ramo de legado que trata esse caso como compra, para
// não rebaixar ninguém. Este script existe para tornar o ramo desnecessário:
// depois que ele rodar, a origem está escrita, e o ramo pode sair do motor.
//
//     npm run direitos:diagnostico     (só lê, diz quantos seriam afetados)
//     npm run direitos:backfill
//     npm run direitos:backfill:rollback
//
// Idempotente: rodar duas vezes não muda nada na segunda.

/** Quem o backfill pega: premium, sem origem, e sem plano gravado. */
const ALVO: mongoose.FilterQuery<unknown> = {
  tier: "premium",
  $or: [{ premiumSource: null }, { premiumSource: { $exists: false } }],
};

export async function backfillDireitos(): Promise<{ encontrados: number; alterados: number }> {
  const encontrados = await User.countDocuments(ALVO);

  const r = await User.updateMany(ALVO, {
    $set: {
      // "purchase" e não "admin": a origem mais provável é o webhook antigo da
      // loja, e marcar como cortesia daria ao admin o poder de revogar — o que
      // `revogarPremium` recusaria fazer numa compra de verdade.
      premiumSource: "purchase",
      plan: "pro",
    },
  });

  return { encontrados, alterados: r.modifiedCount };
}

/**
 * Desfaz, e só o que este script fez.
 *
 * O filtro do rollback é `premiumSource: "purchase"` SEM `premiumUntil` e SEM
 * assinatura — a assinatura de verdade, quando existir, terá prazo e produto.
 * Sem esse cuidado, o rollback apagaria a origem de quem comprou de verdade.
 */
export async function rollbackDireitos(): Promise<{ alterados: number }> {
  const r = await User.updateMany(
    {
      tier: "premium",
      premiumSource: "purchase",
      plan: "pro",
      premiumUntil: null,
      assinaturaStatus: null,
    },
    { $set: { premiumSource: null }, $unset: { plan: "" } }
  );
  return { alterados: r.modifiedCount };
}

async function main() {
  await connectDB();
  const rollback = process.argv.includes("--rollback");

  if (rollback) {
    const r = await rollbackDireitos();
    console.log(`Rollback: ${r.alterados} contas voltaram a não ter origem.`);
  } else {
    const r = await backfillDireitos();
    console.log(`Premium sem origem encontrados: ${r.encontrados}`);
    console.log(`Carimbados como compra: ${r.alterados}`);
    if (r.encontrados === 0) {
      console.log("Nada a fazer — o ramo de legado de `calcularPlan` já pode sair.");
    }
  }

  await mongoose.disconnect();
}

if (process.argv[1]?.includes("backfillDireitos")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
