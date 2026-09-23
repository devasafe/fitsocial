import mongoose from "mongoose";
import { User } from "../models/User.js";
import { AppEvent } from "../models/AppEvent.js";
import { inicioDaJanela } from "../utils/dia.js";

/**
 * Onde as pessoas param, degrau a degrau.
 *
 * Complementa `growthMetrics.ts`, que responde QUANTAS chegaram ao fim; este
 * responde EM QUAL PASSO as outras ficaram.
 *
 * Duas decisões sustentam o número:
 *
 * 1. **Conta pessoas, não eventos.** Alguém que abriu a Home trinta vezes é uma
 *    pessoa. Contar eventos faria o degrau mais visitado parecer o mais bem
 *    sucedido.
 * 2. **A base é uma coorte: quem se cadastrou DENTRO da janela.** Sem isso,
 *    quem entrou há seis meses e treinou ontem entraria num degrau de baixo sem
 *    estar no de cima — e a taxa de passagem passaria de 100%, que é o jeito
 *    mais rápido de um funil perder a credibilidade.
 */

/** A ordem importa: é ela que define o que é "o passo anterior". */
const DEGRAUS: { nome: string; rotulo: string }[] = [
  { nome: "cadastrou", rotulo: "Criou a conta" },
  { nome: "onboarding_abriu", rotulo: "Viu o formulário inicial" },
  { nome: "onboarding_concluiu", rotulo: "Terminou o formulário" },
  { nome: "home_viu", rotulo: "Chegou na Home" },
  { nome: "registrar_abriu", rotulo: "Abriu o registro de treino" },
  { nome: "treino_salvo", rotulo: "Salvou o primeiro treino" },
  { nome: "concluido_viu", rotulo: "Viu a tela de treino concluído" },
  { nome: "compartilhar_tocou", rotulo: "Tocou em compartilhar" },
  { nome: "card_gerado", rotulo: "Gerou o cartão" },
  { nome: "story_abriu", rotulo: "Abriu o Story do Instagram" },
];

export interface DegrauDoFunil {
  nome: string;
  rotulo: string;
  /** Quantas pessoas DA COORTE passaram por aqui. */
  pessoas: number;
}

export async function funilDePercurso(dias: number): Promise<DegrauDoFunil[]> {
  const desde = inicioDaJanela(dias);

  const coorte = await User.find({ createdAt: { $gte: desde }, deletedAt: null })
    .select("_id")
    .lean();

  if (coorte.length === 0) {
    return DEGRAUS.map((d) => ({ ...d, pessoas: 0 }));
  }

  const ids = coorte.map((u) => u._id as mongoose.Types.ObjectId);

  // Uma passada só: para cada nome de evento, quantas pessoas DISTINTAS da
  // coorte o dispararam. O $addToSet é o que transforma "eventos" em "pessoas".
  const linhas = await AppEvent.aggregate<{ _id: string; pessoas: string[] }>([
    { $match: { user: { $in: ids } } },
    { $group: { _id: "$nome", pessoas: { $addToSet: "$user" } } },
  ]);

  const porNome = new Map(linhas.map((l) => [l._id, l.pessoas.length]));

  return DEGRAUS.map((d) => ({
    ...d,
    // O primeiro degrau não vem de evento nenhum: ele É a coorte.
    pessoas: d.nome === "cadastrou" ? coorte.length : (porNome.get(d.nome) ?? 0),
  }));
}
