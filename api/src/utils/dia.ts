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

/**
 * O dia da semana em São Paulo: 0=domingo … 6=sábado.
 *
 * Quem calcula é o servidor, e não o aparelho, por três razões. Tudo que diz
 * "hoje" neste backend já é servidor em SP (água, sequência, `FoodLog.date`) —
 * um weekday vindo do cliente faria "treino de hoje" e "calorias de hoje"
 * discordarem na mesma tela. O relógio do aparelho é entrada controlável pelo
 * usuário, e plano de treino é artefato de saúde: um relógio só. E é o que
 * permite avisar "seu treino de hoje é X" sem um segundo relógio.
 *
 * Derivado de `chaveDoDia` de propósito: a conversão de fuso já está resolvida
 * ali, e refazê-la com aritmética de -3 quebraria no dia em que o Brasil
 * resolver ter horário de verão de novo.
 */
export function diaDaSemana(quando: Date = new Date()): number {
  const [ano, mes, dia] = chaveDoDia(quando).split("-").map(Number);
  // Meio-dia UTC: longe das duas bordas do dia, então nenhum arredondamento
  // empurra a data para o dia vizinho.
  return new Date(Date.UTC(ano!, mes! - 1, dia!, 12)).getUTCDay();
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
