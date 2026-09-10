import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";

/* O nome do produto vive em env.appName, e só lá.
 *
 * Centralizar uma vez não adianta: o próximo texto novo escreve o nome à mão e
 * a centralização morre em silêncio — o rebranding seguinte volta a ser uma
 * caçada por 100 ocorrências. Este teste é o que faz a regra durar.
 *
 * Ele olha só o que a pessoa lê. Nome de banco, package Android, chaves de
 * armazenamento e identificadores de infraestrutura continuam com o nome
 * antigo de propósito: trocá-los quebraria instalação e sessão de quem já usa.
 */

const RAIZ = join(import.meta.dirname, "..");

/** Onde o nome aparece por motivo legítimo, e não deve ser trocado. */
const PERMITIDOS = new Set([
  join(RAIZ, "config", "env.ts"), // a própria definição
  join(RAIZ, "config", "marca.test.ts"), // este teste
]);

function arquivosDeCodigo(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      out.push(...arquivosDeCodigo(caminho));
    } else if (nome.endsWith(".ts") && !nome.endsWith(".test.ts")) {
      out.push(caminho);
    }
  }
  return out;
}

/** Tira comentários: o nome numa explicação é documentação, não interface. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("o nome do produto fica num lugar só", () => {
  it("nenhum texto de código escreve o nome à mão", () => {
    const culpados: string[] = [];

    for (const caminho of arquivosDeCodigo(RAIZ)) {
      if (PERMITIDOS.has(caminho)) continue;
      const fonte = semComentarios(readFileSync(caminho, "utf8"));
      if (fonte.includes(env.appName)) {
        culpados.push(caminho.slice(RAIZ.length + 1).replace(/\\/g, "/"));
      }
    }

    expect(
      culpados,
      `Escreva \${env.appName} em vez do nome. Achei em: ${culpados.join(", ")}`
    ).toEqual([]);
  });

  it("o remetente do e-mail acompanha o nome, sem repetir a string", () => {
    expect(env.mailFromName).toBe(env.appName);
    expect(env.mailFrom).toContain(env.appName);
  });
});
