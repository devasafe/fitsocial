import mongoose from "mongoose";

/** Só o que a reconstrução de autoria precisa de cada versão do plano. */
export interface VersaoParaAutoria {
  diet?: unknown;
  createdBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

/** Quem escreveu a dieta corrente, e quando. */
export interface AutoriaDaDieta {
  createdBy: string | null;
  em: string | null;
}

/**
 * De quem é a dieta que está valendo — não de quem é a versão que está valendo.
 *
 * `createdBy`/`createdAt` são um por DOCUMENTO (`models/Plan.ts`), não um por
 * metade do plano. `PUT /alunos/:id/treino` cria uma versão nova a cada
 * prescrição de treino e COPIA a dieta corrente para ela com o `createdBy` do
 * treinador — a versão mais nova pode ter o treinador como autor e uma dieta
 * que o nutricionista escreveu semanas antes. Ler `createdBy`/`createdAt`
 * direto da versão mais nova, como a rota fazia, atribui a dieta a quem por
 * acaso prescreveu o treino por último.
 *
 * A resposta está no próprio histórico de versões: a dieta foi escrita na
 * versão mais antiga, dentre as recentes, em que ela ainda é igual à de hoje.
 * `versoes` já vem da mais nova para a mais velha (é o `.sort({version:-1})`
 * que a rota faz); aqui só se caminha para trás enquanto a dieta não muda.
 *
 * Comparação por `JSON.stringify`: a cópia feita por `PUT /treino` é
 * `atual?.diet ?? null`, o mesmo valor repassado, então a igualdade entre a
 * cópia e o original é exata — não há edição no meio do caminho. O chamador
 * deve buscar `versoes` com `.lean()`, para que o valor de `diet` seja sempre
 * o mesmo tipo de objeto plano dos dois lados da comparação; comparar um
 * documento Mongoose hidratado contra um lean, mesmo com conteúdo igual,
 * arriscaria depender de como o Mongoose expõe internamente um campo
 * `Mixed`.
 */
export function autoriaDaDieta(versoes: readonly VersaoParaAutoria[]): AutoriaDaDieta {
  const atual = versoes[0];
  if (!atual || atual.diet == null) return { createdBy: null, em: null };

  const dietaAtual = JSON.stringify(atual.diet);
  let origem = atual;
  for (let i = 1; i < versoes.length; i++) {
    if (JSON.stringify(versoes[i]!.diet) !== dietaAtual) break;
    origem = versoes[i]!;
  }

  return {
    createdBy: origem.createdBy?.toString() ?? null,
    em: origem.createdAt.toISOString(),
  };
}
