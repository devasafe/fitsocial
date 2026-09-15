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
