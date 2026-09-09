/** Barra de consumo pintada com a rampa térmica do app (docs/DESIGN.md §2.4).
 *  Lá ela mostra intensidade de treino; aqui, o quanto a chave já queimou.
 *  A cor é a informação — some junto com o número quando não há teto definido. */

const RAMPA = [
  { ate: 40, cor: "var(--termica-1)" },
  { ate: 65, cor: "var(--termica-2)" },
  { ate: 80, cor: "var(--termica-3)" },
  { ate: 95, cor: "var(--termica-4)" },
  { ate: Infinity, cor: "var(--termica-5)" },
];

export function corDoConsumo(pct: number): string {
  return RAMPA.find((f) => pct <= f.ate)!.cor;
}

export function Termica({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="aviso">sem teto definido</span>;
  }
  const largura = Math.min(pct, 100);
  return (
    <div
      className="trilho"
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${pct}% da quota diária`}
      title={`${pct}% da quota diária`}
    >
      <i style={{ width: `${largura}%`, background: corDoConsumo(pct) }} />
    </div>
  );
}
