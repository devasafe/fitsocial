// Código curto que uma pessoa lê em voz alta e digita sem errar.
//
// Extraído de `ProfessionalInvite.gerarCodigoDeConvite`, que já usava este
// alfabeto, para o cupom não nascer com uma segunda cópia dele. O `joinCode`
// dos desafios usa o mesmo — são três lugares, e o alfabeto é a razão de
// existir da função.

/**
 * Sem I, O, 0 e 1.
 *
 * Não é preciosismo: o código vai ser ditado por telefone e escrito em story
 * de Instagram. "I" e "1" são o mesmo risco em muitas fontes, e "O" e "0" só
 * se distinguem com sorte.
 */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Um código aleatório de `tamanho` caracteres. Não verifica colisão. */
export function codigoAleatorio(tamanho = 6): string {
  let codigo = "";
  for (let i = 0; i < tamanho; i++) {
    codigo += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return codigo;
}

/**
 * Um código que ainda não existe, conferindo com quem pergunta.
 *
 * Tenta de novo em caso de colisão em vez de confiar na sorte — com 32^6 são
 * mil milhões de possibilidades, mas "improvável" não é "impossível", e o
 * índice único recusaria a gravação bem longe daqui.
 */
export async function codigoInedito(
  jaExiste: (codigo: string) => Promise<boolean>,
  tamanho = 6
): Promise<string> {
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const codigo = codigoAleatorio(tamanho);
    if (!(await jaExiste(codigo))) return codigo;
  }
  throw new Error("Não foi possível gerar um código único");
}

/**
 * O código como ele deve ser guardado e comparado.
 *
 * Um lugar só, porque o cupom chega por três caminhos — cadastro, checkout e
 * painel — e "joao10" tem de ser o mesmo cupom que "JOAO 10" em todos eles.
 */
export function normalizarCodigo(bruto: string): string {
  return bruto.trim().toUpperCase().replace(/\s+/g, "");
}
