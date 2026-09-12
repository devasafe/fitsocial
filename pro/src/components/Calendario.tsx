import { useMemo } from "react";
import type { DiaDoCalendario } from "../api";

// O calendário do ano, no formato que todo mundo já sabe ler.
//
// É a mesma informação do heatmap do aluno, e existe aqui pelo mesmo motivo:
// constância se lê nos BURACOS, não nos treinos. Uma lista de datas não mostra
// as três semanas em que ninguém apareceu; esta grade mostra.

const DIAS_DA_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Quatro níveis, como no app: 0 / 1 / 2 / 3+. */
function nivel(treinos: number): 0 | 1 | 2 | 3 {
  if (treinos <= 0) return 0;
  if (treinos === 1) return 1;
  if (treinos === 2) return 2;
  return 3;
}

/** `2026-09-12` sem passar pelo fuso do navegador — meio-dia não vira ontem. */
function comoData(dia: string): Date {
  return new Date(`${dia}T12:00:00`);
}

interface Celula {
  dia: string | null;
  treinos: number;
  minutos: number;
}

export function Calendario({ dias }: { dias: DiaDoCalendario[] }) {
  const semanas = useMemo<Celula[][]>(() => {
    if (dias.length === 0) return [];

    // Completa até o domingo anterior ao primeiro dia, senão a primeira coluna
    // fica deslocada e a leitura por linha ("toda segunda") deixa de valer.
    const vazias = comoData(dias[0].dia).getDay();
    const celulas: Celula[] = [
      ...Array.from({ length: vazias }, () => ({ dia: null, treinos: 0, minutos: 0 })),
      ...dias.map((d) => ({ dia: d.dia, treinos: d.treinos, minutos: d.minutos })),
    ];

    const out: Celula[][] = [];
    for (let i = 0; i < celulas.length; i += 7) out.push(celulas.slice(i, i + 7));
    return out;
  }, [dias]);

  if (semanas.length === 0) return <p className="vazio">Sem dias nesta janela.</p>;

  const total = dias.reduce((s, d) => s + d.treinos, 0);

  return (
    <div>
      <div className="calendario">
        <div className="calendario-legenda-dias">
          {DIAS_DA_SEMANA.map((d, i) => (
            // Só ímpares têm rótulo: sete letras coladas viram ruído.
            <span key={i}>{i % 2 === 1 ? d : ""}</span>
          ))}
        </div>

        {/* Rola na horizontal em vez de espremer o ano: um quadradinho de 3px
            não é clicável nem legível, e o coach quer ver o padrão. */}
        <div className="calendario-rolagem">
          <div className="calendario-meses">
            {semanas.map((semana, i) => {
              const primeiro = semana.find((c) => c.dia);
              const data = primeiro ? comoData(primeiro.dia!) : null;
              const anterior = semanas[i - 1]?.find((c) => c.dia);
              const mudouDeMes =
                data != null &&
                (anterior == null || comoData(anterior.dia!).getMonth() !== data.getMonth());
              return <span key={i}>{mudouDeMes ? MESES[data!.getMonth()] : ""}</span>;
            })}
          </div>

          <div className="calendario-grade">
            {semanas.map((semana, i) => (
              <div key={i} className="calendario-semana">
                {semana.map((c, j) =>
                  c.dia ? (
                    <div
                      key={c.dia}
                      className={`calendario-dia n${nivel(c.treinos)}`}
                      title={`${comoData(c.dia).toLocaleDateString("pt-BR")} · ${
                        c.treinos === 0
                          ? "sem treino"
                          : `${c.treinos} ${c.treinos === 1 ? "treino" : "treinos"}${
                              c.minutos > 0 ? ` · ${c.minutos} min` : ""
                            }`
                      }`}
                    />
                  ) : (
                    <div key={`vazio-${i}-${j}`} className="calendario-dia vazia" />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="sub" style={{ marginTop: 8 }}>
        {total} {total === 1 ? "treino" : "treinos"} em {dias.length} dias
      </p>
    </div>
  );
}
