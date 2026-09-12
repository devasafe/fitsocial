import AsyncStorage from "@react-native-async-storage/async-storage";

// O convite que chegou antes da conta existir.
//
// O caso principal do link NÃO é o aluno que já usa o RUMO — é o que nunca
// ouviu falar dele e recebeu o link do professor no WhatsApp. Esse abre a
// página, cai no cadastro, cria a conta... e o convite se perderia no caminho,
// deixando a pessoa dentro de um app que ela não sabe por que instalou.
//
// Guardar o código atravessa o cadastro inteiro: registro, escolha de usuário e
// onboarding. Quando ela finalmente chega, a tela de aceite está esperando.

const CHAVE = "rumo.convite.pendente";

export async function guardarConvite(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE, code.toUpperCase().trim());
  } catch {
    // Armazenamento bloqueado: o link ainda funciona para quem já está logado,
    // que é o caminho em que ele não precisa sobreviver a nada.
  }
}

export async function lerConvitePendente(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export async function limparConvite(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CHAVE);
  } catch {
    /* nada a fazer */
  }
}

/**
 * Lê o código de um link, seja qual for a forma.
 *
 * Aceita `/convite/ABC123`, `#/convite/ABC123` e `rumo://convite/ABC123`
 * porque os três vão circular: o painel gera um, alguém cola outro, e um link
 * que não abre é um aluno que não entra.
 */
export function codigoDoLink(url: string): string | null {
  const m = url.match(/convite\/([A-Za-z0-9]{4,12})/);
  return m ? m[1].toUpperCase() : null;
}
