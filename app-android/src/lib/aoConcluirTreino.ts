// O que acontece depois que um treino é salvo — um lugar só.
//
// Isto vivia copiado em sete telas de registro (força, endurance, aula,
// genérico, CrossFit, GPS e o check-in do plano), e as cópias já tinham
// divergido: duas não celebravam recorde, duas não perguntavam a privacidade,
// e todas navegavam direto para o compositor de post. Quem acabava de salvar
// caía numa tela de escrever legenda sem nenhuma confirmação de que o treino
// tinha sido salvo — e quem tocava "Agora não" voltava para as abas sem ver
// nada. Era a maior fonte de confusão do registro.
//
// Agora existe um destino: a tela de treino concluído, onde compartilhar é uma
// escolha e não o caminho do meio.
//
// A pergunta de privacidade NÃO sai daqui: ela é um modal, e modal por cima de
// uma tela que acabou de dizer "Treino concluído" são duas confirmações
// disputando a mesma atenção. Ela é disparada quando a pessoa SAI da tela de
// conclusão — ver `TreinoConcluidoScreen`.

import { useCallback } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePRCelebration } from "../components/PRCelebration";
import type { Activity, NewPR } from "../api/activities";
import type { AppStackParams } from "../navigation/types";

export type ConcluirTreinoFn = (activity: Activity, newPRs?: NewPR[]) => void;

/** `const concluirTreino = useConclusaoDeTreino()` — chame com o que a API devolveu. */
export function useConclusaoDeTreino(): ConcluirTreinoFn {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const celebratePR = usePRCelebration();

  return useCallback(
    (activity, newPRs = []) => {
      // O banner de recorde desliza por cima da tela de conclusão. Ele vive num
      // provider acima do navegador justamente para sobreviver a esta troca.
      celebratePR(newPRs);
      // `replace`, e não `navigate`: o formulário sai da pilha. O treino já
      // está salvo, e voltar para lá só serviria para salvá-lo de novo — não
      // dependemos de o intercept de "voltar" rodar para impedir a duplicata.
      // De quebra, a tela de GPS desmonta na hora e solta o `watchPosition` em
      // vez de segurar a assinatura enquanto a pessoa decide se publica.
      nav.replace("TreinoConcluido", { activity, newPRs });
    },
    [nav, celebratePR]
  );
}
