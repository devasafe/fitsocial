import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { isFounder, founderEmails } from "../services/founders.js";
import { planEfetivo, planDoUsuario, tierDoPlan } from "../services/entitlement.js";

// Quem MUDARIA de plano se o motor de direitos passasse a valer — sem gravar
// nada.
//
// Existe porque ligar `recomputeTier` no `requireAuth` é a única mudança desta
// fase capaz de TIRAR acesso de gente real: quem estava premium sem nenhuma
// fonte que justificasse (um `tier` escrito à mão em algum momento, uma
// cortesia vencida) volta a ser free na primeira requisição. Isso pode estar
// certo — é o serviço que o motor presta — mas não pode ser descoberto pelo
// suporte, depois, pela boca de quem perdeu.
//
// Roda ANTES do merge, contra um dump de produção restaurado:
//     npm run direitos:diagnostico
//
// Só lê. Quem escreve é `backfillDireitos.ts`, e o próprio `requireAuth`, que
// corrige uma conta por vez na primeira vez que cada pessoa abre o app.

interface Mudanca {
  email: string;
  de: string;
  para: string;
  porque: string;
}

/** Por que esta conta é (ou deixou de ser) paga. Para o relatório explicar. */
function motivo(u: InstanceType<typeof User>): string {
  const agora = Date.now();
  if (u.premiumSource === "admin") {
    if (!u.premiumUntil) return "cortesia do admin, sem prazo";
    return u.premiumUntil.getTime() > agora
      ? `cortesia do admin até ${u.premiumUntil.toISOString().slice(0, 10)}`
      : `cortesia VENCIDA em ${u.premiumUntil.toISOString().slice(0, 10)}`;
  }
  if (isFounder(u.email)) return "fundador";
  if (u.cortesiaAte) return "meses grátis de cupom";
  if (u.assinaturaStatus) return `assinatura ${u.assinaturaStatus}`;
  if (u.premiumSource === "purchase") return "compra na loja (RevenueCat)";
  if ((u.vinculosPatrocinados ?? 0) > 0) return "acompanhado por profissional";
  return "nenhuma fonte — `tier` estava solto no documento";
}

export async function diagnosticarDireitos(): Promise<{
  total: number;
  mudariam: Mudanca[];
  perdemAcesso: number;
  ganhamAcesso: number;
  /** Contas premium sem nenhuma fonte gravada, seguradas pelo ramo de legado
   *  de `calcularPlan`. É o número que diz quando o ramo pode sair: quando
   *  `npm run direitos:backfill` zerar isto, ele deixa de ser necessário. */
  dependemDoLegado: number;
}> {
  const mudariam: Mudanca[] = [];
  let total = 0;
  let perdemAcesso = 0;
  let ganhamAcesso = 0;
  let dependemDoLegado = 0;

  // Cursor, e não `find()` inteiro: a base cresce e este script precisa
  // continuar rodando na máquina de quem for conferir.
  const cursor = User.find({}).cursor();

  for await (const u of cursor) {
    total += 1;

    if (
      u.tier === "premium" &&
      !u.premiumSource &&
      !u.assinaturaStatus &&
      !u.cortesiaAte &&
      !u.produtoAssinado
    ) {
      dependemDoLegado += 1;
    }

    const antes = planDoUsuario(u);
    const depois = planEfetivo(u);
    if (antes === depois) continue;

    const tierAntes = u.tier;
    const tierDepois = tierDoPlan(depois);
    if (tierAntes === "premium" && tierDepois === "free") perdemAcesso += 1;
    if (tierAntes === "free" && tierDepois === "premium") ganhamAcesso += 1;

    mudariam.push({
      // Mascarado: SECURITY.md não admite e-mail completo em saída de
      // ferramenta. O suficiente para reconhecer quem é, sem virar lista.
      email: u.email.replace(/^(.).*(@.*)$/, "$1***$2"),
      de: antes,
      para: depois,
      porque: motivo(u),
    });
  }

  return { total, mudariam, perdemAcesso, ganhamAcesso, dependemDoLegado };
}

async function main() {
  await connectDB();

  const lista = founderEmails();
  console.log(`Fundadores configurados nesta máquina: ${lista.length}`);
  if (lista.length === 0) {
    // O aviso mais importante do script. `isFounder` lê a env AO VIVO: se ela
    // estiver ausente no servidor, o deploy rebaixa todos os fundadores de uma
    // vez, e o relatório abaixo mostraria isso como "perdem acesso".
    console.log("  ⚠ FOUNDER_EMAILS está VAZIA. Se isto for produção, confira a env");
    console.log("    ANTES de subir — senão o deploy rebaixa todos os fundadores.");
  }

  const r = await diagnosticarDireitos();

  console.log(`\nContas: ${r.total}`);
  console.log(`Mudariam de plano: ${r.mudariam.length}`);
  console.log(`  perdem acesso: ${r.perdemAcesso}`);
  console.log(`  ganham acesso: ${r.ganhamAcesso}`);
  console.log("");
  console.log(`Premium sem origem gravada: ${r.dependemDoLegado}`);
  if (r.dependemDoLegado > 0) {
    console.log("  Estão de pé só pelo ramo de legado de `calcularPlan`.");
    console.log("  Rode `npm run direitos:backfill` para carimbar a origem.");
  } else {
    console.log("  Nenhuma. O ramo de legado de `calcularPlan` já pode sair.");
  }

  if (r.mudariam.length > 0) {
    console.log("\nDetalhe:");
    for (const m of r.mudariam.slice(0, 100)) {
      console.log(`  ${m.email.padEnd(28)} ${m.de} → ${m.para}   (${m.porque})`);
    }
    if (r.mudariam.length > 100) console.log(`  … e mais ${r.mudariam.length - 100}`);
  }

  await mongoose.disconnect();
}

// Só roda quando chamado direto, nunca ao ser importado pelo teste.
if (process.argv[1]?.includes("diagnosticarDireitos")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
