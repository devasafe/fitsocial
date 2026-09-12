// A identidade de um exercício, para que o histórico dele seja UM só.
//
// O que o payload guarda é `name`, texto livre digitado pela pessoa. Isso fazia
// "Supino reto", "supino reto" e "Supino  Reto " serem três exercícios
// diferentes no progresso e no recorde — três linhas no gráfico, três PRs, a
// evolução picada em pedaços. O slug é a chave estável que faltava.
//
// A regra de normalização é a MESMA que o CrossFit já usava em
// `chaveDoMovimento` desde sempre; ela só nunca tinha sido aplicada à força.
// Por isso ela mora aqui agora, e `crossfit.ts` passa a reusá-la — as duas
// precisam continuar idênticas, senão o mesmo movimento vira duas chaves
// conforme o esporte em que foi registrado.

import { EXERCISES } from "./exercisesCatalog.js";
import type { StrengthPayload } from "../models/strength.js";

/** Nome normalizado: sem acento, sem caixa, sem pontuação, separado por `_`. */
export function slugify(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Ids válidos do catálogo — quem escolheu da lista já traz a identidade pronta. */
const IDS = new Set(EXERCISES.map((e) => e.id));

/**
 * Nome do catálogo (pt e en) → id do catálogo.
 *
 * Existe porque o id curado nem sempre é o slug do nome: "Flexão de braço" tem
 * id `flexao`, e sem este mapa quem digita o nome inteiro cairia em
 * `flexao_de_braco`, um histórico separado do de quem escolheu da lista.
 */
const POR_NOME = new Map<string, string>();
for (const e of EXERCISES) {
  POR_NOME.set(slugify(e.name), e.id);
  if (e.nameEn) POR_NOME.set(slugify(e.nameEn), e.id);
}

/**
 * A identidade do exercício, na ordem de confiança:
 * escolha do catálogo > nome conhecido do catálogo > slug do que foi digitado.
 *
 * Devolve "" quando não sobra nada de identificável — o chamador não grava.
 */
export function slugDoExercicio(name: string, exerciseId?: string | null): string {
  if (exerciseId && IDS.has(exerciseId)) return exerciseId;

  const slug = slugify(name ?? "");
  return POR_NOME.get(slug) ?? slug;
}

/**
 * O payload de forca com a identidade de cada exercicio resolvida.
 *
 * Roda no salvamento, junto das metricas, e nao confia no que veio do app: o
 * `exerciseId` e apagado assim que a pessoa edita o texto (`digitouNome`), e a
 * rota legada `POST /checkins` nunca manda nenhum dos dois. Devolve copia —
 * mexer no objeto de entrada arriscaria gravar o que o chamador ainda vai ler.
 *
 * Exercicio sem nada identificavel fica SEM slug, em vez de ganhar "": a
 * ausencia diz "nao sei", e uma string vazia viraria um balaio onde todos os
 * exercicios anonimos compartilhariam o mesmo historico.
 */
export function preencherSlugs(payload: StrengthPayload): StrengthPayload {
  return {
    ...payload,
    exercises: payload.exercises.map((ex) => {
      const slug = slugDoExercicio(ex.name, ex.exerciseId);
      return slug ? { ...ex, slug } : ex;
    }),
  };
}
