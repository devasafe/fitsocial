import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { recordAudit, maskEmail } from "../services/adminAudit.js";

// Concede ou revoga o papel de admin. É a ÚNICA forma de criar o primeiro
// admin: exige acesso ao terminal do container, o mesmo nível de quem já pode
// ler as variáveis de ambiente.
//
// Por que não seguir o padrão de services/founders.ts (lista em env, aplicada
// no login): tier é presente, role é privilégio. Um erro de digitação em
// FOUNDER_EMAILS dá premium de graça; um erro em ADMIN_EMAILS dá o banco
// inteiro. E promoção implícita a cada login não deixa rastro de quando nem
// por quem — que é justamente o que a auditoria precisa registrar.

export async function grantAdmin(
  email: string,
  opts: { revoke?: boolean; force?: boolean } = {}
): Promise<{ email: string; role: string }> {
  const alvo = await User.findOne({ email: email.toLowerCase().trim() });
  if (!alvo) throw new Error(`Nenhum usuário com esse e-mail`);

  const novoPapel = opts.revoke ? "user" : "admin";

  if (!opts.revoke) {
    // Depois do primeiro admin, promoção vira escalada de privilégio silenciosa.
    const jaExiste = await User.countDocuments({ role: "admin", _id: { $ne: alvo._id } });
    if (jaExiste > 0 && !opts.force) {
      throw new Error(
        `Já existe admin no sistema. Use --force se a intenção é mesmo adicionar outro.`
      );
    }
  } else {
    // Sem admin nenhum, ninguém entra no painel — e só o script devolve o acesso.
    const outros = await User.countDocuments({ role: "admin", _id: { $ne: alvo._id } });
    if (outros === 0 && !opts.force) {
      throw new Error(`Este é o único admin. Use --force para revogar mesmo assim.`);
    }
  }

  const anterior = alvo.role;
  alvo.role = novoPapel;
  await alvo.save();

  await recordAudit({
    actor: null,
    action: opts.revoke ? "user.role.revoke" : "user.role.grant",
    targetKind: "user",
    targetId: alvo._id,
    targetLabel: maskEmail(alvo.email),
    reason: "via scripts/grantAdmin.ts",
    before: { role: anterior },
    after: { role: novoPapel },
  });

  return { email: maskEmail(alvo.email), role: novoPapel };
}

// CLI: `npm run admin:grant -- --email=voce@exemplo.com [--revoke] [--force]`
if (process.argv[1]?.includes("grantAdmin")) {
  const arg = (nome: string) =>
    process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
  const email = arg("email");

  if (!email) {
    console.error("[admin] uso: npm run admin:grant -- --email=voce@exemplo.com [--revoke] [--force]");
    process.exit(1);
  }

  connectDB()
    .then(async () => {
      const r = await grantAdmin(email, {
        revoke: process.argv.includes("--revoke"),
        force: process.argv.includes("--force"),
      });
      console.log(`[admin] ${r.email} agora tem role="${r.role}"`);
      await mongoose.disconnect();
    })
    .catch(async (err) => {
      console.error(`[admin] falhou: ${(err as Error).message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
