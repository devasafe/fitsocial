import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Activity } from "../models/Activity.js";
import { Post } from "../models/Post.js";

// Cobre o modelo (Tarefa 2): a chave do envio e a impressão do conteúdo, com
// os índices que tornam a detecção de duplicata possível. Cresce na Tarefa 3
// com os testes de rota (o endpoint de registrar treino usando essa chave).
const app = createApp();
let mongod: MongoMemoryServer;
const userId = new mongoose.Types.ObjectId();

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Um agente HTTP já autenticado. */
function como(token: string) {
  return { post: (path: string) => request(app).post(path).set(auth(token)) };
}

let n = 0;
async function registrar(): Promise<{ token: string; id: string }> {
  n++;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Rep${n}`, email: `rep${n}@teste.com`, password: "senha12345" });
  return { token: r.body.token, id: r.body.user.id };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Activity.init(); // garante que o Mongoose sincronizou os índices
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Activity: clientKey e impressao", () => {
  it("duas atividades do mesmo usuário não podem ter a mesma clientKey", async () => {
    const base = {
      user: userId,
      sportId: "musculacao",
      kind: "strength" as const,
      startedAt: new Date(),
      durationSec: 60,
      visibility: "private" as const,
      payload: {},
      metrics: {},
      disclaimer: undefined,
    };
    await Activity.create({ ...base, clientKey: "k1" });
    await expect(Activity.create({ ...base, clientKey: "k1" })).rejects.toThrow();
  });

  it("atividades SEM clientKey continuam podendo coexistir", async () => {
    // Todo treino que já existe em produção não tem chave. Um índice único que
    // não seja esparso recusaria o segundo deles.
    const base = {
      user: userId,
      sportId: "musculacao",
      kind: "strength" as const,
      startedAt: new Date(),
      durationSec: 60,
      visibility: "private" as const,
      payload: {},
      metrics: {},
    };
    await Activity.create(base);
    await expect(Activity.create(base)).resolves.toBeTruthy();
  });
});

describe("POST /activities: o servidor reconhece o mesmo treino enviado duas vezes", () => {
  // Um usuário novo por teste: os `toBe(N)` do brief contam as atividades
  // DESTA pessoa, e só ficam exatos se ela não carregar treino de um teste
  // anterior (o arquivo inteiro divide o mesmo MongoMemoryServer).
  let token = "";
  let idDoUsuario = "";
  let tokenDeOutro = "";

  beforeEach(async () => {
    const eu = await registrar();
    token = eu.token;
    idDoUsuario = eu.id;
    tokenDeOutro = (await registrar()).token;
  });

  it("o mesmo envio duas vezes cria UM treino, e o segundo devolve o primeiro", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      clientKey: "sessao-1",
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };

    const um = await como(token).post("/activities").send(corpo).expect(201);
    const dois = await como(token).post("/activities").send(corpo).expect(200);

    expect(dois.body.data.id).toBe(um.body.data.id);
    expect(dois.body.meta.repetido).toBe(true);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(1);
  });

  it("sem chave, o mesmo conteúdo em menos de 10 minutos também não duplica", async () => {
    // É o caso do APK instalado, que não manda chave nenhuma.
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };

    await como(token).post("/activities").send(corpo).expect(201);
    const dois = await como(token).post("/activities").send(corpo).expect(200);

    expect(dois.body.meta.repetido).toBe(true);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(1);
  });

  it("`mesmoAssim` grava o segundo, para quem treinou duas vezes de verdade", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };

    await como(token).post("/activities").send(corpo).expect(201);
    await como(token).post("/activities").send({ ...corpo, mesmoAssim: true }).expect(201);

    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
  });

  it("conteúdo diferente no mesmo minuto grava os dois", async () => {
    // A rede compara CONTEÚDO, não horário: dois treinos diferentes seguidos são
    // dois treinos, e recusá-los seria pior que a duplicata que ela evita.
    const base = { sportId: "musculacao", kind: "strength", durationSec: 3600 };
    await como(token)
      .post("/activities")
      .send({ ...base, payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } })
      .expect(201);
    await como(token)
      .post("/activities")
      .send({ ...base, payload: { exercises: [{ name: "Agachamento", sets: [{ weightKg: 100, reps: 5 }] }] } })
      .expect(201);

    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
  });

  it("o mesmo conteúdo DEPOIS da janela grava normalmente", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };
    const um = await como(token).post("/activities").send(corpo).expect(201);
    // `overwriteImmutable`: desde o Mongoose 5, `createdAt` gerado por
    // `timestamps: true` é imutável por padrão — um `$set` comum é
    // descartado em silêncio (sem erro, sem efeito). Só assim o teste
    // realmente empurra o treino para fora da janela.
    await Activity.updateOne(
      { _id: um.body.data.id },
      { $set: { createdAt: new Date(Date.now() - 20 * 60_000) } },
      { timestamps: false, overwriteImmutable: true }
    );

    await como(token).post("/activities").send(corpo).expect(201);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
  });

  it("a repetição NÃO cria um segundo post no feed", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      clientKey: "sessao-2",
      shareToFeed: true,
      caption: "bora",
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };
    await como(token).post("/activities").send(corpo).expect(201);
    await como(token).post("/activities").send(corpo).expect(200);
    expect(await Post.countDocuments({ author: idDoUsuario })).toBe(1);
  });

  it("a chave é por PESSOA: mesma chave de outra conta não colide", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      // 8+ caracteres: é o mínimo que o schema exige (min(8) em clientKey).
      clientKey: "mesma-chave",
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };
    await como(token).post("/activities").send(corpo).expect(201);
    await como(tokenDeOutro).post("/activities").send(corpo).expect(201);
    expect(await Activity.countDocuments({ clientKey: "mesma-chave" })).toBe(2);
  });

  // `sessionDay` (dentro de `planLink`) é CONTEÚDO, não metadado: duas sessões
  // do plano com os mesmos exercícios são dois treinos diferentes, e o mesmo
  // `sessionDay` reenviado é o mesmo treino. Documenta a regra para ninguém
  // "simplificar" a impressão tirando `planLink` de volta — foi assim que o
  // check-in de duas sessões distintas, feito em sequência, colidia em
  // produção antes desta correção (ver ranking de `gamification.test.ts`).
  it("sessionDay diferente, mesmos exercícios: /checkins grava DOIS treinos", async () => {
    const entries = [{ exerciseName: "Supino", weightKg: 40, reps: 10 }];
    await como(token).post("/checkins").send({ sessionDay: "Dia A", entries }).expect(201);
    await como(token).post("/checkins").send({ sessionDay: "Dia B", entries }).expect(201);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
  });

  it("mesmo sessionDay reenviado: /checkins grava UM treino só", async () => {
    const entries = [{ exerciseName: "Supino", weightKg: 40, reps: 10 }];
    const um = await como(token).post("/checkins").send({ sessionDay: "Dia A", entries }).expect(201);
    expect(um.body.repetido).toBeFalsy();
    const dois = await como(token).post("/checkins").send({ sessionDay: "Dia A", entries }).expect(200);
    expect(dois.body.repetido).toBe(true);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(1);
  });

  // `startedAt` é CONTEÚDO (emenda de 16/09/2026 ao desenho): registro
  // retroativo de dois dias diferentes, mesma rotina, é plausível — e são
  // dois treinos, não um. Documenta a regra para ninguém tirar `startedAt`
  // da impressão de volta (a saída original do desenho, corrigida depois da
  // revisão, era desligar a rede inteira para quem manda `startedAt` — o que
  // teria deixado o PRÓPRIO registro retroativo sem proteção nenhuma).
  it("startedAt diferente, mesmo conteúdo: grava DOIS treinos", async () => {
    const corpo = (startedAt: string) => ({
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      startedAt,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    });
    await como(token).post("/activities").send(corpo("2026-09-14T10:00:00.000Z")).expect(201);
    await como(token).post("/activities").send(corpo("2026-09-16T10:00:00.000Z")).expect(201);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
  });

  it("mesmo startedAt reenviado: grava UM treino só", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      startedAt: "2026-09-14T10:00:00.000Z",
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };
    await como(token).post("/activities").send(corpo).expect(201);
    const dois = await como(token).post("/activities").send(corpo).expect(200);
    expect(dois.body.meta.repetido).toBe(true);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(1);
  });

  // Achado da revisão do lado do app (16/09/2026): a `clientKey` é apagada do
  // aparelho só DEPOIS do 201 — se o processo morre entre a resposta e a
  // limpeza, ela sobrevive ao uso. O app pôs um prazo de 6h como paliativo,
  // mas duas aulas do MESMO esporte cabem dentro de 6h — a chave velha
  // reusada faria o servidor devolver o treino da manhã como se fosse o da
  // tarde, engolindo o da tarde em silêncio. A regra: chave igual com
  // conteúdo diferente não é repetição, é chave velha — grava o novo.
  describe("chave velha: mesma clientKey, conteúdo diferente não é repetição", () => {
    it("mesma chave, MESMO conteúdo: continua sendo um treino só (não pode regredir)", async () => {
      const corpo = {
        sportId: "musculacao",
        kind: "strength",
        durationSec: 3600,
        clientKey: "chave-reusada-1",
        payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
      };
      const um = await como(token).post("/activities").send(corpo).expect(201);
      const dois = await como(token).post("/activities").send(corpo).expect(200);

      expect(dois.body.data.id).toBe(um.body.data.id);
      expect(dois.body.meta.repetido).toBe(true);
      expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(1);
    });

    it("mesma chave, conteúdo DIFERENTE: grava os DOIS, e o segundo sem clientKey", async () => {
      const chave = "chave-reusada-2";
      const manha = await como(token)
        .post("/activities")
        .send({
          sportId: "musculacao",
          kind: "strength",
          durationSec: 3600,
          clientKey: chave,
          payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
        })
        .expect(201);

      const tarde = await como(token)
        .post("/activities")
        .send({
          sportId: "musculacao",
          kind: "strength",
          durationSec: 3600,
          clientKey: chave,
          payload: { exercises: [{ name: "Agachamento", sets: [{ weightKg: 100, reps: 5 }] }] },
        })
        .expect(201);

      expect(tarde.body.data.id).not.toBe(manha.body.data.id);
      expect(tarde.body.meta.repetido).toBe(false);
      expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);

      const segundo = await Activity.findById(tarde.body.data.id);
      expect(segundo!.clientKey).toBeUndefined();
    });

    it("caso concreto da revisão: dois check-ins do mesmo esporte reusam a chave com exercícios diferentes — os dois gravados", async () => {
      const chave = "chave-reusada-checkin";
      const manha = await como(token)
        .post("/checkins")
        .send({
          sessionDay: "Musculação",
          clientKey: chave,
          entries: [{ exerciseName: "Supino", weightKg: 80, reps: 8 }],
        });
      expect(manha.status).toBe(201);

      const tarde = await como(token)
        .post("/checkins")
        .send({
          sessionDay: "Musculação",
          clientKey: chave,
          entries: [{ exerciseName: "Remada", weightKg: 60, reps: 10 }],
        });
      expect(tarde.status).toBe(201);
      expect(tarde.body.repetido).toBeFalsy();

      expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
    });
  });

  // Dispara o `catch` de E11000 de verdade (não só por leitura): dois envios
  // com a MESMA clientKey, de fato simultâneos, passam os dois pelo
  // `acharRepeticao` antes de qualquer um ter gravado — nenhum vê o outro —
  // e chegam os dois no `Activity.create`. O índice único derruba o segundo
  // com E11000, e é esse caminho (não o `findOne` de `acharRepeticao`) que
  // precisa devolver o treino existente em vez de estourar 500.
  it("corrida de verdade: dois envios simultâneos com a mesma clientKey gravam UM treino, sem 500", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      clientKey: "corrida-de-verdade",
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };
    const [a, b] = await Promise.all([
      como(token).post("/activities").send(corpo),
      como(token).post("/activities").send(corpo),
    ]);

    // Nenhum dos dois pode ter estourado — é exatamente o 500 que este
    // tratamento existe para evitar.
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
    // Um dos dois criou (201), o outro reconheceu a repetição (200) — a
    // ordem entre eles não é determinística, por isso o `sort`.
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(await Activity.countDocuments({ clientKey: "corrida-de-verdade" })).toBe(1);
  });

  it("`mesmoAssim` grava mesmo com a chave JÁ USADA — a saída de emergência não pode virar armadilha", async () => {
    // A pessoa confirmou que este treino é OUTRO. Gravar com a mesma chave
    // bateria no índice único, e o `catch` da corrida devolveria o treino
    // ANTIGO com 200 — descartando justamente o que ela acabou de confirmar
    // ser diferente. O segundo tem de entrar, e SEM aquela chave.
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      clientKey: "chave-ja-usada",
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };

    await como(token).post("/activities").send(corpo).expect(201);
    const dois = await como(token)
      .post("/activities")
      .send({ ...corpo, mesmoAssim: true })
      .expect(201);

    expect(await Activity.countDocuments({ user: new mongoose.Types.ObjectId(idDoUsuario) })).toBe(2);
    expect((await Activity.findById(dois.body.data.id))!.clientKey).toBeUndefined();
    expect(await Activity.countDocuments({ clientKey: "chave-ja-usada" })).toBe(1);
  });

  it("chave sem dono NÃO pula a rede: conteúdo idêntico recente ainda é repetição", async () => {
    // Se o armazenamento do app falhar entre dois envios do mesmo treino, um
    // vai com chave e o outro sem. Parar na chave deixaria a duplicata passar
    // no exato caso em que a primeira linha de defesa já falhou.
    const base = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      payload: { exercises: [{ name: "Remada", sets: [{ weightKg: 60, reps: 10 }] }] },
    };

    await como(token).post("/activities").send(base).expect(201);
    const dois = await como(token)
      .post("/activities")
      .send({ ...base, clientKey: "chave-nova-em-folha" })
      .expect(200);

    expect(dois.body.meta.repetido).toBe(true);
    expect(await Activity.countDocuments({ user: new mongoose.Types.ObjectId(idDoUsuario) })).toBe(1);
  });

  it("editar o treino refaz a impressão: o conteúdo ANTIGO deixa de ser reconhecido como ele", async () => {
    // Sem regravar, o treino corrigido guarda a digital do que ele não é mais —
    // e um treino novo com o conteúdo antigo seria lido como repetição dele.
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      payload: { exercises: [{ name: "Agachamento", sets: [{ weightKg: 100, reps: 5 }] }] },
    };
    const um = await como(token).post("/activities").send(corpo).expect(201);

    await request(app)
      .patch(`/activities/${um.body.data.id}`)
      .set(auth(token))
      .send({ payload: { exercises: [{ name: "Agachamento", sets: [{ weightKg: 110, reps: 5 }] }] } })
      .expect(200);

    // Mesmo conteúdo do ORIGINAL, logo em seguida: não é repetição de nada.
    await como(token).post("/activities").send(corpo).expect(201);
    expect(await Activity.countDocuments({ user: new mongoose.Types.ObjectId(idDoUsuario) })).toBe(2);
  });
});
