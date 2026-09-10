import { z } from "zod";
import { env } from "../../config/env.js";
import { getAIProvider, parseJson } from "./index.js";
import { AIError } from "./provider.js";
import { NUTRITION_KNOWLEDGE } from "./knowledgeBase.js";

/* Estimar uma refeição a partir da foto do prato.
 *
 * O que isto é: um chute informado. Um modelo de visão reconhece "arroz branco"
 * e estima a porção pelo tamanho aparente em relação ao prato e aos talheres.
 * O que isto NÃO é: uma balança. Ângulo, profundidade da tigela, quanto de óleo
 * foi na panela — nada disso está na foto.
 *
 * Por isso a saída vem com `confianca` por item e nada é gravado aqui: quem
 * confirma é a pessoa, na tela seguinte. Um erro de 30% que entra calado no
 * total do dia desanda a dieta sem ela nunca entender por quê. */

/** Um alimento identificado no prato. */
export const itemDaFotoSchema = z.object({
  nome: z.string().min(1).max(80),
  /** Porção estimada em gramas (ou ml, para líquidos). */
  gramas: z.number().min(0).max(5000),
  kcal: z.number().min(0).max(5000),
  proteinaG: z.number().min(0).max(500),
  carboG: z.number().min(0).max(500),
  gorduraG: z.number().min(0).max(500),
  /** Quão claro o alimento está na foto. Baixa = a pessoa precisa conferir. */
  confianca: z.enum(["alta", "media", "baixa"]),
});

export const analiseDaFotoSchema = z.object({
  /** Vazio quando não há comida na foto — e aí a tela diz isso, sem inventar. */
  itens: z.array(itemDaFotoSchema).max(15),
  /** Uma frase sobre o que ficou incerto. Vazia quando não há ressalva. */
  observacao: z.string().max(200).default(""),
});

export type ItemDaFoto = z.infer<typeof itemDaFotoSchema>;
export type AnaliseDaFoto = z.infer<typeof analiseDaFotoSchema>;

const SYSTEM = `Você analisa a foto de uma refeição e estima o que tem nela, em português do Brasil.

${NUTRITION_KNOWLEDGE}

REGRAS:
- Liste apenas os alimentos que você REALMENTE vê. Não complete o prato com o que "costuma vir junto".
- Estime a porção em gramas usando as referências da foto: tamanho do prato (26 cm em média), talheres, copo, mão.
- Os macros devem ser coerentes com as gramas estimadas: proteína e carboidrato têm 4 kcal/g, gordura tem 9 kcal/g. A soma dos macros × essas densidades tem que ficar perto do kcal que você declarar.
- Marque confianca "baixa" quando o alimento estiver parcialmente escondido, quando o preparo mudar muito as calorias (frito ou grelhado? com quanto de óleo?), ou quando você não conseguir julgar a porção.
- Molhos, óleo de preparo e açúcar de bebida contam. Se suspeitar deles e não puder medir, diga na observacao.
- Se a foto não tiver comida, devolva itens vazio e explique na observacao.
- NÃO invente precisão: é melhor "media" com uma ressalva do que "alta" errado.

Responda SOMENTE com JSON neste formato:
{"itens":[{"nome":"arroz branco cozido","gramas":150,"kcal":193,"proteinaG":3.6,"carboG":42,"gorduraG":0.4,"confianca":"alta"}],"observacao":"Não dá para saber quanto de óleo foi no frango."}`;

/** Analisa a foto de um prato. Não grava nada — quem confirma é a pessoa. */
export async function analisarRefeicao(
  imagem: { base64: string; mimeType: string },
  opts: { userId?: string; dica?: string } = {}
): Promise<AnaliseDaFoto> {
  const provider = getAIProvider();

  // A pergunta acompanha a foto: sem texto, o modelo não sabe que formato
  // devolver, e o zod da camada de cima recusaria a resposta.
  const pergunta = opts.dica?.trim()
    ? `O que tem neste prato? A pessoa disse que é: ${opts.dica.trim()}`
    : "O que tem neste prato?";

  const raw = await provider.generate({
    system: SYSTEM,
    messages: [{ role: "user", content: pergunta }],
    imagem,
    jsonMode: true,
    // Estimativa quer consistência, não criatividade.
    temperature: 0.2,
    feature: "meal_photo",
    userId: opts.userId,
  });

  const analise = parseJson(raw, analiseDaFotoSchema);
  return { ...analise, itens: analise.itens.map(coerente) };
}

/**
 * Reconcilia kcal com os macros.
 *
 * Modelos de linguagem erram aritmética com frequência, e um item com 20 g de
 * proteína marcado como 500 kcal quebra o total do dia de um jeito que a pessoa
 * não consegue diagnosticar. Quando a conta dos macros diverge mais de 25% do
 * kcal declarado, o kcal derivado dos macros ganha — ele é verificável.
 */
function coerente(item: ItemDaFoto): ItemDaFoto {
  const dosMacros = item.proteinaG * 4 + item.carboG * 4 + item.gorduraG * 9;
  if (dosMacros <= 0) return item;

  const diferenca = Math.abs(dosMacros - item.kcal) / Math.max(dosMacros, 1);
  if (diferenca <= 0.25) return item;

  return { ...item, kcal: Math.round(dosMacros), confianca: "baixa" };
}

/** Erro amigável quando nenhum modelo configurado enxerga. */
export function exigirModeloComVisao(): void {
  if (!getAIProvider().aceitaImagem) {
    throw new AIError(
      `A análise por foto precisa de um modelo que enxergue. Configure GEMINI_API_KEY (atual: ${env.aiProvider}).`,
      false,
      "credencial"
    );
  }
}
