import { z } from "zod";
import { env } from "../../config/env.js";
import { getAIProvider, parseJson } from "./index.js";
import { blocoSchema, type Bloco } from "../../models/crossfit.js";
import { interpretarModo } from "../crossfit/interpretarModo.js";

/* Ler o quadro do box e montar os blocos.
 *
 * Montar um treino de CrossFit à mão é oito blocos de formulário para um
 * quadro que a pessoa leva vinte segundos para fotografar ou copiar. Isto
 * inverte: ela cola o quadro, e confere o que saiu.
 *
 * A REGRA que faz isto ser seguro: a leitura preenche o QUE ESTAVA NO QUADRO,
 * nunca o que a pessoa fez. "7 rounds + 1" e "6:24" não estão no quadro —
 * estão na cabeça dela. Um resultado inventado vira recorde falso no histórico,
 * e ela não teria como saber de onde veio. Carga idem: quadro de box quase
 * nunca prescreve peso.
 *
 * O texto original fica guardado de qualquer jeito (`quadro` no payload). Os
 * blocos são a interpretação; o texto é a fonte.
 *
 * ---------------------------------------------------------------------------
 * O que o v3 tirou das costas do modelo
 * ---------------------------------------------------------------------------
 *
 * Antes ele tinha que CLASSIFICAR: escolher entre seis tipos de bloco e um enum
 * de nove formatos, e acertar os dois. Agora ele só TRANSCREVE — copia o modo
 * como está escrito ("EMOM (1'15\") x 4") e separa os movimentos. Quem deduz
 * estrutura é `interpretarModo`, que é código, roda igual toda vez e não tem
 * temperatura.
 *
 * Menos decisão para o modelo é menos invenção, e é determinístico de graça.
 */

export const leituraDoQuadroSchema = z.object({
  /** Nome do box, quando aparece no quadro. */
  box: z.string().max(80).nullish(),
  /** "Relay", "in pairs", "em dupla" no quadro → 2. Ausente → 1. */
  tamanhoDoTime: z.number().int().min(1).max(20).default(1),
  blocos: z.array(blocoSchema).max(24),
  /** O que não deu para interpretar. Vazio quando leu tudo. */
  observacao: z.string().max(300).default(""),
});
export type LeituraDoQuadro = z.infer<typeof leituraDoQuadroSchema>;

const SYSTEM = `Você transcreve o quadro de uma aula de CrossFit para JSON, em português do Brasil.

Você TRANSCREVE, não interpreta. Não classifique o treino, não escolha categorias: copie o que está escrito e separe em blocos.

O QUE VOCÊ NÃO FAZ, NUNCA:
- Não invente RESULTADO. O campo "resultado" fica ausente, sempre. O quadro diz o que era para fazer; quanto a pessoa fez é ela quem informa depois.
- Não invente CARGA. Só preencha "carga" quando o peso está escrito. Quadro de box quase nunca prescreve peso.
- Não invente movimento, round ou tempo que não esteja no texto.

BLOCO = { "modo", "nome", "movimentos" }
- "modo": a linha que diz COMO o bloco funciona, copiada COMO ESTÁ ESCRITA: "AMRAP 6'", "EMOM (1'15\\") x 4", "FOR TIME 7'", "5 ROUNDS FOR TIME", "SKILL / STRENGTH", "REST 1'", "TABATA", "21-15-9", "WARM-UP".
  Não traduza, não normalize, não padronize. Se o quadro escreveu "AMRAP 8'", o modo é "AMRAP 8'".
- "nome": o rótulo da parte, quando existe: "BLOCO A", "Fran", "Relay". Ausente quando não há.
- Um REST entre partes é um BLOCO, com modo "REST 1'" e sem movimentos. Não é observação.

MOVIMENTO = { "nome", "volume", "carga", "series", "altura", "escopo" }
- "nome": SÓ o nome, sem número junto. "10 Bíceps Curl" → nome "Bíceps Curl".
  Mantenha a abreviação como está escrita: BJO continua "BJO", C2B continua "C2B". É como a pessoa chama.
- "volume": { "valor": número ou lista, "unidade": "reps" | "seg" | "metros" | "cal" }
  - "10 Pull Up" → { "valor": 10, "unidade": "reps" }
  - "21-15-9 Thruster" → { "valor": [21,15,9], "unidade": "reps" }
  - "100 Mts Run" → { "valor": 100, "unidade": "metros" }
  - "20 cal Row" → { "valor": 20, "unidade": "cal" }
  - "Rope Climb" sem número → sem "volume".
- "carga": { "rx": número, "rxF": número, "unidade": "kg" | "lb" }. "43/30 kg" → rx 43, rxF 30. Um peso só → só "rx".
- "series": o "3" de "3x10". Ausente quando não há.
- "altura": { "valor": 60, "unidade": "cm" } — box jump, wall ball, quando escrito.
- "escopo": "individual" (padrão) | "dividido" | "cada" | "junto"
  - "2 Rope Climb (cada)" → "cada"
  - "400m Run together" → "junto"
  - volume repartido entre o time ("Relay") → "dividido"

TAMANHO DO TIME: "Relay", "in pairs", "em dupla", "Together" no quadro → "tamanhoDoTime": 2. Sem indicação → 1.

QUANDO O QUADRO OFERECE ALTERNATIVA ("OU", "OR", "escolha"): traga as DUAS como blocos, e diga na observacao que eram alternativas. A pessoa apaga a que não fez.

O que não couber em bloco nenhum: deixe de fora e explique na observacao. É melhor um bloco a menos do que um bloco inventado.

Responda SOMENTE com JSON:
{"box":null,"tamanhoDoTime":1,"blocos":[...],"observacao":""}`;

/** Converte o texto do quadro em blocos. Não grava nada. */
export async function lerQuadro(
  texto: string,
  opts: { userId?: string } = {}
): Promise<LeituraDoQuadro> {
  const leitura = await getAIProvider().generate({
    system: SYSTEM,
    messages: [{ role: "user", content: `QUADRO DA AULA:\n\n${texto.trim()}` }],
    jsonMode: true,
    // Transcrição quer fidelidade, não invenção.
    temperature: 0.1,
    // Um quadro de aula inteiro vira oito blocos de JSON — muito mais saída
    // que uma resposta de coach, e os 25s padrão não bastam. Descobri rodando
    // o modelo de verdade: o mock respondia instantaneamente.
    //
    // 45s e não 60: o app desiste em 60s. Se o primeiro provedor gastasse 60
    // aqui, a cadeia nem chegaria a tentar o segundo — o app já teria
    // desistido, e a pessoa veria "o servidor demorou" num caso em que o
    // segundo provedor resolveria em 6 segundos.
    timeoutMs: 45_000,
    feature: "wod_import",
    userId: opts.userId,
  });

  const lido = parseJson(leitura, leituraDoQuadroSchema);

  // A estrutura sai daqui, não do modelo: mesma entrada, mesma leitura, sempre.
  return {
    ...lido,
    blocos: lido.blocos.map((b) => ({ ...semResultado(b), lido: interpretarModo(b.modo) })),
  };
}

/**
 * Rede de segurança para a regra mais importante.
 *
 * O prompt manda não preencher resultado, e modelo não obedece sempre. Um
 * resultado inventado não é só um número errado: ele entra no motor de
 * recordes e cria uma marca que a pessoa nunca fez, no histórico que ela usa
 * para saber se está evoluindo.
 *
 * No v2 isto só olhava bloco de metcon, porque só metcon tinha resultado. Agora
 * qualquer bloco pode ter — então a rede cobre todos.
 */
function semResultado(bloco: Bloco): Bloco {
  if (!bloco.resultado) return bloco;

  console.warn(`[quadro] a leitura inventou resultado em "${bloco.nome ?? bloco.modo}" — descartado`);
  return { ...bloco, resultado: null };
}

/** O provedor de IA está configurado? */
export function leituraDisponivel(): boolean {
  return !!env.geminiApiKey || !!env.groqApiKeys.length || !!env.openrouterApiKeys.length;
}
