/**
 * Corta um texto num limite, sem partir palavra, e marca o corte com reticências.
 *
 * Existe porque a ressalva que a IA escreve sobre um prato é exibida inteira na
 * tela, sem `numberOfLines` — terminar em "…feito com óle" parece defeito do
 * app, e não a escolha deliberada que é. As reticências também servem de marca
 * no log: quem lê sabe que houve corte, em vez de suspeitar do modelo.
 *
 * O resultado nunca passa de `limite` caracteres.
 */
export function cortarEm(texto: string, limite: number): string {
  if (limite <= 1) return texto.slice(0, Math.max(limite, 0));
  if (texto.length <= limite) return texto;

  // -1 abre espaço para o "…", que conta como um caractere.
  const bruto = texto.slice(0, limite - 1);
  const ultimoEspaco = bruto.lastIndexOf(" ");

  // Só recua até a fronteira de palavra se ela não jogar fora metade do texto:
  // uma palavra única e enorme (uma URL colada, por exemplo) não deve virar
  // apenas reticências.
  const corte = ultimoEspaco > limite / 2 ? bruto.slice(0, ultimoEspaco) : bruto;

  return `${corte.trimEnd()}…`;
}
