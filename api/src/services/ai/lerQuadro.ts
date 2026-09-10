import { z } from "zod";
import { env } from "../../config/env.js";
import { getAIProvider, parseJson } from "./index.js";
import { blocoSchema, type Bloco } from "../../models/crossfit.js";

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
 * blocos são a interpretação; o texto é a fonte. */

export const leituraDoQuadroSchema = z.object({
  /** Nome do box, quando aparece no quadro. */
  box: z.string().max(80).nullish(),
  blocos: z.array(blocoSchema).max(24),
  /** O que não deu para interpretar. Vazio quando leu tudo. */
  observacao: z.string().max(300).default(""),
});
export type LeituraDoQuadro = z.infer<typeof leituraDoQuadroSchema>;

const SYSTEM = `Você converte o quadro de uma aula de CrossFit em JSON estruturado, em português do Brasil.

O QUE VOCÊ NÃO FAZ, NUNCA:
- Não invente RESULTADO. Os campos "resultado" ficam ausentes, sempre. O quadro diz o que era para fazer; quanto a pessoa fez é ela quem informa depois.
- Não invente CARGA. Só preencha "carga" quando o peso está escrito no quadro. Quadro de box quase nunca prescreve peso.
- Não invente movimento, round ou tempo que não esteja no texto.

BLOCOS (campo "tipo"):
- "aquecimento" | "mobilidade" | "cooldown": lista de movimentos. Aceita "formato" ("emom" | "circuito" | "livre"), "intervaloSec", "rounds", "duracaoSec".
- "skill": praticar UM movimento. Campo "movimento" (string). "formato" pode ser "emom" | "pratica_livre" | "series".
- "forca": levantamento com séries. Campo "exercicios": [{ "name": string, "sets": [{ "weightKg": number, "reps": number }] }]. Só use se o quadro trouxer as séries.
- "metcon": o WOD. Campos "formato" ("for_time" | "amrap" | "emom" | "rft" | "tabata" | "intervalo" | "max_reps" | "max_load" | "outro"), "nome", "prescricao" e "escala".
- "descanso": o REST entre partes. Só "duracaoSec".

DENTRO DE "metcon":
- "prescricao": { "rounds", "duracaoSec", "timeCapSec", "intervaloSec", "movimentos": [...] }.
  - AMRAP 8' → formato "amrap", duracaoSec 480.
  - FOR TIME 7' → formato "for_time", timeCapSec 420.
  - EMOM (1'15") x 4 → formato "emom", intervaloSec 75, rounds 4.
- "escala": { "nivel": "rx" } — use "rx" quando o quadro não disser outra coisa.
- "equipe": SÓ quando o quadro indicar dupla/equipe ("Relay", "in pairs", "em dupla", "Together"). Formato { "tamanho": 2, "modo": "revezamento" | "junto" | "dividido" }. "Relay" = revezamento; "Together" = junto.
- "grupo": quando o quadro agrupa várias partes sob um WOD só ("Bloco A", "Bloco B", "Parte 1"), use o MESMO rótulo curto nas partes, ex. "WOD".

MOVIMENTOS: { "nome", "reps", "repScheme" ([21,15,9]), "distanciaM", "calorias", "duracaoSec", "carga", "porPessoa" }
- "100 Mts Run" → { "nome": "Run", "distanciaM": 100 }
- "20 cal Row" → { "nome": "Row", "calorias": 20 }
- "2 Rope Climb (cada)" → { "nome": "Rope Climb", "reps": 2, "porPessoa": true }
- Mantenha a abreviação como está escrita: BJO continua "BJO", C2B continua "C2B". É como a pessoa chama.

QUANDO O QUADRO OFERECE ALTERNATIVA ("OU", "OR", "escolha"): traga as DUAS como blocos, e diga na observacao que eram alternativas. A pessoa apaga a que não fez.

O que não couber em bloco nenhum: deixe de fora e explique na observacao. É melhor um bloco a menos do que um bloco inventado.

Responda SOMENTE com JSON:
{"box":null,"blocos":[...],"observacao":""}`;

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
  return { ...lido, blocos: lido.blocos.map(semResultado) };
}

/**
 * Rede de segurança para a regra mais importante.
 *
 * O prompt manda não preencher resultado, e modelo não obedece sempre. Um
 * resultado inventado não é só um número errado: ele entra no motor de
 * recordes e cria uma marca que a pessoa nunca fez, no histórico que ela usa
 * para saber se está evoluindo.
 */
function semResultado(bloco: Bloco): Bloco {
  if (bloco.tipo !== "metcon") return bloco;
  if (!bloco.resultado) return bloco;

  console.warn(`[quadro] a leitura inventou resultado em "${bloco.nome ?? "metcon"}" — descartado`);
  return { ...bloco, resultado: null };
}

/** O provedor de IA está configurado? */
export function leituraDisponivel(): boolean {
  return !!env.geminiApiKey || !!env.groqApiKeys.length || !!env.openrouterApiKeys.length;
}
