// Paginação por cursor (keyset) ordenada por (startedAt desc, _id desc).
// Convenção do projeto: listas que podem crescer usam cursor, nunca offset.

export interface Cursor {
  startedAt: Date;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ s: c.startedAt.toISOString(), i: c.id })).toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString());
    const startedAt = new Date(o.s);
    if (Number.isNaN(startedAt.getTime()) || typeof o.i !== "string") return null;
    return { startedAt, id: o.i };
  } catch {
    return null;
  }
}

/** Mesma ideia, mas ordenado por `createdAt` — usado nas listas do painel.
 *  As funções acima continuam servindo `startedAt` (atividades). */
export interface CursorCriacao {
  createdAt: Date;
  id: string;
}

export function encodeCursorCriacao(c: CursorCriacao): string {
  return Buffer.from(JSON.stringify({ c: c.createdAt.toISOString(), i: c.id })).toString("base64url");
}

export function decodeCursorCriacao(raw: string): CursorCriacao | null {
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString());
    const createdAt = new Date(o.c);
    if (Number.isNaN(createdAt.getTime()) || typeof o.i !== "string") return null;
    return { createdAt, id: o.i };
  } catch {
    return null;
  }
}
