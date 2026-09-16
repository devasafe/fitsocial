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

/** Entrada crua de um treino, tal como o cliente manda. */
export interface EntradaDoTreino {
  kind: string;
  sportId: string;
  durationSec: number;
  payload: unknown;
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
