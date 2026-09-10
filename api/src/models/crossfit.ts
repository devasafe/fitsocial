import { z } from "zod";
import { strengthExerciseSchema } from "./strength.js";

// Modelo de um treino de CrossFit: blocos, na ordem em que aconteceram.
//
// Vive num arquivo próprio porque é o formato mais rico do projeto e Activity.ts
// já carrega outros quatro. Ver docs/superpowers/specs/2026-09-10-crossfit-design.md.

// ---- Carga ----------------------------------------------------------------
//
// Nem todo movimento tem carga, e quando tem nem sempre é em quilos: "70 lb",
// "50% do 1RM", "peso corporal" e "caixa de 20 in" são todos respostas válidas
// para "quanto?". `valorKg` é derivado no servidor quando dá para converter — é
// ele que o PR e os gráficos comparam, sem reinterpretar unidade a cada leitura.

export const UNIDADES_DE_CARGA = ["kg", "lb", "percent_1rm", "corporal", "livre"] as const;

export const cargaSchema = z.object({
  valor: z.number().min(0).max(10_000).nullish(),
  unidade: z.enum(UNIDADES_DE_CARGA).default("kg"),
  /** Para o que não é número: "caixa de 20 in", "colete de 10 kg". */
  texto: z.string().max(60).nullish(),
  valorKg: z.number().min(0).max(10_000).nullish(),
});
export type Carga = z.infer<typeof cargaSchema>;

// ---- Movimento ------------------------------------------------------------
//
// A peça que faltava. O formato antigo só sabia nome + carga + reps + tempo, e
// com isso "21-15-9", "400m Run" e "20 cal Row" não cabiam.

export const movimentoSchema = z.object({
  nome: z.string().min(1).max(80),
  /** Repetições fixas por round. */
  reps: z.number().int().min(0).max(100_000).nullish(),
  /** Repetições que MUDAM a cada round: [21, 15, 9]. */
  repScheme: z.array(z.number().int().min(0).max(10_000)).max(30).nullish(),
  distanciaM: z.number().min(0).max(100_000).nullish(),
  calorias: z.number().int().min(0).max(10_000).nullish(),
  duracaoSec: z.number().int().min(0).max(36_000).nullish(),
  /** A carga que a PESSOA usou. O quadro quase nunca prescreve peso; quando
   *  prescreve e ela escalou, isso vive em `escala.ajustes`. */
  carga: cargaSchema.nullish(),
  /**
   * "2 Rope Climb (cada)" — em treino de dupla, cada um faz a conta inteira,
   * em vez de dividirem.
   *
   * Só faz sentido com `equipe` preenchida; sozinho não muda nada.
   */
  porPessoa: z.boolean().nullish(),
  notas: z.string().max(300).nullish(),
});
export type Movimento = z.infer<typeof movimentoSchema>;

// ---- Equipe ---------------------------------------------------------------
//
// Metade do quadro de um box é em dupla, e o esforço não é o mesmo: 20
// Chest-to-Bar revezados entre dois não é 20 sozinho. Por isso o resultado de
// equipe NÃO entra no mesmo recorde do individual — ver services/prEngine.ts.

export const MODOS_DE_EQUIPE = [
  /** "Relay": um trabalha enquanto o outro descansa. */
  "revezamento",
  /** "Together": fazem ao mesmo tempo, contam junto. */
  "junto",
  /** Dividem a conta como quiserem: 40 burpees viram 20 e 20. */
  "dividido",
] as const;

export const equipeSchema = z.object({
  tamanho: z.number().int().min(2).max(20),
  modo: z.enum(MODOS_DE_EQUIPE),
  /** Quem estava junto. Texto livre: nem todo parceiro tem conta no app. */
  parceiros: z.array(z.string().min(1).max(80)).max(20).nullish(),
});
export type Equipe = z.infer<typeof equipeSchema>;

// ---- Escala ---------------------------------------------------------------
//
// Duas pessoas fazem o mesmo WOD e só uma faz RX. O nível vai para o PR (é o que
// impede comparar Fran RX com Fran scaled) e os ajustes registram O QUE mudou —
// que é o que o enum sozinho nunca soube dizer.

// "adaptado" é legado do formato antigo. Fica aceito porque já existe
// recorde gravado com essa chave — converter para "custom" criaria uma
// linha nova ao lado da antiga, e a pessoa veria o recorde duplicado.
export const NIVEIS_DE_ESCALA = [
  "rx",
  "rx_plus",
  "scaled",
  "iniciante",
  "custom",
  "adaptado",
] as const;

export const escalaSchema = z.object({
  nivel: z.enum(NIVEIS_DE_ESCALA).default("rx"),
  ajustes: z
    .array(z.object({ de: z.string().min(1).max(80), para: z.string().min(1).max(80) }))
    .max(12)
    .nullish(),
  notas: z.string().max(300).nullish(),
});
export type Escala = z.infer<typeof escalaSchema>;

// ---- Score ----------------------------------------------------------------
//
// O resultado. `valor` e `maiorMelhor` NÃO vêm do cliente: são derivados no
// servidor (services/crossfit.ts), senão dois apps em versões diferentes
// gravariam números que não se comparam.

export const TIPOS_DE_SCORE = ["tempo", "rounds_reps", "reps", "carga", "distancia"] as const;

export const scoreSchema = z.object({
  tipo: z.enum(TIPOS_DE_SCORE),
  tempoSec: z.number().int().min(0).max(86_400).nullish(),
  rounds: z.number().min(0).max(10_000).nullish(),
  /** As reps do round incompleto: o "+12" de "7 + 12". */
  repsExtras: z.number().int().min(0).max(100_000).nullish(),
  reps: z.number().int().min(0).max(100_000).nullish(),
  cargaKg: z.number().min(0).max(1000).nullish(),
  distanciaM: z.number().min(0).max(1_000_000).nullish(),
  /**
   * Estourou o time cap.
   *
   * Quando é true o tipo NÃO é "tempo": não existe tempo final, existe o quanto
   * deu para fazer. É o caso que o formato antigo não sabia representar.
   */
  capado: z.boolean().nullish(),
});
export type Score = z.infer<typeof scoreSchema>;

// ---- Blocos ---------------------------------------------------------------

export const TIPOS_DE_BLOCO = [
  "aquecimento",
  "mobilidade",
  "skill",
  "forca",
  "metcon",
  "descanso",
  "cooldown",
] as const;

export const FORMATOS_LIVRES = ["emom", "circuito", "livre"] as const;

/** Aquecimento, mobilidade e cooldown têm a mesma forma: a diferença é o rótulo. */
export const blocoLivreSchema = z.object({
  tipo: z.enum(["aquecimento", "mobilidade", "cooldown"]),
  /**
   * Aquecimento tem estrutura, não é lista solta: "EMOM 1'15\" × 4" é o
   * formato mais comum de warm-up de box. Sem isto, o intervalo virava nota e
   * a pessoa acabava registrando o aquecimento como se fosse WOD.
   */
  formato: z.enum(FORMATOS_LIVRES).nullish(),
  /** EMOM = 60; o "1'15" do quadro = 75. */
  intervaloSec: z.number().int().min(0).max(3600).nullish(),
  duracaoSec: z.number().int().min(0).max(36_000).nullish(),
  rounds: z.number().int().min(0).max(100).nullish(),
  movimentos: z.array(movimentoSchema).max(30).default([]),
  notas: z.string().max(1000).nullish(),
});

/**
 * O REST entre as partes do WOD.
 *
 * Existia descanso DENTRO de um metcon (o work/rest de um Tabata), não entre
 * blocos — e "REST 1'" aparece em quase todo quadro com mais de uma parte.
 * Virava nota solta, e some da linha do tempo do treino.
 */
export const blocoDescansoSchema = z.object({
  tipo: z.literal("descanso"),
  duracaoSec: z.number().int().min(0).max(7200).nullish(),
  notas: z.string().max(300).nullish(),
});

/** Praticar um movimento. `melhorSequencia` é o que vira recorde de skill. */
export const blocoSkillSchema = z.object({
  tipo: z.literal("skill"),
  movimento: z.string().min(1).max(80),
  formato: z.enum(["emom", "pratica_livre", "series"]).nullish(),
  duracaoSec: z.number().int().min(0).max(36_000).nullish(),
  intervaloSec: z.number().int().min(0).max(3600).nullish(),
  series: z.number().int().min(0).max(200).nullish(),
  repsPorSerie: z.number().int().min(0).max(10_000).nullish(),
  /** "8 de 10 rounds completos" — tentativas=10, acertos=8. */
  tentativas: z.number().int().min(0).max(1000).nullish(),
  acertos: z.number().int().min(0).max(1000).nullish(),
  /** "35 unbroken". */
  melhorSequencia: z.number().int().min(0).max(100_000).nullish(),
  carga: cargaSchema.nullish(),
  notas: z.string().max(1000).nullish(),
});

/**
 * Força — o mesmo schema da musculação, sem uma linha nova.
 *
 * É o que faz série a série (Set 1 a 80 kg, Set 2 a 85…) e o motor de PR de 1RM
 * funcionarem aqui de graça, em vez de duplicar entidade.
 */
export const blocoForcaSchema = z.object({
  tipo: z.literal("forca"),
  exercicios: z.array(strengthExerciseSchema).min(1).max(20),
  notas: z.string().max(1000).nullish(),
});

export const FORMATOS_DE_METCON = [
  "for_time",
  "amrap",
  "emom",
  "rft",
  "tabata",
  "intervalo",
  "max_reps",
  "max_load",
  "outro",
] as const;

export const FAMILIAS_DE_BENCHMARK = ["girl", "hero", "open", "outro"] as const;

export const blocoMetconSchema = z.object({
  tipo: z.literal("metcon"),
  nome: z.string().max(80).nullish(),
  /** Identidade estável do benchmark — é por ela que "Fran" compara com "Fran". */
  benchmark: z
    .object({
      slug: z.string().min(1).max(60),
      familia: z.enum(FAMILIAS_DE_BENCHMARK).default("outro"),
    })
    .nullish(),
  formato: z.enum(FORMATOS_DE_METCON),
  formatoLivre: z.string().max(60).nullish(),

  /** O que estava escrito no quadro. Separado do que aconteceu. */
  prescricao: z.object({
    rounds: z.number().int().min(0).max(1000).nullish(),
    duracaoSec: z.number().int().min(0).max(36_000).nullish(),
    timeCapSec: z.number().int().min(0).max(36_000).nullish(),
    /** EMOM = 60, E2MOM = 120, "every 3 min" = 180. */
    intervaloSec: z.number().int().min(0).max(3600).nullish(),
    trabalhoSec: z.number().int().min(0).max(3600).nullish(),
    descansoSec: z.number().int().min(0).max(3600).nullish(),
    /** A ordem do array é a ordem do treino — é o que preserva um chipper. */
    movimentos: z.array(movimentoSchema).max(40).default([]),
  }),

  resultado: scoreSchema.nullish(),
  escala: escalaSchema.default({ nivel: "rx" }),
  /** Preenchido quando foi em dupla ou equipe. Ausente = individual. */
  equipe: equipeSchema.nullish(),
  /**
   * Junta partes do MESMO WOD.
   *
   * "AMRAP + FOR TIME" com Bloco A, descanso, Bloco B, descanso e um final é
   * um treino só com três partes — e três resultados. Blocos que compartilham
   * este rótulo aparecem juntos; a ordem no array dá o número da parte.
   */
  grupo: z.string().min(1).max(40).nullish(),
  /** Tempo ou reps por round. Opcional: alimenta análise de pacing depois. */
  rounds: z
    .array(
      z.object({
        numero: z.number().int().min(1).max(1000),
        tempoSec: z.number().int().min(0).max(36_000).nullish(),
        reps: z.number().int().min(0).max(100_000).nullish(),
      })
    )
    .max(100)
    .nullish(),
  notas: z.string().max(1000).nullish(),
});

export const blocoSchema = z.discriminatedUnion("tipo", [
  blocoLivreSchema.extend({ tipo: z.literal("aquecimento") }),
  blocoLivreSchema.extend({ tipo: z.literal("mobilidade") }),
  blocoLivreSchema.extend({ tipo: z.literal("cooldown") }),
  blocoDescansoSchema,
  blocoSkillSchema,
  blocoForcaSchema,
  blocoMetconSchema,
]);
export type Bloco = z.infer<typeof blocoSchema>;

// ---- O payload ------------------------------------------------------------

export const wodPayloadV2Schema = z.object({
  v: z.literal(2),
  box: z.string().max(80).nullish(),
  // 12 era pouco para um quadro com aquecimento, skill, tres partes de WOD e
  // os descansos entre elas.
  blocos: z.array(blocoSchema).min(1).max(24),
});
export type WodPayloadV2 = z.infer<typeof wodPayloadV2Schema>;
