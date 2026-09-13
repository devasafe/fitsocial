import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { recordAudit, maskEmail } from "../services/adminAudit.js";
import { temCapacidade, type Capacidade } from "../services/entitlement.js";
import { recontarAlunosDe } from "../services/patrocinio.js";

// Libera (ou tira) o acesso profissional: coach ou nutri.
//
// Diferente de `grantAdmin`, isto NÃO é escalada de privilégio — quem recebe
// não ganha poder sobre o sistema, ganha a possibilidade de convidar alunos, e
// cada aluno ainda precisa aceitar. Por isso não há trava de "já existe um".
//
// Existe como script porque é assim que o primeiro coach entra, antes de haver
// tela no painel para isso; e continua útil depois, para abrir exceção de teto
// sem mexer no código.

const CAPACIDADES: Capacidade[] = ["coach", "nutri"];

export async function grantPro(
  email: string,
  qual: Capacidade,
  opts: { revoke?: boolean; dias?: number | null; limite?: number } = {}
): Promise<{ email: string; capacidade: Capacidade; ativo: boolean; limite: number }> {
  const alvo = await User.findOne({ email: email.toLowerCase().trim() });
  if (!alvo) throw new Error("Nenhum usuário com esse e-mail");

  const antes = temCapacidade(alvo, qual);

  if (opts.revoke) {
    alvo.set(`pro.${qual}.ativo`, false);
    alvo.set(`pro.${qual}.origem`, null);
  } else {
    alvo.set(`pro.${qual}`, {
      ativo: true,
      origem: "manual",
      validoAte: opts.dias ? new Date(Date.now() + opts.dias * 24 * 60 * 60 * 1000) : null,
      // Mantém o teto que a conta já tinha quando nenhum novo é pedido: renovar
      // o acesso de um coach não deve devolvê-lo ao padrão sem querer.
      limiteDeAlunos: opts.limite ?? alvo.pro?.[qual]?.limiteDeAlunos ?? 10,
    });
  }
  await alvo.save();

  // Os alunos dele acompanham a capacidade. Recontar serve aos dois sentidos e
  // é idempotente — rodar o script duas vezes não muda nada na segunda.
  await recontarAlunosDe(alvo._id, qual);

  await recordAudit({
    actor: null,
    action: opts.revoke ? `pro.${qual}.revoke` : `pro.${qual}.grant`,
    targetKind: "user",
    targetId: alvo._id,
    targetLabel: maskEmail(alvo.email),
    reason: "via scripts/grantPro.ts",
    before: { [qual]: antes },
    after: { [qual]: !opts.revoke },
  });

  return {
    email: maskEmail(alvo.email),
    capacidade: qual,
    ativo: !opts.revoke,
    limite: alvo.pro?.[qual]?.limiteDeAlunos ?? 10,
  };
}

// CLI: `npm run pro:grant -- --email=x@y.com --tipo=coach [--dias=90] [--limite=20] [--revoke]`
if (process.argv[1]?.includes("grantPro")) {
  const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
  const email = arg("email");
  const tipo = arg("tipo") as Capacidade | undefined;

  if (!email || !tipo || !CAPACIDADES.includes(tipo)) {
    console.error(
      "[pro] uso: npm run pro:grant -- --email=voce@exemplo.com --tipo=coach|nutri [--dias=90] [--limite=20] [--revoke]"
    );
    process.exit(1);
  }

  const dias = arg("dias") ? Number(arg("dias")) : null;
  const limite = arg("limite") ? Number(arg("limite")) : undefined;

  connectDB()
    .then(async () => {
      const r = await grantPro(email, tipo, {
        revoke: process.argv.includes("--revoke"),
        dias,
        limite,
      });
      console.log(
        r.ativo
          ? `[pro] ${r.email} agora é ${r.capacidade}, com teto de ${r.limite} alunos`
          : `[pro] ${r.email} não é mais ${r.capacidade}`
      );
      await mongoose.disconnect();
    })
    .catch(async (err) => {
      console.error(`[pro] falhou: ${(err as Error).message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
