// Quando o servidor diz "este treino eu já tenho".
//
// O servidor reconhece envio repetido de duas formas (ver `acharRepeticao` em
// api/src/services/activities.ts): pela CHAVE que o app manda, e — para quem
// não a manda — por uma impressão do conteúdo numa janela de dez minutos. Nos
// dois casos ele responde 200 devolvendo o treino que já existe, em vez de
// gravar outro.
//
// Quase sempre isso é o certo e invisível: a pessoa tocou em salvar duas vezes,
// e vê um treino salvo, que é a verdade. Mas a rede pode errar — dois treinos
// com exatamente os mesmos exercícios, pesos e repetições em menos de dez
// minutos existem, e são raros, não impossíveis. Sem este aviso, o segundo
// some sem nada na tela: a pessoa vê "Treino concluído" e vai embora achando
// que registrou, e só descobre depois que o histórico não bate.
//
// Por isso a pergunta. Ela só aparece quando o servidor reconheceu repetição,
// e a saída (`mesmoAssim`) manda gravar assim mesmo.

import { confirmDialog } from "./notify";

/**
 * Se o servidor reconheceu repetição, pergunta se era outro treino; se a
 * pessoa disser que sim, reenvia com `mesmoAssim` e devolve o que veio de lá.
 *
 * Devolve a resposta que a tela deve usar dali em diante — a original quando
 * não houve repetição (ou quando a pessoa confirmou que já estava registrado),
 * a do reenvio quando ela disse que era outro.
 */
export async function resolverRepeticao<T>(
  resposta: T,
  foiRepetido: boolean | undefined,
  reenviarComMesmoAssim: () => Promise<T>
): Promise<T> {
  if (!foiRepetido) return resposta;

  const querRegistrarAssimMesmo = await new Promise<boolean>((resolve) => {
    confirmDialog(
      "Este treino já estava registrado",
      "Mostramos o que já existe. Se este foi outro treino, dá para registrar assim mesmo.",
      () => resolve(true),
      "Foi outro treino",
      // Os DOIS caminhos precisam resolver — foi por isto que `confirmDialog`
      // ganhou um `onCancel`. Sem ele, dizer "não" deixaria esta promessa
      // pendurada para sempre, e a tela nunca sairia do estado de salvando.
      () => resolve(false)
    );
  });

  return querRegistrarAssimMesmo ? reenviarComMesmoAssim() : resposta;
}
