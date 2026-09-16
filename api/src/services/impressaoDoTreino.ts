import { createHash } from "node:crypto";

// Impressão digital do CONTEÚDO de um treino, usada para detectar duplicação
// no servidor (ver services/activities.ts). Esta função roda sobre o input
// cru do cliente, ANTES de o servidor enriquecer o payload (slugs de
// exercício, blocos de WOD interpretados, GPS processado) — o mesmo envio
// pode chegar ao servidor com as chaves em ordem diferente (não é o mesmo
// objeto JavaScript de uma requisição para outra), e `JSON.stringify` não
// garante ordem estável entre objetos com as mesmas chaves em ordens
// diferentes. Por isso as chaves são ordenadas recursivamente ANTES de
// serializar. Não troque isso por `JSON.stringify` direto: a rede de
// detecção passaria a não pegar nada, em silêncio, porque duas cópias do
// mesmo treino com chaves em ordens diferentes gerariam impressões
// diferentes.
//
// `undefined` e `null` são tratados como ausência de campo (removidos antes
// de serializar), para que "não mandou o campo" e "mandou o campo como
// null" produzam a mesma impressão — o cliente Android 1.2.0 pode omitir
// campos que uma versão mais nova envia como null, ou vice-versa.
//
// `durationSec` entra na impressão porque, para corrida e para aula, a
// duração É o conteúdo do treino — tirá-la faria duas corridas diferentes
// colidirem. As telas que MANDAM `durationSec` hoje o calculam a partir de
// um campo digitado pela pessoa, não de um cronômetro em andamento (ex.:
// app-android/src/screens/RegisterClassScreen.tsx:63,
// `Math.round(minN * 60)` sobre os minutos digitados) — um reenvio do mesmo
// clique manda o mesmo número. A corrida com GPS ao vivo
// (app-android/src/screens/LiveTrackScreen.tsx) É um cronômetro em
// andamento, mas ela não entra em conflito com essa premissa porque NÃO
// manda `durationSec` nenhum: manda `distanceM` e o percurso (`points` com
// carimbo de tempo), e é o servidor que deriva a duração dali, DEPOIS que
// esta impressão já foi calculada (`durationSec = track.elapsedTimeSec ||
// durationSec` em services/activities.ts:64). Se algum dia uma tela passar
// a mandar `durationSec` lido de um cronômetro em vez de campo digitado,
// essa premissa quebra e a impressão pode divergir entre o envio original e
// o retry, em silêncio: reavalie esta função antes de ligar essa tela à
// detecção de duplicação.
//
// `planLink` entra na impressão (Tarefa 3, 16/09/2026) porque `sessionDay`
// É conteúdo, não metadado: "esta é a sessão Dia A do meu plano" e "esta é a
// Dia B" são dois treinos diferentes mesmo com os mesmos exercícios, carga e
// reps — o que é comum quando dias do plano reusam os mesmos acessórios.
// Deixá-lo fora fazia o check-in de duas sessões distintas, feito em
// sequência (ex.: registrar o dia de ontem e o de hoje na mesma sentada),
// colidir e a segunda ser descartada em silêncio — um caso real de
// produção, não só de teste. Isso não enfraquece a proteção: um reenvio de
// verdade do MESMO check-in carrega o MESMO `sessionDay`, então a impressão
// continua batendo e a duplicata continua sendo pega; só deixa de engolir
// duas sessões genuinamente distintas.
//
// `startedAt` entra na impressão (emenda de 16/09/2026 ao desenho, depois da
// revisão da Tarefa 3) pelo mesmo motivo de `durationSec`: registro
// retroativo é plausível (a pessoa lança o treino de segunda e o de quarta
// na mesma sentada, mesma rotina, cada um com a sua data), e ambos são
// treinos DIFERENTES mesmo com conteúdo idêntico. A saída original do
// desenho era tirar `startedAt` informado da rede inteira, mas isso deixava
// o próprio registro retroativo SEM proteção — reenviar duas vezes o treino
// de segunda também ficaria fora da rede. Pôr `startedAt` na impressão
// resolve os dois: dias diferentes geram impressões diferentes (não colide
// mais), e um reenvio do MESMO registro carrega o MESMO `startedAt` (a
// proteção continua valendo). A premissa é a mesma de `durationSec`:
// pressupõe uma data ESCOLHIDA pela pessoa, não gerada no instante do
// envio — se uma tela passar a mandar `startedAt: new Date()` no momento de
// salvar, cada reenvio teria um valor diferente e a rede pararia de pegar
// aquele caminho, em silêncio. Hoje nenhuma tela do app manda `startedAt`
// na criação (verificado na revisão da Tarefa 3); reavalie esta premissa se
// isso mudar.
//
// IMPORTANTE: `startedAt` chega aqui como STRING (ISO), já normalizado pelo
// chamador — nunca como `Date`. `normalizar()` abaixo não trata `Date`
// especialmente: `Object.keys(new Date())` é `[]`, então um `Date` cru
// viraria `{}` na impressão, e DUAS DATAS DIFERENTES colidiriam na mesma
// impressão vazia — o oposto do que este campo existe para resolver, e em
// silêncio. Quem monta a entrada (`entradaDoTreino` em services/activities.ts)
// converte com `.toISOString()` antes de chamar `impressaoDoTreino`.

/** Entrada crua de um treino, tal como o cliente manda. */
export interface EntradaDoTreino {
  kind: string;
  sportId: string;
  durationSec?: number;
  payload: unknown;
  planLink?: { planVersion?: number; sessionDay?: string };
  /** Já normalizado para ISO string pelo chamador — nunca um `Date` cru (ver acima). */
  startedAt?: string;
}

/** Ordena as chaves de objetos recursivamente e remove `undefined`/`null`. */
function normalizar(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(normalizar);
  }
  if (valor !== null && typeof valor === "object") {
    const chaves = Object.keys(valor as Record<string, unknown>).sort();
    const normalizado: Record<string, unknown> = {};
    for (const chave of chaves) {
      const item = (valor as Record<string, unknown>)[chave];
      if (item === undefined || item === null) continue;
      normalizado[chave] = normalizar(item);
    }
    return normalizado;
  }
  return valor;
}

/**
 * Gera a impressão digital (sha256 hex) do conteúdo de um treino: mesmo
 * treino, mesma impressão — independente da ordem das chaves do payload.
 */
export function impressaoDoTreino(input: EntradaDoTreino): string {
  const normalizado = normalizar(input);
  const serializado = JSON.stringify(normalizado);
  return createHash("sha256").update(serializado).digest("hex");
}
