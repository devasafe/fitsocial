/**
 * Escapa o texto para usar dentro de uma expressão regular.
 *
 * Sem isto, "a+" e "(" viram sintaxe de regex: o primeiro muda o que a busca
 * encontra, e o segundo derruba a consulta com erro. E um ".*" digitado por
 * curiosidade vira uma varredura da coleção inteira.
 *
 * Estava copiado em `routes/admin/users.ts` e `routes/social.ts`, e o CRUD de
 * coleções ia ser a terceira cópia — três lugares com a mesma linha é onde um
 * deles fica para trás.
 */
export function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
