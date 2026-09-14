import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../../app.js";
import { User } from "../../models/User.js";
import { Post } from "../../models/Post.js";
import { AdminAudit } from "../../models/AdminAudit.js";
import { grantAdmin } from "../../scripts/grantAdmin.js";

// A ferramenta mais perigosa do painel: ela apaga do banco, sem desfazer.
//
// Por isso os testes aqui são quase todos sobre o que ela RECUSA. Um CRUD de
// banco que só prova que consegue apagar não provou a parte que importa.

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";
let ipSeq = 0;
const ip = () => `198.51.100.${++ipSeq}`;
const SENHA = "senha-bem-longa";

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Post.deleteMany({}), AdminAudit.deleteMany({})]);
  await request(app)
    .post("/auth/register")
    .send({ name: "Chefe", email: "chefe@teste.com", password: SENHA });
  await grantAdmin("chefe@teste.com", { force: true });
  const s = await request(app)
    .post("/admin/session")
    .set("X-Forwarded-For", ip())
    .send({ email: "chefe@teste.com", password: SENHA });
  token = s.body.data.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function alguem(email = "alvo@teste.com") {
  const r = await request(app)
    .post("/auth/register")
    .send({ name: "Alvo", email, password: SENHA });
  return r.body.user.id as string;
}

describe("listar e buscar", () => {
  it("lista as coleções com a contagem", async () => {
    const r = await request(app).get("/admin/dados").set(auth());

    expect(r.status).toBe(200);
    const users = r.body.data.find((c: { nome: string }) => c.nome === "User");
    expect(users).toBeTruthy();
    expect(users.documentos).toBeGreaterThan(0);
  });

  it("busca com filtro em JSON, como no Compass", async () => {
    await alguem("achado@teste.com");

    const q = encodeURIComponent(JSON.stringify({ email: "achado@teste.com" }));
    const r = await request(app).get(`/admin/dados/User?q=${q}`).set(auth());

    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].email).toBe("achado@teste.com");
    expect(r.body.meta.total).toBe(1);
  });

  it("filtro que não é JSON devolve erro claro, não 500", async () => {
    const r = await request(app).get("/admin/dados/User?q={isso nao e json").set(auth());
    expect(r.status).toBe(400);
  });

  it("coleção que não existe é 404, e não cria nada", async () => {
    const r = await request(app).get("/admin/dados/Inventada").set(auth());
    // Um nome livre viraria coleção nova criada por engano, ou acesso a
    // coleção interna do banco.
    expect(r.status).toBe(404);
  });

  it("pagina por cursor, nunca por offset", async () => {
    for (let i = 0; i < 3; i++) await alguem(`p${i}@teste.com`);

    const p1 = await request(app).get("/admin/dados/User?limit=2").set(auth());
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta.nextCursor).toBeTruthy();

    const p2 = await request(app)
      .get(`/admin/dados/User?limit=2&cursor=${p1.body.meta.nextCursor}`)
      .set(auth());
    const ids1 = p1.body.data.map((d: { _id: string }) => d._id);
    const ids2 = p2.body.data.map((d: { _id: string }) => d._id);
    // Nenhum documento aparece nas duas páginas.
    expect(ids1.filter((i: string) => ids2.includes(i))).toHaveLength(0);
  });
});

describe("o que a ferramenta NÃO deixa passar", () => {
  it("nunca devolve hash de senha", async () => {
    await alguem("segredo@teste.com");

    const r = await request(app).get("/admin/dados/User").set(auth());

    const bruto = JSON.stringify(r.body);
    expect(bruto).toContain("«oculto»");
    // O hash não tem por que aparecer numa tela, e gravá-lo na auditoria
    // seria espalhá-lo para um segundo lugar.
    expect(bruto).not.toMatch(/\$2[aby]\$/);
  });

  it("recusa filtro com $where, que é JavaScript no servidor do banco", async () => {
    const q = encodeURIComponent(JSON.stringify({ $where: "sleep(5000) || true" }));
    const r = await request(app).get(`/admin/dados/User?q=${q}`).set(auth());
    expect(r.status).toBe(400);
  });

  it("não edita hash de senha por aqui", async () => {
    const id = await alguem();
    const r = await request(app)
      .patch(`/admin/dados/User/${id}`)
      .set(auth())
      .send({ motivo: "tentando", campos: { passwordHash: "123" } });

    // Gravar por aqui deixaria a senha em texto claro, sem o hash que o
    // caminho normal aplica.
    expect(r.status).toBe(400);
  });

  it("não muda o _id nem aceita operador como campo", async () => {
    const id = await alguem();
    for (const campos of [{ _id: "outro" }, { $unset: { name: 1 } }]) {
      const r = await request(app)
        .patch(`/admin/dados/User/${id}`)
        .set(auth())
        .send({ motivo: "tentando", campos });
      expect(r.status).toBe(400);
    }
  });

  it("apagar exige o id digitado de novo", async () => {
    const id = await alguem();

    const errado = await request(app)
      .delete(`/admin/dados/User/${id}`)
      .set(auth())
      .send({ motivo: "limpando", confirmacao: "outra-coisa" });

    // É a diferença entre apagar o que se quer e apagar o que estava sob o
    // cursor. Aqui não há como desfazer pelo banco.
    expect(errado.status).toBe(400);
    expect(await User.countDocuments({ _id: id })).toBe(1);
  });

  it("toda ação exige motivo", async () => {
    const id = await alguem();
    const sem = await request(app)
      .delete(`/admin/dados/User/${id}`)
      .set(auth())
      .send({ confirmacao: id });
    expect(sem.status).toBe(400);
  });

  it("quem não é admin não chega perto", async () => {
    const r = await request(app)
      .post("/auth/register")
      .send({ name: "Comum", email: "comum@teste.com", password: SENHA });
    const resp = await request(app)
      .get("/admin/dados")
      .set({ Authorization: `Bearer ${r.body.token}` });
    expect(resp.status).toBe(403);
  });

  it("sem sessão nenhuma, 401", async () => {
    const r = await request(app).get("/admin/dados");
    expect(r.status).toBe(401);
  });
});

describe("editar e apagar deixam cópia na auditoria", () => {
  it("a edição grava o documento antes e depois", async () => {
    const id = await alguem();

    const r = await request(app)
      .patch(`/admin/dados/User/${id}`)
      .set(auth())
      .send({ motivo: "corrigindo o nome", campos: { name: "Nome Certo" } });

    expect(r.status).toBe(200);
    expect(r.body.data.name).toBe("Nome Certo");

    const log = (await AdminAudit.findOne({ action: "dados.update.User" }))!;
    expect(log.reason).toBe("corrigindo o nome");
    // O documento INTEIRO, e não só o diff: é o que permite desfazer.
    expect(String((log.before as Record<string, unknown>).documento)).toContain("Alvo");
    expect(String((log.after as Record<string, unknown>).documento)).toContain("Nome Certo");
  });

  it("a exclusão guarda uma cópia do que foi apagado", async () => {
    const id = await alguem("sera.apagado@teste.com");

    const r = await request(app)
      .delete(`/admin/dados/User/${id}`)
      .set(auth())
      .send({ motivo: "conta de teste", confirmacao: id });

    expect(r.status).toBe(200);
    expect(await User.countDocuments({ _id: id })).toBe(0);

    const log = (await AdminAudit.findOne({ action: "dados.delete.User" }))!;
    // Sem esta cópia, um clique errado seria perda definitiva — e é ela que
    // torna a ferramenta aceitável.
    expect(String((log.before as Record<string, unknown>).documento)).toContain(
      "sera.apagado@teste.com"
    );
  });

  it("edita só os campos informados, sem apagar o resto", async () => {
    const id = await alguem("preserva@teste.com");

    await request(app)
      .patch(`/admin/dados/User/${id}`)
      .set(auth())
      .send({ motivo: "só o nome", campos: { name: "Outro" } });

    const depois = (await User.findById(id))!;
    expect(depois.name).toBe("Outro");
    // Enviar o documento inteiro de volta apagaria em silêncio tudo que a
    // tela não conhecesse — é como uma edição de um campo vira perda de dez.
    expect(depois.email).toBe("preserva@teste.com");
    expect(depois.passwordHash).toBeTruthy();
  });

  it("documento que não existe é 404, não 500", async () => {
    const inexistente = new mongoose.Types.ObjectId().toString();
    const r = await request(app)
      .delete(`/admin/dados/User/${inexistente}`)
      .set(auth())
      .send({ motivo: "sumiu", confirmacao: inexistente });
    expect(r.status).toBe(404);
  });
});

describe("só as coleções que se usa, e a auditoria é intocável", () => {
  it("lista só as escolhidas, não as 37 do Mongoose", async () => {
    const r = await request(app).get("/admin/dados").set(auth());
    const nomes = r.body.data.map((c: { nome: string }) => c.nome);

    expect(nomes).toContain("User");
    expect(nomes).toContain("Assinatura");
    expect(nomes).toContain("Cupom");
    // Telemetria e tabela de junção não se consertam por clique.
    expect(nomes).not.toContain("AiUsage");
    expect(nomes).not.toContain("Like");
    expect(nomes).not.toContain("PushDevice");
    expect(nomes.length).toBeLessThan(30);
  });

  it("coleção de fora da lista é 404, mesmo existindo no banco", async () => {
    // 404 e não 403: quem varre não precisa saber que ela existe e está só
    // de fora.
    const r = await request(app).get("/admin/dados/AiUsage").set(auth());
    expect(r.status).toBe(404);
  });

  it("a auditoria pode ser LIDA", async () => {
    const id = await alguem();
    await request(app)
      .patch(`/admin/dados/User/${id}`)
      .set(auth())
      .send({ motivo: "gerando um registro", campos: { name: "Novo" } });

    const r = await request(app).get("/admin/dados/AdminAudit").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
  });

  it("mas NÃO pode ser apagada nem editada", async () => {
    const id = await alguem();
    await request(app)
      .patch(`/admin/dados/User/${id}`)
      .set(auth())
      .send({ motivo: "gerando um registro", campos: { name: "Novo" } });
    const log = (await AdminAudit.findOne({}))!;
    const logId = log._id.toString();

    const apagar = await request(app)
      .delete(`/admin/dados/AdminAudit/${logId}`)
      .set(auth())
      .send({ motivo: "apagando o rastro", confirmacao: logId });
    const editar = await request(app)
      .patch(`/admin/dados/AdminAudit/${logId}`)
      .set(auth())
      .send({ motivo: "mudando o rastro", campos: { reason: "outra coisa" } });

    // Um painel onde quem apagou pode apagar o registro de ter apagado não
    // tem auditoria nenhuma: o valor dela vem de não ser editável por quem
    // ela vigia.
    expect(apagar.status).toBe(403);
    expect(editar.status).toBe(403);
    expect(await AdminAudit.countDocuments({ _id: logId })).toBe(1);
  });

  it("o livro-razão dos webhooks também é só leitura", async () => {
    // Apagar uma linha dali faz o gateway poder creditar o mesmo pagamento
    // duas vezes no reenvio seguinte: a idempotência depende dela.
    const r = await request(app).get("/admin/dados").set(auth());
    const evt = r.body.data.find((c: { nome: string }) => c.nome === "EventoDeCobranca");
    expect(evt.soLeitura).toBe(true);
  });
});
