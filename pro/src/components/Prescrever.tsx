import { useState } from "react";
import { ErroApi, prescrever, type SessaoPrescrita } from "../api";

/**
 * O formulário de prescrição.
 *
 * O coach escreve como escreve no caderno: um bloco por dia, uma linha por
 * exercício. A linha é texto livre no formato "Supino reto 4x8-12 90s" porque
 * exigir quatro campos por exercício transformaria montar um treino de seis
 * exercícios em vinte e quatro tabulações — e o coach voltaria para o WhatsApp.
 *
 * O que a API precisa (séries como número, descanso em segundos) sai daqui
 * interpretado, e o que não for entendido vira padrão visível na tela, nunca
 * um erro que obriga a reescrever tudo.
 */

const PADRAO_SERIES = 3;
const PADRAO_REPS = "10-12";
const PADRAO_DESCANSO = 60;

interface LinhaLida {
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string;
}

/** "Supino reto 4x8-12 90s" → {name, sets, reps, restSeconds}. */
export function lerLinha(linha: string): LinhaLida | null {
  const texto = linha.trim();
  if (!texto) return null;

  let resto = texto;
  let sets = PADRAO_SERIES;
  let reps = PADRAO_REPS;
  let restSeconds = PADRAO_DESCANSO;

  // Descanso: "90s", "2min" — tirado primeiro para não confundir com repetição.
  const descanso = resto.match(/(\d+)\s*(s|seg|min|m)\b/i);
  if (descanso) {
    const n = Number(descanso[1]);
    restSeconds = /^m/i.test(descanso[2]) ? n * 60 : n;
    resto = resto.replace(descanso[0], " ");
  }

  // Séries x repetições: "4x8", "4x8-12", "3 x 10".
  const series = resto.match(/(\d+)\s*[xX]\s*([\d\-–a-zA-Zçã]+)/);
  if (series) {
    sets = Math.min(Math.max(Number(series[1]), 1), 20);
    reps = series[2].replace("–", "-");
    resto = resto.replace(series[0], " ");
  }

  const name = resto.replace(/\s+/g, " ").trim();
  if (!name) return null;

  return { name, sets, reps, restSeconds, notes: "" };
}

/** Cada bloco vira uma sessão: primeira linha é o título, o resto são exercícios. */
export function lerTreino(texto: string): SessaoPrescrita[] {
  return texto
    .split(/\n\s*\n/)
    .map((bloco) => {
      const linhas = bloco.split("\n").map((l) => l.trim()).filter(Boolean);
      if (linhas.length < 2) return null;

      const [titulo, ...resto] = linhas;
      const exercises = resto.map(lerLinha).filter((e): e is LinhaLida => e !== null);
      if (exercises.length === 0) return null;

      // "A — Peito e tríceps" → day "A — Peito e tríceps", focus "Peito e tríceps"
      const foco = titulo.split(/[—–-]/).slice(1).join("-").trim();
      return { day: titulo, focus: foco || titulo, exercises };
    })
    .filter((s): s is SessaoPrescrita => s !== null);
}

const EXEMPLO = `A — Peito e tríceps
Supino reto 4x8-12 90s
Supino inclinado 3x10 60s
Tríceps pulley 3x12 45s

B — Costas e bíceps
Puxada frente 4x10 90s
Remada curvada 4x8 90s
Rosca direta 3x12 45s`;

export function Prescrever({
  token,
  alunoId,
  aoSalvar,
}: {
  token: string;
  alunoId: string;
  aoSalvar: () => void;
}) {
  const [resumo, setResumo] = useState("");
  const [texto, setTexto] = useState("");
  const [split, setSplit] = useState("AB");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  const sessions = lerTreino(texto);
  const totalExercicios = sessions.reduce((s, x) => s + x.exercises.length, 0);

  async function salvar() {
    if (sessions.length === 0) {
      setErro("Escreva pelo menos um bloco: um título e uma linha de exercício abaixo dele.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await prescrever(token, alunoId, resumo.trim() || "Treino prescrito.", {
        split: split.trim() || "Treino",
        daysPerWeek: Math.min(Math.max(sessions.length, 1), 7),
        sessions,
      });
      setSalvo(true);
      setTexto("");
      setResumo("");
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar o treino.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="campo">
        <label htmlFor="resumo">Recado do treino</label>
        <input
          id="resumo"
          value={resumo}
          onChange={(e) => setResumo(e.target.value)}
          placeholder="Semana de adaptação, foco em técnica."
          maxLength={500}
        />
      </div>

      <div className="campo">
        <label htmlFor="split">Divisão</label>
        <input
          id="split"
          value={split}
          onChange={(e) => setSplit(e.target.value)}
          placeholder="AB, ABC, full body…"
          maxLength={60}
        />
      </div>

      <div className="campo">
        <label htmlFor="treino">
          O treino — um bloco por dia, linha em branco entre os blocos
        </label>
        <textarea
          id="treino"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setSalvo(false);
          }}
          placeholder={EXEMPLO}
          rows={12}
          style={{ fontFamily: "var(--corpo)" }}
        />
        <p className="sub" style={{ marginTop: 6 }}>
          Escreva como no caderno: <b>Supino reto 4x8-12 90s</b>. O que faltar entra como{" "}
          {PADRAO_SERIES}x{PADRAO_REPS} e {PADRAO_DESCANSO}s.
        </p>
      </div>

      {/* A prévia é o contrato: mostra o que VAI ser salvo, e não o que foi
          digitado. É onde o coach descobre que uma linha não foi entendida,
          antes de o aluno receber o treino com ela faltando. */}
      {texto.trim() && (
        <div className="painel" style={{ marginBottom: 16 }}>
          <b>Como o aluno vai ver</b>
          {sessions.length === 0 ? (
            <p className="erro" style={{ marginBottom: 0 }}>
              Nenhum bloco reconhecido. Cada bloco precisa de um título e pelo menos uma linha de
              exercício embaixo.
            </p>
          ) : (
            <>
              <p className="sub">
                {sessions.length} {sessions.length === 1 ? "dia" : "dias"} · {totalExercicios}{" "}
                exercícios
              </p>
              {sessions.map((s, i) => (
                <div key={i} style={{ marginTop: 12 }}>
                  <b>{s.day}</b>
                  {s.exercises.map((e, j) => (
                    <div key={j} className="sub">
                      {e.name} — {e.sets}x{e.reps} · {e.restSeconds}s
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
      {salvo && <p style={{ color: "var(--verde-claro)" }}>Treino enviado para o aluno.</p>}

      <button className="primario" onClick={salvar} disabled={salvando || sessions.length === 0}>
        {salvando ? "Enviando…" : "Enviar treino"}
      </button>
    </div>
  );
}
