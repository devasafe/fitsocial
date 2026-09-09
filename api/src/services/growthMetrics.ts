import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { Post } from "../models/Post.js";
import { Comment } from "../models/Comment.js";
import { CoachMessage } from "../models/CoachMessage.js";
import { UserDailyActive } from "../models/UserDailyActive.js";
import { agruparPorDia, chaveDoDia, inicioDaJanela, ultimosDias } from "../utils/dia.js";

// Métricas de crescimento do painel. Segue o padrão de agregação já usado no
// projeto (services/aiUsage.ts): $match -> $group -> $sort, sem $lookup.
//
// Tudo é agrupado no fuso de São Paulo, não em UTC: o painel é lido daqui, e um
// cadastro das 22h precisa contar no dia em que a pessoa de fato se cadastrou.

const DIA_MS = 24 * 60 * 60 * 1000;

type ModeloQualquer = mongoose.Model<never>;
const comoModelo = (m: ModeloQualquer) => m as unknown as mongoose.Model<unknown>;

export interface PontoDaSerie {
  dia: string;
  valor: number;
}

/** Preenche os dias sem registro com zero — sem isto o gráfico pula buracos e
 *  um dia sem cadastro parece que nem existiu. */
function completarDias(linhas: { _id: string; total: number }[], dias: number): PontoDaSerie[] {
  const mapa = new Map(linhas.map((l) => [l._id, l.total]));
  return ultimosDias(dias).map((dia) => ({ dia, valor: mapa.get(dia) ?? 0 }));
}

/** Quantos documentos por dia, pelo campo de data indicado. */
async function contarPorDia(
  model: ModeloQualquer,
  campo: string,
  dias: number
): Promise<PontoDaSerie[]> {
  const linhas = await comoModelo(model).aggregate<{ _id: string; total: number }>([
    { $match: { [campo]: { $gte: inicioDaJanela(dias) } } },
    { $group: { _id: agruparPorDia(campo), total: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return completarDias(linhas, dias);
}

/** Pessoas distintas por dia — não o número de eventos. */
async function distintosPorDia(
  model: ModeloQualquer,
  campoData: string,
  campoUsuario: string,
  dias: number
): Promise<Map<string, Set<string>>> {
  const linhas = await comoModelo(model).aggregate<{
    _id: string;
    usuarios: mongoose.Types.ObjectId[];
  }>([
    { $match: { [campoData]: { $gte: inicioDaJanela(dias) } } },
    { $group: { _id: agruparPorDia(campoData), usuarios: { $addToSet: `$${campoUsuario}` } } },
  ]);

  const mapa = new Map<string, Set<string>>();
  for (const l of linhas) {
    const ids = l.usuarios.map((u) => u?.toString()).filter(Boolean) as string[];
    mapa.set(l._id, new Set(ids));
  }
  return mapa;
}

export interface SerieAtivos {
  dia: string;
  /** Pessoas que registraram algo: treino, post ou conversa com o coach. */
  registraram: number;
  /** Pessoas que abriram o app. Só existe a partir do início da medição. */
  abriram: number;
}

/**
 * Duas noções de "ativo", mantidas separadas de propósito.
 *
 * "Registraram" tem história desde o começo do app, mas ignora quem abre, olha
 * o treino e sai. "Abriram" mede uso de verdade, mas só a partir do dia em que
 * a medição foi ligada. Juntar as duas numa linha só criaria um degrau falso no
 * gráfico, então o painel mostra as duas e diz desde quando cada uma vale.
 */
export async function ativosPorDia(dias: number): Promise<SerieAtivos[]> {
  const [treinos, posts, coach, acessos] = await Promise.all([
    distintosPorDia(Activity as never, "startedAt", "user", dias),
    distintosPorDia(Post as never, "createdAt", "author", dias),
    distintosPorDia(CoachMessage as never, "createdAt", "user", dias),
    UserDailyActive.aggregate<{ _id: string; total: number }>([
      { $match: { dia: { $gte: ultimosDias(dias)[0] } } },
      { $group: { _id: "$dia", total: { $sum: 1 } } },
    ]),
  ]);

  const porDiaAcesso = new Map(acessos.map((a) => [a._id, a.total]));

  return ultimosDias(dias).map((dia) => {
    const juntos = new Set<string>();
    for (const fonte of [treinos, posts, coach]) {
      for (const id of fonte.get(dia) ?? []) juntos.add(id);
    }
    return { dia, registraram: juntos.size, abriram: porDiaAcesso.get(dia) ?? 0 };
  });
}

/** Pessoas distintas ativas na janela inteira, deduplicadas entre os dias. */
export async function ativosNaJanela(dias: number): Promise<number> {
  const desde = inicioDaJanela(dias);
  const [treinos, posts, acessos] = await Promise.all([
    Activity.distinct("user", { startedAt: { $gte: desde } }),
    Post.distinct("author", { createdAt: { $gte: desde } }),
    UserDailyActive.distinct("user", { dia: { $gte: ultimosDias(dias)[0] } }),
  ]);
  const todos = new Set<string>();
  for (const lista of [treinos, posts, acessos]) {
    for (const id of lista) todos.add(String(id));
  }
  return todos.size;
}

export interface Retencao {
  d1: number;
  d7: number;
  d30: number;
  /** Quantas pessoas entraram em cada janela. Sem isto, "50%" pode ser 1 de 2. */
  base: { d1: number; d7: number; d30: number };
}

/**
 * Das pessoas que se cadastraram há N dias, quantas ainda estavam ativas em N?
 *
 * Feito com consultas simples e cruzamento em memória, em vez de um $lookup que
 * precisaria calcular "dia + N" dentro do pipeline. Com o volume atual isso
 * volta em milissegundos e cabe na cabeça de quem for ler o código depois.
 */
export async function retencao(): Promise<Retencao> {
  const usuarios = await User.find({}, { _id: 1, createdAt: 1 }).lean();
  const vazio = { d1: 0, d7: 0, d30: 0, base: { d1: 0, d7: 0, d30: 0 } };
  if (usuarios.length === 0) return vazio;

  const [acessos, atividades, posts] = await Promise.all([
    UserDailyActive.find({}, { user: 1, dia: 1 }).lean(),
    Activity.find({}, { user: 1, startedAt: 1 }).lean(),
    Post.find({}, { author: 1, createdAt: 1 }).lean(),
  ]);

  // "Fulano esteve ativo no dia X", vindo de qualquer uma das fontes.
  const ativo = new Set<string>();
  for (const a of acessos) ativo.add(`${a.user}|${a.dia}`);
  for (const a of atividades) ativo.add(`${a.user}|${chaveDoDia(a.startedAt as Date)}`);
  for (const p of posts) ativo.add(`${p.author}|${chaveDoDia(p.createdAt as Date)}`);

  const agora = Date.now();
  const janelas = [1, 7, 30] as const;
  const acertos: Record<number, number> = { 1: 0, 7: 0, 30: 0 };
  const bases: Record<number, number> = { 1: 0, 7: 0, 30: 0 };

  for (const u of usuarios) {
    const nascimento = (u.createdAt as Date).getTime();
    for (const n of janelas) {
      // Só entra na conta quem já teve tempo de voltar: incluir quem se
      // cadastrou ontem na retenção de 30 dias derrubaria o número de graça.
      if (agora - nascimento < n * DIA_MS) continue;
      bases[n]++;
      if (ativo.has(`${u._id}|${chaveDoDia(new Date(nascimento + n * DIA_MS))}`)) acertos[n]++;
    }
  }

  const taxa = (n: number) => (bases[n] ? Math.round((acertos[n] / bases[n]) * 100) : 0);
  return {
    d1: taxa(1),
    d7: taxa(7),
    d30: taxa(30),
    base: { d1: bases[1], d7: bases[7], d30: bases[30] },
  };
}

export interface Panorama {
  totais: {
    contas: number; premium: number; banidas: number; suspensas: number;
    treinos: number; posts: number; ativos7d: number;
  };
  series: {
    novos: PontoDaSerie[];
    ativos: SerieAtivos[];
    treinos: PontoDaSerie[];
    posts: PontoDaSerie[];
    comentarios: PontoDaSerie[];
    coach: PontoDaSerie[];
  };
  retencao: Retencao;
  conversao: {
    premium: number;
    porOrigem: { origem: string; total: number }[];
    taxa: number;
    /** % dos cadastrados que chegaram a registrar o primeiro treino. */
    ativacao: number;
  };
  /** Dia em que a medição de acesso começou; null enquanto ninguém acessou. */
  acessoDesde: string | null;
}

export async function panorama(dias: number): Promise<Panorama> {
  const [
    contas, premium, banidas, suspensas, treinos, posts, ativos7d,
    novos, ativos, serieTreinos, seriePosts, serieComentarios, serieCoach,
    ret, porOrigem, comTreino, primeiroAcesso,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ tier: "premium" }),
    User.countDocuments({ status: "banned" }),
    User.countDocuments({ status: "suspended" }),
    Activity.countDocuments({}),
    Post.countDocuments({}),
    ativosNaJanela(7),
    contarPorDia(User as never, "createdAt", dias),
    ativosPorDia(dias),
    contarPorDia(Activity as never, "startedAt", dias),
    contarPorDia(Post as never, "createdAt", dias),
    contarPorDia(Comment as never, "createdAt", dias),
    contarPorDia(CoachMessage as never, "createdAt", dias),
    retencao(),
    User.aggregate<{ _id: string | null; total: number }>([
      { $match: { tier: "premium" } },
      { $group: { _id: "$premiumSource", total: { $sum: 1 } } },
    ]),
    Activity.distinct("user"),
    UserDailyActive.findOne({}, { dia: 1 }).sort({ dia: 1 }).lean(),
  ]);

  return {
    totais: { contas, premium, banidas, suspensas, treinos, posts, ativos7d },
    series: {
      novos, ativos,
      treinos: serieTreinos,
      posts: seriePosts,
      comentarios: serieComentarios,
      coach: serieCoach,
    },
    retencao: ret,
    conversao: {
      premium,
      porOrigem: porOrigem.map((o) => ({ origem: o._id ?? "sem origem", total: o.total })),
      taxa: contas ? Math.round((premium / contas) * 100) : 0,
      ativacao: contas ? Math.round((comTreino.length / contas) * 100) : 0,
    },
    acessoDesde: primeiroAcesso?.dia ?? null,
  };
}
