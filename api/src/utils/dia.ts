// O banco guarda tudo em UTC; quem lê o painel vive em São Paulo. A conversão
// acontece aqui, na borda do cálculo, como manda o CLAUDE.md.
//
// Sem isto, uma pessoa que se cadastra às 22h de terça aparece como quarta —
// e o gráfico de ontem muda de valor conforme a hora em que você olha.

export const FUSO = "America/Sao_Paulo";

/** yyyy-mm-dd no fuso de São Paulo. */
export function chaveDoDia(quando: Date = new Date()): string {
  // en-CA formata como yyyy-mm-dd, que é exatamente o formato que guardamos.
  return quando.toLocaleDateString("en-CA", { timeZone: FUSO });
}

/** Os últimos N dias, do mais antigo ao mais recente, incluindo hoje. */
export function ultimosDias(n: number, ate: Date = new Date()): string[] {
  const dias: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    dias.push(chaveDoDia(new Date(ate.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return dias;
}

/** Instante a partir do qual buscar, para cobrir N dias inteiros em São Paulo.
 *  Vai um dia a mais para trás de propósito: o corte do dia em SP não coincide
 *  com o corte em UTC, e faltar dado na ponta é pior que ler um pouco a mais. */
export function inicioDaJanela(dias: number, ate: Date = new Date()): Date {
  return new Date(ate.getTime() - dias * 24 * 60 * 60 * 1000);
}

/** Estágio de agrupamento por dia, no fuso certo. Usado por toda agregação. */
export function agruparPorDia(campo: string) {
  return { $dateToString: { format: "%Y-%m-%d", date: `$${campo}`, timezone: FUSO } };
}
