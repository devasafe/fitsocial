import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { buscarAvisos, type Avisos } from "../api/pro";

/**
 * O acompanhamento, do ponto de vista de quem é acompanhado.
 *
 * Uma pergunta só para três coisas que a Home precisa saber ao mesmo tempo:
 * convite esperando resposta, mensagem não lida, e QUEM é o profissional desta
 * pessoa — porque é isso que decide se a Home mostra o coach de IA ou o
 * treinador de verdade.
 *
 * Vive num hook, e não dentro do cartão, porque dois componentes precisam do
 * mesmo dado e dois `setInterval` batendo na mesma rota seria pagar duas vezes
 * pela mesma resposta. Quem chama é a Home; ela distribui.
 *
 * Atualiza sozinho enquanto a tela está na frente da pessoa: `useFocusEffect`
 * já garante que só roda com a Home aberta, e o `AppState` cuida do resto — app
 * em segundo plano não gasta bateria batendo na API. Vinte segundos porque aqui
 * ninguém está esperando resposta; é aviso que pode chegar com meio minuto de
 * atraso sem prejuízo nenhum.
 */
const DE_QUANTO_EM_QUANTO_MS = 20_000;

export const SEM_ACOMPANHAMENTO: Avisos = { convites: [], conversas: [], profissionais: [] };

/**
 * `carregado` existe porque "ainda não sei" e "não tem treinador" deixaram de
 * ser a mesma coisa.
 *
 * Enquanto era só aviso pendente, começar vazio não custava nada. Agora é este
 * dado que decide QUEM a Home diz que cuida do seu treino — e, sem separar os
 * dois estados, toda abertura da Home piscava o cartão da IA e a oferta de
 * gerar um plano antes de a resposta chegar.
 */
export interface Acompanhamento extends Avisos {
  carregado: boolean;
}

export function useAcompanhamento(): Acompanhamento {
  const { token } = useAuth();
  const [avisos, setAvisos] = useState<Avisos>(SEM_ACOMPANHAMENTO);
  const [carregado, setCarregado] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;

      // Silencioso de propósito: é um extra da Home, e uma falha aqui não pode
      // encher a tela de erro sobre algo que talvez nem exista.
      const buscar = () => {
        if (AppState.currentState !== "active") return;
        buscarAvisos(token!)
          .then((r) => {
            if (!vivo) return;
            setAvisos(r);
            setCarregado(true);
          })
          // Guarda o último valor conhecido, que é o certo para um poll: uma
          // falha de rede não pode fazer o treinador de alguém desaparecer da
          // tela e trazer de volta os botões que reescreveriam o treino dele.
          .catch(() => {});
      };

      buscar();
      const relogio = setInterval(buscar, DE_QUANTO_EM_QUANTO_MS);
      // Voltar para o app é quando mais provavelmente há algo novo.
      const sub = AppState.addEventListener("change", (estado) => {
        if (estado === "active") buscar();
      });

      return () => {
        vivo = false;
        clearInterval(relogio);
        sub.remove();
      };
    }, [token])
  );

  return { ...avisos, carregado };
}

/** O treinador desta pessoa, se houver. É quem escreve o treino dela. */
export function treinadorDe(avisos: Avisos) {
  return avisos.profissionais.find((p) => p.papel === "coach") ?? null;
}
