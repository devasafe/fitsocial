// Registro do aparelho para push.
//
// Duas coisas moram aqui: pedir permissão na hora certa e manter o servidor
// sabendo em qual aparelho falar. O que é notificado, e quando, é decisão do
// backend — aqui só existe o cano.
//
// A permissão NÃO é pedida ao abrir o app. Um pedido de notificação na primeira
// tela, antes de a pessoa entender o que o app faz, é o pedido que ela nega —
// e no iOS negar é definitivo: não dá para perguntar de novo, só mandar a
// pessoa nas Configurações do sistema. Por isso o pedido sai de dentro das
// Configurações do app, quando ela mesma liga a chave.

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { registrarAparelho, removerAparelho } from "../api/push";
import { MARCA } from "../marca";

/** Guardado para conseguir cancelar o registro na saída da conta. */
let tokenAtual: string | null = null;

// Com o app aberto, uma notificação que chega ainda aparece — senão quem está
// no Feed nunca fica sabendo do comentário que acabou de chegar.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export type EstadoDaPermissao = "concedida" | "negada" | "indisponivel";

export async function estadoDoPush(): Promise<EstadoDaPermissao> {
  if (!Device.isDevice) return "indisponivel"; // emulador não recebe push
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted" ? "concedida" : "negada";
}

/**
 * Pede permissão (se ainda não foi decidida) e registra o aparelho.
 *
 * Devolve o estado final para a tela poder explicar o que aconteceu — inclusive
 * o caso em que a pessoa já negou antes e o sistema nem mostra o diálogo.
 */
export async function ligarPush(authToken: string): Promise<EstadoDaPermissao> {
  if (!Device.isDevice) return "indisponivel";

  try {
    const atual = await Notifications.getPermissionsAsync();
    const status =
      atual.status === "granted"
        ? atual.status
        : (await Notifications.requestPermissionsAsync()).status;

    if (status !== "granted") return "negada";

    // O Android só entrega em algum canal; sem declarar um, a notificação chega
    // muda e sem vibrar.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: `Avisos do ${MARCA}`,
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const id = projectId();
    if (!id) {
      // Acontece em build sem projeto EAS configurado. Falhar em silêncio aqui
      // esconderia a causa real de "o push não chega".
      console.warn("[push] sem projectId do EAS — o token não pode ser emitido");
      return "indisponivel";
    }

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await registrarAparelho(authToken, data, Platform.OS === "ios" ? "ios" : "android");
    tokenAtual = data;
    return "concedida";
  } catch (err) {
    console.warn(`[push] não deu para registrar: ${(err as Error).message}`);
    return "indisponivel";
  }
}

/**
 * Reconfirma o registro de quem já autorizou.
 *
 * Chamado ao abrir o app: o token do Expo pode mudar (reinstalação, restauro de
 * backup), e um token velho no servidor é um push que sai para o nada.
 */
export async function reconfirmarPush(authToken: string): Promise<void> {
  if ((await estadoDoPush()) !== "concedida") return;
  await ligarPush(authToken);
}

/** Sair da conta neste aparelho para de mandar push para ele. */
export async function desligarPush(authToken: string): Promise<void> {
  if (!tokenAtual) return;
  try {
    await removerAparelho(authToken, tokenAtual);
  } catch {
    /* melhor esforço: o servidor descarta o token quando o Expo o recusar */
  }
  tokenAtual = null;
}
