// O app roda em fit.satriz.club através do react-native-web, e lá nada disto
// existe: expo-notifications não emite token do Expo no navegador, e importar o
// módulo quebraria o bundle web inteiro.
//
// Quando o web push entrar (VAPID + service worker), é este arquivo que ganha
// implementação — a interface já é a mesma, e nenhuma tela muda.

export type EstadoDaPermissao = "concedida" | "negada" | "indisponivel";

export async function estadoDoPush(): Promise<EstadoDaPermissao> {
  return "indisponivel";
}

export async function ligarPush(_authToken: string): Promise<EstadoDaPermissao> {
  return "indisponivel";
}

export async function reconfirmarPush(_authToken: string): Promise<void> {}

export async function desligarPush(_authToken: string): Promise<void> {}
