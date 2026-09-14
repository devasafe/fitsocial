import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../../app.js";
import { User } from "../../models/User.js";
import { Post } from "../../models/Post.js";
import { Comment } from "../../models/Comment.js";
import { Follow } from "../../models/Follow.js";
import { AdminAudit } from "../../models/AdminAudit.js";
import { grantAdmin } from "../../scripts/grantAdmin.js";
import { invalidarOcultos } from "../../services/moderation.js";
import { aplicarEventoDeCompra } from "../../services/entitlement.js";

const app = createApp();
let mongod: MongoMemoryServer;
let ipSeq = 0;
const ip = () => `198.51.100.${++ipSeq}`;

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
    User.deleteMany({}), Post.deleteMany({}), Comment.deleteMany({}),
    Follow.deleteMany({}), AdminAudit.deleteMany({}),
  ]);
  invalidarOcultos();
});

const SENHA = "senha-bem-longa";

async function registrar(email: string) {
  const r = await request(app).post("/auth/register").send({ name: "Fulano", email, password: SENHA });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

/** Cria um admin e devolve o token de sessao do painel. */
async function admin(email = "chefe@teste.com") {
  await registrar(email);
  await grantAdmin(email, { force: true });
  const r = await request(app)
    .post("/admin/session").set("X-Forwarded-For", ip())
    .send({ email, password: SENHA });
  return r.body.data.token as string;
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("Banimento", () => {
  it("derruba um token JA emitido, sem esperar ele expirar", async () => {
    const adm = await admin();
    const vitima = await registrar("vitima@teste.com");

    // O token da vitima funcionava antes do banimento.
    expect((await request(app).get("/social/feed").set(auth(vitima.token))).status).toBe(200);

    await request(app).post(`/admin/users/${vitima.id}/ban`).set(auth(adm))
      .send({ reason: "spam no feed" }).expect(200);

    const depois = await request(app).get("/social/feed").set(auth(vitima.token));
    expect(depois.status).toBe(403);
    expect(depois.body.error).toMatch(/banida/i);
  });

  it("bloqueia tambem um login novo", async () => {
    const adm = await admin();
    const vitima = await registrar("vitima@teste.com");
    await request(app).post(`/admin/users/${vitima.id}/ban`).set(auth(adm)).send({ reason: "spam" });

    const login = await request(app).post("/auth/login").send({ email: "vitima@teste.com", password: SENHA });
    expect(login.status).toBe(403);
  });

  it("esconde o conteudo do banido sem apagar, e devolve ao desbanir", async () => {
    const adm = await admin();
    const autor = await registrar("autor@teste.com");
    const leitor = await registrar("leitor@teste.com");

    const post = await request(app).post("/social/posts").set(auth(autor.token))
      .send({ text: "meu treino de hoje" });
    const postId = post.body.post.id;

    await request(app).post(`/social/users/${autor.id}/follow`).set(auth(leitor.token));
    const antes = await request(app).get("/social/feed").set(auth(leitor.token));
    expect(antes.body.posts.some((p: { id: string }) => p.id === postId)).toBe(true);

    await request(app).post(`/admin/users/${autor.id}/ban`).set(auth(adm))
      .send({ reason: "conteudo improprio" }).expect(200);

    const durante = await request(app).get("/social/feed").set(auth(leitor.token));
    expect(durante.body.posts.some((p: { id: string }) => p.id === postId)).toBe(false);
    expect((await request(app).get(`/social/posts/${postId}`).set(auth(leitor.token))).status).toBe(404);

    // O documento continua la: foi escondido, nao apagado.
    expect(await Post.countDocuments({ _id: postId })).toBe(1);

    await request(app).post(`/admin/users/${autor.id}/unban`).set(auth(adm))
      .send({ reason: "engano meu" }).expect(200);

    const depois = await request(app).get("/social/feed").set(auth(leitor.token));
    expect(depois.body.posts.some((p: { id: string }) => p.id === postId)).toBe(true);
  });

  it("nao deixa o admin banir a si mesmo nem outro admin", async () => {
    const adm = await admin();
    const eu = await User.findOne({ email: "chefe@teste.com" });
    const outro = await registrar("outro@teste.com");
    await grantAdmin("outro@teste.com", { force: true });

    const emMim = await request(app).post(`/admin/users/${eu!._id}/ban`).set(auth(adm)).send({ reason: "teste bobo" });
    const noOutro = await request(app).post(`/admin/users/${outro.id}/ban`).set(auth(adm)).send({ reason: "teste bobo" });

    expect(emMim.status).toBe(400);
    expect(noOutro.status).toBe(400);
  });

  it("exige motivo", async () => {
    const adm = await admin();
    const v = await registrar("vitima@teste.com");
    expect((await request(app).post(`/admin/users/${v.id}/ban`).set(auth(adm)).send({})).status).toBe(400);
  });
});

describe("Suspensao temporaria", () => {
  it("bloqueia enquanto vale e se libera sozinha quando vence", async () => {
    const adm = await admin();
    const v = await registrar("vitima@teste.com");

    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await request(app).post(`/admin/users/${v.id}/suspend`).set(auth(adm))
      .send({ until: amanha, reason: "briga nos comentarios" }).expect(200);

    const bloqueado = await request(app).get("/social/feed").set(auth(v.token));
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.error).toMatch(/suspensa at/i);

    // Faz a pena vencer direto no banco (o painel nao aceitaria data passada).
    await User.updateOne({ _id: v.id }, { $set: { suspendedUntil: new Date(Date.now() - 1000) } });

    // Nenhum cron rodou: a propria requisicao destrava a conta.
    expect((await request(app).get("/social/feed").set(auth(v.token))).status).toBe(200);

    const doc = await User.findById(v.id);
    expect(doc!.status).toBe("active");
    expect(doc!.suspendedUntil).toBeNull();
    expect(doc!.contentVisible).toBe(true);
  });

  it("recusa data no passado e prazo maior que um ano", async () => {
    const adm = await admin();
    const v = await registrar("vitima@teste.com");
    const ontem = new Date(Date.now() - 86400000).toISOString();
    const doisAnos = new Date(Date.now() + 730 * 86400000).toISOString();

    expect((await request(app).post(`/admin/users/${v.id}/suspend`).set(auth(adm))
      .send({ until: ontem, reason: "teste" })).status).toBe(400);
    expect((await request(app).post(`/admin/users/${v.id}/suspend`).set(auth(adm))
      .send({ until: doisAnos, reason: "teste" })).status).toBe(400);
  });
});

describe("Premium pelo painel", () => {
  it("cortesia do admin sobrevive a um EXPIRATION da loja", async () => {
    const adm = await admin();
    const u = await registrar("cliente@teste.com");

    await request(app).post(`/admin/users/${u.id}/premium`).set(auth(adm))
      .send({ grant: true, durationDays: null, reason: "amigo do projeto" }).expect(200);
    expect((await User.findById(u.id))!.tier).toBe("premium");

    // E exatamente o que quebrava antes: o webhook rebaixava em silencio.
    await aplicarEventoDeCompra(u.id, false);

    expect((await User.findById(u.id))!.tier).toBe("premium");
  });

  it("compra normal continua sendo derrubada pela expiracao", async () => {
    await registrar("comprador@teste.com");
    const u = await User.findOne({ email: "comprador@teste.com" });

    await aplicarEventoDeCompra(u!._id.toString(), true);
    expect((await User.findById(u!._id))!.tier).toBe("premium");

    await aplicarEventoDeCompra(u!._id.toString(), false);
    expect((await User.findById(u!._id))!.tier).toBe("free");
  });

  it("cortesia com prazo aparece como vencida na lista", async () => {
    const adm = await admin();
    const u = await registrar("cliente@teste.com");

    await request(app).post(`/admin/users/${u.id}/premium`).set(auth(adm))
      .send({ grant: true, durationDays: 7, reason: "teste de 7 dias" }).expect(200);

    await User.updateOne({ _id: u.id }, { $set: { premiumUntil: new Date(Date.now() - 1000) } });

    const lista = await request(app).get("/admin/users").set(auth(adm));
    const alvo = lista.body.data.find((x: { id: string }) => x.id === u.id);
    expect(alvo.tierEfetivo).toBe("free");
  });

  it("revoga a cortesia", async () => {
    const adm = await admin();
    const u = await registrar("cliente@teste.com");
    await request(app).post(`/admin/users/${u.id}/premium`).set(auth(adm))
      .send({ grant: true, durationDays: null, reason: "vou tirar depois" });

    await request(app).post(`/admin/users/${u.id}/premium`).set(auth(adm))
      .send({ grant: false, reason: "acabou o periodo de teste" }).expect(200);

    expect((await User.findById(u.id))!.tier).toBe("free");
  });
});

describe("Lista e privacidade", () => {
  it("pagina por cursor sem repetir ninguem", async () => {
    const adm = await admin();
    for (let i = 0; i < 7; i++) await registrar(`gente${i}@teste.com`);

    const p1 = await request(app).get("/admin/users?limit=3").set(auth(adm));
    expect(p1.body.data).toHaveLength(3);
    expect(p1.body.meta.nextCursor).toBeTruthy();

    const p2 = await request(app)
      .get(`/admin/users?limit=3&cursor=${encodeURIComponent(p1.body.meta.nextCursor)}`)
      .set(auth(adm));

    const ids = new Set([...p1.body.data, ...p2.body.data].map((u: { id: string }) => u.id));
    expect(ids.size).toBe(6);
    expect(p1.body.meta.total).toBe(8); // 7 cadastrados + o admin
  });

  it("busca sem quebrar com caractere de regex", async () => {
    const adm = await admin();
    await registrar("achavel@teste.com");

    const ok = await request(app).get("/admin/users?q=achavel").set(auth(adm));
    expect(ok.body.data).toHaveLength(1);

    // "a+(" viraria regex invalida se nao fosse escapado.
    const estranho = await request(app).get("/admin/users?q=" + encodeURIComponent("a+(")).set(auth(adm));
    expect(estranho.status).toBe(200);
  });

  it("nao devolve a ficha de saude no detalhe do usuario", async () => {
    const adm = await admin();
    const u = await registrar("paciente@teste.com");

    const det = await request(app).get(`/admin/users/${u.id}`).set(auth(adm));
    expect(det.status).toBe(200);
    expect(JSON.stringify(det.body)).not.toMatch(/injuries|weightKg|heightCm/);
  });

  it("ver a ficha exige motivo e fica registrado", async () => {
    const adm = await admin();
    const u = await registrar("paciente@teste.com");

    const semMotivo = await request(app).get(`/admin/users/${u.id}/profile`).set(auth(adm));
    expect(semMotivo.status).toBe(400);

    const comMotivo = await request(app)
      .get(`/admin/users/${u.id}/profile?reason=${encodeURIComponent("suporte: plano veio errado")}`)
      .set(auth(adm));
    expect(comMotivo.status).toBe(200);

    const registro = await AdminAudit.findOne({ action: "user.profile.view" });
    expect(registro).not.toBeNull();
    expect(registro!.reason).toMatch(/plano veio errado/);
    // O motivo e registrado; a ficha em si, nunca.
    expect(JSON.stringify(registro!.toObject())).not.toMatch(/weightKg|injuries/);
  });

  it("usuario comum nao passa nas rotas de usuarios", async () => {
    const comum = await registrar("comum@teste.com");
    const r = await request(app).get("/admin/users").set(auth(comum.token));
    expect(r.status).toBe(403);
  });

  it("toda acao grava auditoria com motivo e e-mail mascarado", async () => {
    const adm = await admin();
    const v = await registrar("vitima@teste.com");
    await request(app).post(`/admin/users/${v.id}/ban`).set(auth(adm)).send({ reason: "motivo registrado" });

    const registro = await AdminAudit.findOne({ action: "user.ban" });
    expect(registro!.reason).toBe("motivo registrado");
    expect(registro!.targetLabel).toBe("v***@teste.com");
    const tudo = await AdminAudit.find({});
    expect(JSON.stringify(tudo)).not.toContain("vitima@teste.com");
  });
});

describe("Acesso profissional pelo painel", () => {
  it("libera coach, e o painel profissional abre na hora", async () => {
    const adm = await admin();
    const pessoa = await registrar("coach@teste.com");

    // Antes, a conta entra no app mas não no painel.
    expect((await request(app).get("/pro/me").set(auth(pessoa.token))).status).toBe(403);

    const r = await request(app)
      .post(`/admin/users/${pessoa.id}/pro`)
      .set(auth(adm))
      .send({ capacidade: "coach", grant: true, reason: "professor da academia parceira" });

    expect(r.status).toBe(200);
    expect(r.body.data.pro.coach.ativo).toBe(true);
    expect(r.body.data.pro.coach.limite).toBe(10);
    expect(r.body.data.pro.nutri.ativo).toBe(false);

    const painel = await request(app).get("/pro/me").set(auth(pessoa.token));
    expect(painel.status).toBe(200);
  });

  it("tirar o acesso fecha o painel, também na hora", async () => {
    const adm = await admin();
    const pessoa = await registrar("excoach@teste.com");
    await request(app)
      .post(`/admin/users/${pessoa.id}/pro`)
      .set(auth(adm))
      .send({ capacidade: "coach", grant: true, reason: "liberado para teste" });

    await request(app)
      .post(`/admin/users/${pessoa.id}/pro`)
      .set(auth(adm))
      .send({ capacidade: "coach", grant: false, reason: "encerrou a parceria" })
      .expect(200);

    expect((await request(app).get("/pro/me").set(auth(pessoa.token))).status).toBe(403);
  });

  it("aceita teto próprio e prazo", async () => {
    const adm = await admin();
    const pessoa = await registrar("grande@teste.com");

    const r = await request(app)
      .post(`/admin/users/${pessoa.id}/pro`)
      .set(auth(adm))
      .send({
        capacidade: "coach",
        grant: true,
        limite: 50,
        durationDays: 30,
        reason: "parceria de 30 dias",
      });

    expect(r.body.data.pro.coach.limite).toBe(50);
    expect(r.body.data.pro.coach.validoAte).toBeTruthy();
  });

  // Liberar acesso a dados de terceiros não pode ser um clique sem rastro.
  it("fica registrado na auditoria, com motivo", async () => {
    const adm = await admin();
    const pessoa = await registrar("auditado@teste.com");

    await request(app)
      .post(`/admin/users/${pessoa.id}/pro`)
      .set(auth(adm))
      .send({ capacidade: "nutri", grant: true, reason: "nutricionista da clinica" });

    const registro = await AdminAudit.findOne({ action: "pro.nutri.grant" });
    expect(registro).toBeTruthy();
    expect(registro?.reason).toContain("nutricionista");
    // E-mail mascarado, como em toda a auditoria.
    expect(registro?.targetLabel).not.toContain("auditado@teste.com");
  });

  it("exige motivo, como as outras ações do painel", async () => {
    const adm = await admin();
    const pessoa = await registrar("semmotivo@teste.com");

    const r = await request(app)
      .post(`/admin/users/${pessoa.id}/pro`)
      .set(auth(adm))
      .send({ capacidade: "coach", grant: true, reason: "" });

    expect(r.status).toBe(400);
  });

  it("não é rota de usuário comum", async () => {
    const pessoa = await registrar("comum@teste.com");
    const outro = await registrar("outro@teste.com");

    const r = await request(app)
      .post(`/admin/users/${outro.id}/pro`)
      .set(auth(pessoa.token))
      .send({ capacidade: "coach", grant: true, reason: "quero ser coach" });

    expect(r.status).toBe(403);
  });
});

describe("Zerar treinos", () => {
  /** Uma conta com treino, recorde e um post que compartilhou o treino. */
  async function comHistorico(email: string) {
    const u = await registrar(email);
    const { Activity } = await import("../../models/Activity.js");
    const { PersonalRecord } = await import("../../models/PersonalRecord.js");
    const { WorkoutLog } = await import("../../models/WorkoutLog.js");
    const { Post } = await import("../../models/Post.js");

    const a = await Activity.create({
      user: u.id,
      sportId: "musculacao",
      kind: "strength",
      title: "Peito",
      startedAt: new Date(),
      durationSec: 3600,
      payload: {},
    });
    await WorkoutLog.create({ user: u.id, sessionDay: "2026-09-14", items: [] });
    await PersonalRecord.create({
      user: u.id,
      exerciseSlug: "supino",
      exerciseName: "Supino",
      type: "carga_max",
      value: 100,
      achievedAt: new Date(),
      activity: a._id,
    });
    const post = await Post.create({ author: u.id, text: "treinei", activity: a._id });
    return { ...u, activityId: a._id.toString(), postId: post._id.toString() };
  }

  it("apaga treinos e recordes, e mantém o post sem o cartão de treino", async () => {
    const adm = await admin("chefe.zerar@teste.com");
    const alvo = await comHistorico("zerar@teste.com");
    const { Activity } = await import("../../models/Activity.js");
    const { PersonalRecord } = await import("../../models/PersonalRecord.js");
    const { Post } = await import("../../models/Post.js");

    const r = await request(app)
      .post(`/admin/users/${alvo.id}/zerar-treinos`)
      .set(auth(adm))
      .send({ reason: "importou tudo errado", confirmacao: "zerar@teste.com" });

    expect(r.status).toBe(200);
    expect(r.body.data.atividades).toBe(1);
    expect(r.body.data.recordes).toBe(1);
    expect(await Activity.countDocuments({ user: alvo.id })).toBe(0);
    // O recorde vai junto: deixar 100 kg sem o treino que o gerou é pior que
    // não apagar nada — a tela mostraria um número sem de onde vir.
    expect(await PersonalRecord.countDocuments({ user: alvo.id })).toBe(0);

    // O post FICA: é conteúdo social, com curtidas e comentários de outros.
    const post = (await Post.findById(alvo.postId))!;
    expect(post).toBeTruthy();
    // Mas para de apontar para um treino que não existe mais.
    expect(post.activity ?? null).toBeNull();
  });

  it("exige o e-mail da conta, não um 'tem certeza?'", async () => {
    const adm = await admin("chefe.email@teste.com");
    const alvo = await comHistorico("protegido@teste.com");
    const { Activity } = await import("../../models/Activity.js");

    const r = await request(app)
      .post(`/admin/users/${alvo.id}/zerar-treinos`)
      .set(auth(adm))
      .send({ reason: "tentando", confirmacao: "outro@email.com" });

    // Confirmação que se aceita sem ler não confirma nada. Digitar o e-mail
    // obriga a olhar de quem é a conta, que é o erro a evitar.
    expect(r.status).toBe(400);
    expect(await Activity.countDocuments({ user: alvo.id })).toBe(1);
  });

  it("exige motivo, e ele vai para a auditoria com as contagens", async () => {
    const adm = await admin("chefe.motivo@teste.com");
    const alvo = await comHistorico("commotivo@teste.com");

    const sem = await request(app)
      .post(`/admin/users/${alvo.id}/zerar-treinos`)
      .set(auth(adm))
      .send({ confirmacao: "commotivo@teste.com" });
    expect(sem.status).toBe(400);

    await request(app)
      .post(`/admin/users/${alvo.id}/zerar-treinos`)
      .set(auth(adm))
      .send({ reason: "pedido da pessoa", confirmacao: "commotivo@teste.com" });

    const log = (await AdminAudit.findOne({ action: "user.zerarTreinos" }))!;
    expect(log.reason).toBe("pedido da pessoa");
    // As contagens, e não os documentos: reconstruir um histórico de treino a
    // partir de um diff não é operação que alguém vá fazer. O que importa
    // registrar é o tamanho do que se perdeu.
    expect(String((log.after as Record<string, unknown>).documento)).toContain("atividades");
    // E nunca o e-mail inteiro.
    expect(log.targetLabel).not.toBe("commotivo@teste.com");
  });

  it("o detalhe da conta diz quanto seria apagado, antes de apagar", async () => {
    const adm = await admin("chefe.previa@teste.com");
    const alvo = await comHistorico("previa@teste.com");

    const r = await request(app).get(`/admin/users/${alvo.id}`).set(auth(adm));

    expect(r.body.data.treinos.atividades).toBe(1);
    expect(r.body.data.treinos.recordes).toBe(1);
    expect(r.body.data.treinos.postsComTreino).toBe(1);
  });

  it("quem não é admin não zera nada", async () => {
    const alvo = await comHistorico("naozera@teste.com");
    const comum = await registrar("comum.zerar@teste.com");
    const r = await request(app)
      .post(`/admin/users/${alvo.id}/zerar-treinos`)
      .set(auth(comum.token))
      .send({ reason: "tentando", confirmacao: "naozera@teste.com" });
    expect(r.status).toBe(403);
  });
});
