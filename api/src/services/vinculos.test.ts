import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User, type UserDoc } from "../models/User.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import {
  aceitarConvite,
  ajustarEscopo,
  encerrarVinculo,
  gerarConvite,
  podeVer,
  quantosAlunos,
  verConvite,
  vinculoAtivo,
} from "./vinculos.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    ProfessionalLink.deleteMany({}),
    ProfessionalInvite.deleteMany({}),
  ]);
});

let n = 0;
async function pessoa(campos: Record<string, unknown> = {}): Promise<UserDoc> {
  n++;
  return User.create({ name: `P${n}`, email: `p${n}@teste.com`, passwordHash: "x", ...campos });
}

const coach = (extra: Record<string, unknown> = {}) =>
  pessoa({ pro: { coach: { ativo: true, origem: "manual", ...extra } } });

describe("convite", () => {
  it("o coach gera um código, e o aluno vê quem é antes de aceitar", async () => {
    const c = await coach();
    const { code, usosRestantes } = await gerarConvite(c, "coach");

    expect(code).toHaveLength(6);
    expect(usosRestantes).toBe(1);

    const preview = await verConvite(code);
    expect(preview.profissional.id).toBe(c._id.toString());
    expect(preview.papel).toBe("coach");
    expect(preview.jaVinculado).toBe(false);
  });

  it("quem não tem a capacidade não gera convite", async () => {
    const qualquerUm = await pessoa();
    await expect(gerarConvite(qualquerUm, "coach")).rejects.toThrow(/acesso profissional/i);
  });

  it("convite expirado, revogado ou gasto não vale", async () => {
    const c = await coach();
    const aluno = await pessoa();

    const vencido = await gerarConvite(c, "coach");
    await ProfessionalInvite.updateOne(
      { code: vencido.code },
      { $set: { expiraEm: new Date(Date.now() - 1000) } }
    );
    await expect(aceitarConvite(aluno, vencido.code)).rejects.toThrow(/expirou/i);

    const revogado = await gerarConvite(c, "coach");
    await ProfessionalInvite.updateOne({ code: revogado.code }, { $set: { revogadoEm: new Date() } });
    await expect(aceitarConvite(aluno, revogado.code)).rejects.toThrow(/cancelado/i);

    const gasto = await gerarConvite(c, "coach");
    await ProfessionalInvite.updateOne({ code: gasto.code }, { $set: { usosRestantes: 0 } });
    await expect(aceitarConvite(aluno, gasto.code)).rejects.toThrow(/já foi usado/i);
  });

  it("o código não diferencia maiúscula de minúscula", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const { code } = await gerarConvite(c, "coach");

    const link = await aceitarConvite(aluno, code.toLowerCase());
    expect(link.status).toBe("ativo");
  });

  it("ninguém se acompanha pelo próprio convite", async () => {
    const c = await coach();
    const { code } = await gerarConvite(c, "coach");
    await expect(aceitarConvite(c, code)).rejects.toThrow(/você não pode/i);
  });
});

describe("aceite e consentimento", () => {
  it("o vínculo só existe depois do aceite do aluno", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const { code } = await gerarConvite(c, "coach");

    // Convite criado não é vínculo: ninguém vê nada de ninguém ainda.
    expect(await vinculoAtivo(aluno._id, c._id)).toBeNull();

    await aceitarConvite(aluno, code);
    expect(await vinculoAtivo(aluno._id, c._id)).not.toBeNull();
  });

  // Treino é o mínimo do acompanhamento; peso, medida e foto são dado de saúde
  // e de imagem, e não entram sem alguém dizer que sim.
  it("por omissão abre só os treinos", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const { code } = await gerarConvite(c, "coach");

    await aceitarConvite(aluno, code);

    expect(await podeVer(aluno._id, c._id, "treinos")).toBe(true);
    expect(await podeVer(aluno._id, c._id, "dieta")).toBe(false);
    expect(await podeVer(aluno._id, c._id, "medidas")).toBe(false);
    expect(await podeVer(aluno._id, c._id, "fotos")).toBe(false);
  });

  it("o aluno escolhe o que abrir, e pode mudar depois", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const { code } = await gerarConvite(c, "coach");

    const link = await aceitarConvite(aluno, code, { medidas: true });
    expect(await podeVer(aluno._id, c._id, "medidas")).toBe(true);
    expect(await podeVer(aluno._id, c._id, "fotos")).toBe(false);

    await ajustarEscopo(aluno, link._id.toString(), { fotos: true });
    expect(await podeVer(aluno._id, c._id, "fotos")).toBe(true);
    // O que não veio no ajuste não é zerado.
    expect(await podeVer(aluno._id, c._id, "medidas")).toBe(true);
  });

  it("o escopo é de quem aceitou — outro aluno não mexe nele", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const intruso = await pessoa();
    const { code } = await gerarConvite(c, "coach");
    const link = await aceitarConvite(aluno, code);

    await expect(ajustarEscopo(intruso, link._id.toString(), { fotos: true })).rejects.toThrow(
      /não encontrado/i
    );
  });

  it("aceitar duas vezes não duplica", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const a = await gerarConvite(c, "coach");
    const b = await gerarConvite(c, "coach");

    await aceitarConvite(aluno, a.code);
    await expect(aceitarConvite(aluno, b.code)).rejects.toThrow(/já é acompanhado/i);
    expect(await quantosAlunos(c._id, "coach")).toBe(1);
  });
});

describe("teto de alunos", () => {
  it("respeita o limite da conta no momento do aceite", async () => {
    const c = await coach({ limiteDeAlunos: 2 });
    const codigos: string[] = [];
    for (let i = 0; i < 2; i++) codigos.push((await gerarConvite(c, "coach")).code);
    // Gerado enquanto ainda havia vaga, usado depois de lotar.
    const tardio = (await gerarConvite(c, "coach")).code;

    for (const code of codigos) await aceitarConvite(await pessoa(), code);
    expect(await quantosAlunos(c._id, "coach")).toBe(2);

    await expect(aceitarConvite(await pessoa(), tardio)).rejects.toThrow(/limite de alunos/i);
  });

  it("lotado, nem gera convite novo", async () => {
    const c = await coach({ limiteDeAlunos: 1 });
    const { code } = await gerarConvite(c, "coach");
    await aceitarConvite(await pessoa(), code);

    await expect(gerarConvite(c, "coach")).rejects.toThrow(/1 de 1 alunos/i);
  });

  it("encerrar um acompanhamento abre vaga", async () => {
    const c = await coach({ limiteDeAlunos: 1 });
    const primeiro = await pessoa();
    const link = await aceitarConvite(primeiro, (await gerarConvite(c, "coach")).code);

    await encerrarVinculo(c, link._id.toString());
    expect(await quantosAlunos(c._id, "coach")).toBe(0);

    const segundo = await pessoa();
    const novo = await aceitarConvite(segundo, (await gerarConvite(c, "coach")).code);
    expect(novo.status).toBe("ativo");
  });

  it("o teto padrão é 10", async () => {
    const c = await coach();
    for (let i = 0; i < 10; i++) {
      await aceitarConvite(await pessoa(), (await gerarConvite(c, "coach")).code);
    }
    expect(await quantosAlunos(c._id, "coach")).toBe(10);
    await expect(gerarConvite(c, "coach")).rejects.toThrow(/10 de 10 alunos/i);
  });
});

describe("encerramento", () => {
  it("o aluno pode sair sozinho, e o acesso acaba na hora", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const link = await aceitarConvite(aluno, (await gerarConvite(c, "coach")).code);

    await encerrarVinculo(aluno, link._id.toString());

    expect(await vinculoAtivo(aluno._id, c._id)).toBeNull();
    expect(await podeVer(aluno._id, c._id, "treinos")).toBe(false);
  });

  it("o vínculo encerrado vira histórico, não some", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const link = await aceitarConvite(aluno, (await gerarConvite(c, "coach")).code);
    await encerrarVinculo(c, link._id.toString());

    const guardado = await ProfessionalLink.findById(link._id);
    expect(guardado?.status).toBe("encerrado");
    expect(guardado?.encerradoPor?.toString()).toBe(c._id.toString());
    expect(guardado?.aceitoEm).toBeTruthy();
  });

  it("estranho não encerra vínculo dos outros", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const estranho = await pessoa();
    const link = await aceitarConvite(aluno, (await gerarConvite(c, "coach")).code);

    await expect(encerrarVinculo(estranho, link._id.toString())).rejects.toThrow(/não é seu/i);
  });

  it("quem voltou atrás pode ser aceito de novo, no mesmo registro", async () => {
    const c = await coach();
    const aluno = await pessoa();
    const link = await aceitarConvite(aluno, (await gerarConvite(c, "coach")).code);
    await encerrarVinculo(aluno, link._id.toString());

    const denovo = await aceitarConvite(aluno, (await gerarConvite(c, "coach")).code);

    expect(denovo._id.toString()).toBe(link._id.toString());
    expect(denovo.status).toBe("ativo");
    expect(denovo.encerradoEm).toBeNull();
    expect(await ProfessionalLink.countDocuments({ client: aluno._id })).toBe(1);
  });

  it("perder a capacidade não apaga o vínculo, mas fecha a porta de novos", async () => {
    const c = await coach();
    const aluno = await pessoa();
    await aceitarConvite(aluno, (await gerarConvite(c, "coach")).code);

    c.set("pro.coach.ativo", false);
    await c.save();

    // O histórico continua; o que acaba é a capacidade de convidar mais gente.
    expect(await ProfessionalLink.countDocuments({ professional: c._id })).toBe(1);
    await expect(gerarConvite(c, "coach")).rejects.toThrow(/acesso profissional/i);
  });
});

describe("papéis são separados", () => {
  it("ser aluno do coach não abre a dieta para o nutri", async () => {
    const c = await coach();
    const nutri = await pessoa({ pro: { nutri: { ativo: true, origem: "manual" } } });
    const aluno = await pessoa();

    await aceitarConvite(aluno, (await gerarConvite(c, "coach")).code);

    expect(await vinculoAtivo(aluno._id, nutri._id)).toBeNull();
    expect(await podeVer(aluno._id, nutri._id, "dieta")).toBe(false);
  });

  it("a mesma pessoa pode ser coach e nutri do mesmo aluno", async () => {
    const dois = await pessoa({
      pro: { coach: { ativo: true, origem: "manual" }, nutri: { ativo: true, origem: "manual" } },
    });
    const aluno = await pessoa();

    await aceitarConvite(aluno, (await gerarConvite(dois, "coach")).code);
    await aceitarConvite(aluno, (await gerarConvite(dois, "nutri")).code);

    expect(await quantosAlunos(dois._id, "coach")).toBe(1);
    expect(await quantosAlunos(dois._id, "nutri")).toBe(1);
  });
});
