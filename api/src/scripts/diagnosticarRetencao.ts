import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { Post } from "../models/Post.js";
import { Like } from "../models/Like.js";
import { Comment } from "../models/Comment.js";
import { Follow } from "../models/Follow.js";
import { UserDailyActive } from "../models/UserDailyActive.js";
import { FoodLog } from "../models/FoodLog.js";

// Por que as pessoas cadastradas pararam de usar o app — respondido com o que
// JÁ ESTÁ gravado, sem instrumentar nada e sem esperar 30 dias.
//
// O painel (/admin, services/growthMetrics.ts) já dá retenção D1/D7/D30,
// ativação e ativos por dia. Este script existe para as perguntas que ele NÃO
// responde, e que decidem o que construir a seguir:
//
//   - a pessoa nunca registrou nada, ou registrou e parou? São produtos
//     diferentes: o primeiro é onboarding, o segundo é motivo de voltar.
//   - em que degrau do funil ela some?
//   - quem postou recebeu resposta de alguém? Post sem reação mata o próximo.
//   - quanto tempo cada pessoa durou desde o cadastro?
//
// SÓ LÊ. Pode rodar contra produção a qualquer hora.
//
//   npm run retencao:diagnostico
//   npm run retencao:diagnostico -- --detalhe    (uma linha por pessoa)

// "Só lê" precisa ser verdade, e sem isto não era: ao conectar, o mongoose
// cria por conta própria todo índice declarado nos schemas. Num script de
// diagnóstico apontado para produção, isso é escrita — e escrita que pode
// travar a coleção enquanto constrói. Desligar aqui não afeta o servidor, que
// tem o próprio processo de boot.
mongoose.set("autoIndex", false);

const DIA_MS = 24 * 60 * 60 * 1000;
const detalhado = process.argv.includes("--detalhe");

/** "2026-09-23" -> Date ao meio-dia de São Paulo, longe de qualquer virada. */
function diaParaData(dia: string): Date {
  return new Date(dia + "T12:00:00-03:00");
}

function pct(parte: number, todo: number): string {
  if (!todo) return "  -  ";
  return (Math.round((parte / todo) * 100) + "%").padStart(5);
}

/** Uma etapa do funil: quantos chegaram, quanto é do total e do passo anterior. */
function degrau(nome: string, quantos: number, total: number, anterior: number): void {
  const daEtapa = anterior === quantos ? "     " : pct(quantos, anterior);
  console.log(
    "  " + nome.padEnd(38) + String(quantos).padStart(4) +
    "  " + pct(quantos, total) + " do total  " + daEtapa + " do passo anterior"
  );
}

function histograma(titulo: string, faixas: [string, number][]): void {
  const maior = Math.max(1, ...faixas.map(([, n]) => n));
  console.log("\n" + titulo);
  for (const [rotulo, n] of faixas) {
    const barra = "#".repeat(Math.round((n / maior) * 40));
    console.log("  " + rotulo.padEnd(16) + String(n).padStart(4) + "  " + barra);
  }
}

/** Empurra numa lista guardada em Map, criando a lista na primeira vez. */
function acumular<T>(mapa: Map<string, T[]>, chave: string, valor: T): void {
  const atual = mapa.get(chave);
  if (atual) atual.push(valor);
  else mapa.set(chave, [valor]);
}

async function diagnosticar(): Promise<void> {
  const agora = Date.now();

  const [usuarios, atividades, posts, curtidas, comentarios, seguidas, acessos, refeicoes] =
    await Promise.all([
      User.find({ deletedAt: null }, { _id: 1, name: 1, createdAt: 1, onboardingComplete: 1 }).lean(),
      Activity.find({}, { user: 1, startedAt: 1, kind: 1 }).lean(),
      Post.find(
        { deletedAt: null },
        { author: 1, createdAt: 1, imageUrl: 1, activity: 1 }
      ).lean(),
      Like.find({}, { user: 1, post: 1 }).lean(),
      Comment.find({}, { author: 1, post: 1 }).lean(),
      Follow.find({}, { follower: 1, following: 1 }).lean(),
      UserDailyActive.find({}, { user: 1, dia: 1 }).lean(),
      FoodLog.find({}, { user: 1 }).lean(),
    ]);

  const total = usuarios.length;

  // ---- Quem fez o quê, por pessoa ----
  const treinosDe = new Map<string, Date[]>();
  for (const a of atividades) acumular(treinosDe, String(a.user), a.startedAt as Date);

  const postsDe = new Map<string, { createdAt: Date; imageUrl: string }[]>();
  for (const p of posts) {
    acumular(postsDe, String(p.author), {
      createdAt: p.createdAt as Date,
      imageUrl: (p.imageUrl as string) ?? "",
    });
  }

  const acessosDe = new Map<string, string[]>();
  for (const a of acessos) acumular(acessosDe, String(a.user), a.dia as string);

  const donoDoPost = new Map(posts.map((p) => [String(p._id), String(p.author)]));
  const comeu = new Set(refeicoes.map((r) => String(r.user)));
  const segue = new Set(seguidas.map((f) => String(f.follower)));
  const seguido = new Set(seguidas.map((f) => String(f.following)));

  // Interação RECEBIDA de outra pessoa. Curtir o próprio post não é resposta
  // social nenhuma, e é exatamente o que infla este número se não filtrar.
  const recebeuInteracao = new Set<string>();
  const postsComInteracao = new Set<string>();
  for (const l of curtidas) {
    const dono = donoDoPost.get(String(l.post));
    if (!dono || dono === String(l.user)) continue;
    recebeuInteracao.add(dono);
    postsComInteracao.add(String(l.post));
  }
  for (const c of comentarios) {
    const dono = donoDoPost.get(String(c.post));
    if (!dono || dono === String(c.author)) continue;
    recebeuInteracao.add(dono);
    postsComInteracao.add(String(c.post));
  }

  /** Último sinal de vida: treino, post ou simples abertura do app. */
  function ultimoSinal(id: string): Date | null {
    const candidatos: number[] = [];
    for (const d of treinosDe.get(id) ?? []) candidatos.push(new Date(d).getTime());
    for (const p of postsDe.get(id) ?? []) candidatos.push(new Date(p.createdAt).getTime());
    for (const dia of acessosDe.get(id) ?? []) candidatos.push(diaParaData(dia).getTime());
    return candidatos.length ? new Date(Math.max(...candidatos)) : null;
  }

  const quantosTreinos = (u: { _id: unknown }) => (treinosDe.get(String(u._id)) ?? []).length;

  // ---- 1. O funil ----
  console.log("\n" + "=".repeat(78));
  console.log("1. O FUNIL - onde as pessoas somem");
  console.log("=".repeat(78) + "\n");

  const comOnboarding = usuarios.filter((u) => u.onboardingComplete).length;
  const abriuAlgumDia = usuarios.filter((u) => (acessosDe.get(String(u._id)) ?? []).length > 0).length;
  const com1 = usuarios.filter((u) => quantosTreinos(u) >= 1).length;
  const com3 = usuarios.filter((u) => quantosTreinos(u) >= 3).length;
  const com10 = usuarios.filter((u) => quantosTreinos(u) >= 10).length;
  const postou = usuarios.filter((u) => (postsDe.get(String(u._id)) ?? []).length >= 1).length;
  const postouFoto = usuarios.filter((u) =>
    (postsDe.get(String(u._id)) ?? []).some((p) => p.imageUrl !== "")
  ).length;
  const respondido = usuarios.filter((u) => recebeuInteracao.has(String(u._id))).length;

  degrau("cadastrou", total, total, total);
  degrau("concluiu o onboarding", comOnboarding, total, total);
  degrau("abriu o app ao menos um dia*", abriuAlgumDia, total, comOnboarding);
  degrau("registrou 1 treino", com1, total, comOnboarding);
  degrau("registrou 3 treinos", com3, total, com1);
  degrau("registrou 10 treinos", com10, total, com3);
  degrau("publicou 1 post", postou, total, com1);
  degrau("publicou post COM FOTO", postouFoto, total, postou);
  degrau("recebeu curtida/comentario", respondido, total, postou);
  console.log("\n  * so conta a partir do dia em que a medicao de acesso foi ligada.\n");

  degrau("registrou alguma refeicao", usuarios.filter((u) => comeu.has(String(u._id))).length, total, total);
  degrau("segue ao menos 1 pessoa", usuarios.filter((u) => segue.has(String(u._id))).length, total, total);
  degrau("e seguido por alguem", usuarios.filter((u) => seguido.has(String(u._id))).length, total, total);

  // ---- 2. Quantos treinos cada um registrou ----
  const faixas: [string, (n: number) => boolean][] = [
    ["0 (nenhum)", (n) => n === 0],
    ["1", (n) => n === 1],
    ["2", (n) => n === 2],
    ["3 a 5", (n) => n >= 3 && n <= 5],
    ["6 a 10", (n) => n >= 6 && n <= 10],
    ["11 a 20", (n) => n >= 11 && n <= 20],
    ["21 ou mais", (n) => n >= 21],
  ];
  histograma(
    "2. TREINOS POR PESSOA  (0 = falha de ativacao; 1-2 = falta motivo de voltar)",
    faixas.map(([rotulo, teste]) => [rotulo, usuarios.filter((u) => teste(quantosTreinos(u))).length])
  );

  // ---- 3. Quanto tempo cada pessoa durou ----
  const semanas = new Map<string, number>();
  let vivos = 0;
  let nuncaDeuSinal = 0;
  for (const u of usuarios) {
    const ultimo = ultimoSinal(String(u._id));
    if (!ultimo) {
      nuncaDeuSinal++;
      continue;
    }
    if (agora - ultimo.getTime() <= 7 * DIA_MS) vivos++;
    const nascimento = new Date(u.createdAt as Date).getTime();
    const semana = Math.floor(Math.max(0, ultimo.getTime() - nascimento) / (7 * DIA_MS));
    const chave = semana >= 4 ? "semana 4+" : "semana " + semana;
    semanas.set(chave, (semanas.get(chave) ?? 0) + 1);
  }
  histograma("3. ATE QUANDO CADA UM DUROU  (do cadastro ao ultimo sinal de vida)", [
    ["nunca deu sinal", nuncaDeuSinal],
    ...["semana 0", "semana 1", "semana 2", "semana 3", "semana 4+"].map(
      (k) => [k, semanas.get(k) ?? 0] as [string, number]
    ),
  ]);
  console.log("\n  ativos nos ultimos 7 dias: " + vivos + " de " + total + " (" + pct(vivos, total).trim() + ")");

  // ---- 4. O conteudo social ----
  console.log("\n" + "=".repeat(78));
  console.log("4. O QUE FOI PUBLICADO, E SE ALGUEM RESPONDEU");
  console.log("=".repeat(78) + "\n");

  const comFoto = posts.filter((p) => ((p.imageUrl as string) ?? "") !== "").length;
  const deTreino = posts.filter((p) => p.activity).length;
  const semNinguem = posts.length - postsComInteracao.size;
  const linha = (rotulo: string, n: number, sobre?: number, nota = "") =>
    console.log(
      "  " + rotulo.padEnd(36) + String(n).padStart(4) +
      (sobre === undefined ? "" : "  " + pct(n, sobre)) + nota
    );

  linha("posts publicados", posts.length);
  linha("...com foto", comFoto, posts.length);
  linha("...ligados a um treino", deTreino, posts.length);
  linha("...que alguem curtiu ou comentou", postsComInteracao.size, posts.length);
  linha("...que ninguem tocou", semNinguem, posts.length, "  <- post sem resposta mata o proximo");
  console.log("");
  linha("curtidas no total", curtidas.length);
  linha("comentarios no total", comentarios.length);
  linha("relacoes de seguir", seguidas.length);
  linha("treinos registrados no total", atividades.length);

  const porTipo = new Map<string, number>();
  for (const a of atividades) porTipo.set(a.kind as string, (porTipo.get(a.kind as string) ?? 0) + 1);
  const tipos = [...porTipo].map(([k, n]) => k + "=" + n).join("  ");
  console.log("  por tipo: " + (tipos || "(nenhum)"));

  // ---- 5. Uma linha por pessoa ----
  if (!detalhado) {
    console.log("\n  (rode com  -- --detalhe  para ver uma linha por pessoa)\n");
    return;
  }

  console.log("\n" + "=".repeat(78));
  console.log("5. PESSOA A PESSOA");
  console.log("=".repeat(78) + "\n");
  console.log(
    "  " + "nome".padEnd(22) + "cadastro".padEnd(12) + "treinos".padStart(7) +
    "posts".padStart(6) + "dias".padStart(5) + "durou".padStart(7) + "  ultimo sinal"
  );

  const linhas = usuarios
    .map((u) => {
      const id = String(u._id);
      const ultimo = ultimoSinal(id);
      const nascimento = new Date(u.createdAt as Date);
      return {
        nome: ((u.name as string) ?? "?").slice(0, 21),
        cadastro: nascimento.toISOString().slice(0, 10),
        treinos: (treinosDe.get(id) ?? []).length,
        posts: (postsDe.get(id) ?? []).length,
        dias: (acessosDe.get(id) ?? []).length,
        durou: ultimo ? Math.round((ultimo.getTime() - nascimento.getTime()) / DIA_MS) : -1,
        ultimo: ultimo ? ultimo.toISOString().slice(0, 10) : "nunca",
      };
    })
    .sort((a, b) => b.treinos - a.treinos || b.durou - a.durou);

  for (const l of linhas) {
    console.log(
      "  " + l.nome.padEnd(22) + l.cadastro.padEnd(12) + String(l.treinos).padStart(7) +
      String(l.posts).padStart(6) + String(l.dias).padStart(5) +
      (l.durou < 0 ? "-" : l.durou + "d").padStart(7) + "  " + l.ultimo
    );
  }
  console.log("");
}

connectDB()
  .then(diagnosticar)
  .then(disconnectDB)
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
