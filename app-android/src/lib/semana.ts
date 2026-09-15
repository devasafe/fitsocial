// Os dias da semana como o app os escreve. 0=domingo … 6=sábado, a mesma
// numeração que `session.weekdays` usa no servidor.

export const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

export const DIAS_LONGOS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

/** "Terça-feira" — para o cabeçalho da tela, que fala do dia inteiro. */
export function diaPorExtenso(dia: number): string {
  const nome = DIAS_LONGOS[dia] ?? "";
  return nome ? `${nome[0]!.toUpperCase()}${nome.slice(1)}` : "";
}

/**
 * "terça-feira", a partir de um `yyyy-mm-dd` cru.
 *
 * Meio-dia de propósito: `new Date("2026-09-15")` é parseado como UTC e, no
 * fuso de São Paulo, volta um dia — o app falaria do dia errado bem na frase
 * que existe para dizer em que dia ele está gravando.
 *
 * Mora aqui, e não em cada tela, porque três lugares dizem o mesmo dia para a
 * mesma pessoa no mesmo fluxo: o sheet de registro rápido, o convite da
 * evolução da nutrição e a tela da foto do prato. Duas grafias do mesmo dia
 * seriam piores que nenhuma.
 */
export function diaDaSemana(dia: string): string {
  return new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long" });
}
