import { z } from "zod";

// Modelo de um treino de CrossFit: blocos, na ordem em que aconteceram.
//
// Vive num arquivo próprio porque é o formato mais rico do projeto e Activity.ts
// já carrega outros quatro.
//
// ---------------------------------------------------------------------------
// v3 — o que o coach escreveu manda; a estrutura é derivada
// ---------------------------------------------------------------------------
//
// O v2 pedia que a pessoa escolhesse o tipo do bloco (aquecimento, skill,
// força, metcon) e o formato (amrap, for_time, emom…) em dois enums, no
// cadastro. Dois problemas, os dois reais:
//
//   1. O texto do quadro se perdia. Escolhido o enum, não dava mais para saber
//      o que estava escrito lá — e portanto não dava para reinterpretar depois.
//      Todo treino ficava congelado no entendimento do dia em que foi salvo.
//   2. O enum é pedágio. "EMOM (1'15\") x 4" não é nenhuma das opções, e a
//      pessoa era obrigada a mentir ou desistir.
//
// No v3 o `modo` é texto livre e é a FONTE DA VERDADE. O interpretador lê e
// escreve o que entendeu em `lido`, que é cache: quando o interpretador
// melhorar, roda de novo por cima do `modo` e todo treino antigo melhora junto.
//
// Ver docs/superpowers/specs/2026-09-11-cadastro-de-treino-briefing.md.
// A regra que governa tudo, de lá: **o campo nunca bloqueia. A estrutura é
// bônus, não pedágio.**

// ---- Carga ----------------------------------------------------------------
//
// Nem todo movimento tem carga, e quando tem nem sempre é em quilos: "70 lb",
// "50% do 1RM", "peso corporal" e "caixa de 20 in" são todos respostas válidas
// para "quanto?".
//
// `rx` e `rxF` são as duas prescrições do quadro — o "43/30" escrito lá. Dois
// campos, e não um texto "43/30", porque com um campo só o app nunca consegue
// mostrar o peso certo para cada atleta nem ranquear por categoria, e essa
// porta não reabre depois sem migração.
//
// Os campos `*Kg` são derivados no servidor quando dá para converter — são eles
// que o PR e os gráficos comparam, sem reinterpretar unidade a cada leitura.

export const UNIDADES_DE_CARGA = ["kg", "lb", "percent_1rm", "corporal", "livre"] as const;

export const cargaSchema = z.object({
  /** A prescrição principal. No quadro misto "43/30", é o 43. */
  rx: z.number().min(0).max(10_000).nullish(),
  /** A segunda prescrição do quadro. No "43/30", é o 30. */
  rxF: z.number().min(0).max(10_000).nullish(),
  unidade: z.enum(UNIDADES_DE_CARGA).default("kg"),
  /** Para o que não é número: "caixa de 20 in", "colete de 10 kg". */
  texto: z.string().max(60).nullish(),
  rxKg: z.number().min(0).max(10_000).nullish(),
  rxFKg: z.number().min(0).max(10_000).nullish(),
});
export type Carga = z.infer<typeof cargaSchema>;

// ---- Volume ---------------------------------------------------------------
//
// O v2 tinha cinco campos anuláveis — `reps`, `repScheme`, `distanciaM`,
// `calorias`, `duracaoSec` — onde exatamente um deveria estar preenchido. Toda
// leitura precisava testar os cinco na ordem certa, e nada impedia dois ao
// mesmo tempo.
//
// Aqui é um campo com unidade. `valor` aceita lista porque "21-15-9" é uma
// escada, e escada colada tem que virar escada — não três movimentos.

export const UNIDADES_DE_VOLUME = ["reps", "seg", "metros", "cal"] as const;

export const volumeSchema = z.object({
  valor: z.union([
    z.number().min(0).max(100_000),
    z.array(z.number().min(0).max(10_000)).min(1).max(30),
  ]),
  unidade: z.enum(UNIDADES_DE_VOLUME).default("reps"),
});
export type Volume = z.infer<typeof volumeSchema>;

// ---- Escopo ---------------------------------------------------------------
//
// Metade do quadro de um box é em dupla, e o esforço não é o mesmo: 20
// Chest-to-Bar revezados entre dois não é 20 sozinho.
//
// No v2 isto vivia no BLOCO (`equipe.modo`), com um booleano `porPessoa` no
// movimento. Por isso o quadro mais comum de todos — "400m Run together, 2
// Rope Climb cada, 40 BJO" no MESMO bloco — não cabia: o bloco só aceitava um
// modo para todos os movimentos.
//
// Aqui o escopo é de cada movimento. É o que muda a matemática do volume total
// e do ranking; sem ele o app conta errado qualquer treino de dupla.

export const ESCOPOS = [
  /** Cada um faz o volume cheio. É o padrão, e o único que existe sozinho. */
  "individual",
  /** O volume é repartido entre o time ("Relay"): 40 burpees viram 20 e 20. */
  "dividido",
  /** O volume é POR atleta: total = valor × tamanho do time. */
  "cada",
  /** Fazem ao mesmo tempo e conta uma vez ("together"). */
  "junto",
] as const;
export type Escopo = (typeof ESCOPOS)[number];

// ---- Movimento ------------------------------------------------------------

export const movimentoSchema = z.object({
  /**
   * O nome, e SÓ o nome.
   *
   * O número não pode entrar aqui. Num campo só, o autocomplete acumula
   * "10 Bíceps Curl", "12 Bíceps Curl" e "15 Bíceps Curl" como exercícios
   * distintos, e o catálogo da pessoa apodrece em um mês. Quem junta os dois é
   * a exibição, na hora de mostrar.
   */
  nome: z.string().min(1).max(80),
  /** Opcional de verdade: "Rope Climb" sem número é um movimento válido. */
  volume: volumeSchema.nullish(),
  /** O "3" de "3×10". Prescrição; o que saiu série a série é outro fluxo. */
  series: z.number().int().min(0).max(200).nullish(),
  carga: cargaSchema.nullish(),
  /** Box jump, wall ball: a altura é prescrição, não observação. */
  altura: z
    .object({
      valor: z.number().min(0).max(500),
      unidade: z.enum(["cm", "in"]).default("cm"),
    })
    .nullish(),
  escopo: z.enum(ESCOPOS).default("individual"),
  notas: z.string().max(300).nullish(),
});
export type Movimento = z.infer<typeof movimentoSchema>;

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

export const TIPOS_DE_SCORE = [
  "tempo",
  "rounds_reps",
  "reps",
  "carga",
  "distancia",
  /** "soma do pior round", "3 tentativas de 5" — o que não cabe nos de cima. */
  "customizado",
] as const;

export const scoreSchema = z.object({
  tipo: z.enum(TIPOS_DE_SCORE),
  tempoSec: z.number().int().min(0).max(86_400).nullish(),
  rounds: z.number().min(0).max(10_000).nullish(),
  /** As reps do round incompleto: o "+12" de "7 + 12". */
  repsExtras: z.number().int().min(0).max(100_000).nullish(),
  reps: z.number().int().min(0).max(100_000).nullish(),
  cargaKg: z.number().min(0).max(1000).nullish(),
  distanciaM: z.number().min(0).max(1_000_000).nullish(),
  /** Só para `customizado`: o que esse número quer dizer. */
  descricao: z.string().max(120).nullish(),
  /**
   * Estourou o time cap.
   *
   * Quando é true o tipo NÃO é "tempo": não existe tempo final, existe o quanto
   * deu para fazer. É o caso que o formato antigo não sabia representar.
   */
  capado: z.boolean().nullish(),
});
export type Score = z.infer<typeof scoreSchema>;

// ---- Leitura --------------------------------------------------------------
//
// O que o interpretador entendeu do `modo`. DERIVADO e descartável: nada aqui
// é fonte de nada, e apagar tudo não perde informação — basta reinterpretar.
//
// `versao` existe para isso: quando o interpretador melhorar, uma varredura
// acha todo bloco lido por versão antiga e reinterpreta. É o que o v2 não
// permitia, porque lá o entendimento era a única cópia.

export const FAMILIAS_DE_MODO = [
  "amrap",
  "for_time",
  "rft",
  "emom",
  "tabata",
  "intervalo",
  "max_reps",
  "max_load",
  "descanso",
  /** Reconhecido como "sem estrutura de tempo": aquecimento, mobilidade, skill solto. */
  "livre",
] as const;
export type FamiliaDeModo = (typeof FAMILIAS_DE_MODO)[number];

/** A versão do interpretador. Subir aqui marca todo bloco antigo para releitura. */
export const VERSAO_DO_INTERPRETADOR = 1;

export const leituraSchema = z.object({
  familia: z.enum(FAMILIAS_DE_MODO).nullish(),
  duracaoSec: z.number().int().min(0).max(36_000).nullish(),
  timeCapSec: z.number().int().min(0).max(36_000).nullish(),
  /** EMOM = 60, E2MOM = 120, o "1'15\"" do quadro = 75. */
  intervaloSec: z.number().int().min(0).max(3600).nullish(),
  rounds: z.number().int().min(0).max(1000).nullish(),
  /** Sugestão, sempre sobrescrevível pela pessoa. `null` = ela escolhe. */
  scoreSugerido: z.enum([...TIPOS_DE_SCORE, "nenhum"]).nullish(),
  versao: z.number().int().min(0).max(1000).default(VERSAO_DO_INTERPRETADOR),
});
export type Leitura = z.infer<typeof leituraSchema>;

// ---- Bloco ----------------------------------------------------------------
//
// Sem tipo no topo. Um bloco é um MODO e uma lista de movimentos — o que
// diferencia aquecimento de WOD é o que está escrito no modo, e o
// interpretador deduz o resto.
//
// O motor de PR mudou de pergunta junto com isto: em vez de "isso é metcon?",
// ele pergunta "isso tem resultado?". Aquecimento nunca tem resultado, logo
// nunca vira recorde — sem precisar de rótulo nenhum.

export const blocoSchema = z.object({
  /** O que o coach escreveu: "AMRAP 6'", "EMOM (1'15\") x 4", "REST 1'". */
  modo: z.string().min(1).max(120),
  /** "BLOCO A", "Fran", "Relay". Opcional. */
  nome: z.string().max(80).nullish(),
  /** Identidade estável do benchmark — é por ela que "Fran" compara com "Fran". */
  benchmark: z
    .object({
      slug: z.string().min(1).max(60),
      familia: z.enum(["girl", "hero", "open", "outro"]).default("outro"),
    })
    .nullish(),
  /** A ordem do array é a ordem do treino — é o que preserva um chipper. */
  movimentos: z.array(movimentoSchema).max(40).default([]),
  /** Escrito no salvamento pelo interpretador. Nunca vem do cliente. */
  lido: leituraSchema.nullish(),
  resultado: scoreSchema.nullish(),
  escala: escalaSchema.default({ nivel: "rx" }),
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
export type Bloco = z.infer<typeof blocoSchema>;

// ---- O payload ------------------------------------------------------------

export const wodPayloadSchema = z.object({
  v: z.literal(3),
  nome: z.string().max(80).nullish(),
  box: z.string().max(80).nullish(),
  /**
   * O quadro, do jeito que estava escrito.
   *
   * Guardado sempre, mesmo quando os blocos foram montados a partir dele: os
   * blocos são a INTERPRETAÇÃO, este texto é a fonte. Se a leitura errar, ou
   * se o formato do box não couber em bloco nenhum, o treino continua
   * registrável — e daqui a um ano ainda dá para saber o que o coach escreveu.
   */
  quadro: z.string().max(4000).nullish(),
  /** 1 = individual. Acima disso, o escopo de cada movimento passa a importar. */
  tamanhoDoTime: z.number().int().min(1).max(20).default(1),
  /** Quem estava junto. Texto livre: nem todo parceiro tem conta no app. */
  parceiros: z.array(z.string().min(1).max(80)).max(20).nullish(),
  /**
   * 24 cabe um quadro com aquecimento, skill, três partes de WOD e os
   * descansos entre elas.
   *
   * Sem mínimo: um treino colado do quadro cujo texto a leitura não conseguiu
   * interpretar continua sendo um treino. O que não pode é vir vazio dos dois
   * jeitos — daí o refine abaixo.
   */
  blocos: z.array(blocoSchema).max(24).default([]),
});
export type WodPayload = z.infer<typeof wodPayloadSchema>;

/** O que a borda valida: ou tem bloco, ou tem o quadro escrito. Vazio dos dois
 *  lados não é treino nenhum. */
export const wodPayloadEntrada = wodPayloadSchema.refine(
  (p) => p.blocos.length > 0 || !!p.quadro?.trim(),
  { message: "Monte ao menos um bloco, ou cole o quadro do treino" }
);
