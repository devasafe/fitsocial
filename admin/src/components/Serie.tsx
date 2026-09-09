import type { UsoPorDia } from "../api";

/** Série diária em SVG puro. O app já desenha seus gráficos assim
 *  (app-android/src/components/LineChart.tsx) e a necessidade aqui é uma série
 *  simples — não justifica uma biblioteca de gráficos no bundle.
 *
 *  As falhas ficam empilhadas sobre as chamadas, em vermelho: é a leitura que
 *  interessa de relance — "queimou muito" é diferente de "queimou e falhou". */
export function Serie({ dados }: { dados: UsoPorDia[] }) {
  if (dados.length === 0) {
    return (
      <p className="vazio">
        Nenhuma chamada de IA registrada ainda. Os números aparecem aqui assim que
        alguém conversar com o coach ou gerar um plano.
      </p>
    );
  }

  const L = 900;
  const A = 180;
  const base = A - 22;
  const teto = Math.max(...dados.map((d) => d.chamadas), 1);
  const passo = L / dados.length;
  const larguraBarra = Math.max(Math.min(passo - 6, 34), 3);

  const rotulo = (dia: string) => dia.slice(8) + "/" + dia.slice(5, 7);

  return (
    <svg viewBox={`0 0 ${L} ${A}`} width="100%" height={A} role="img"
         aria-label={`Chamadas de IA por dia nos últimos ${dados.length} dias`}>
      <line x1="0" y1={base} x2={L} y2={base} stroke="var(--line-forte)" strokeWidth="1" />

      {dados.map((d, i) => {
        const alturaTotal = Math.round(((base - 12) * d.chamadas) / teto);
        const alturaFalha = d.chamadas ? Math.round((alturaTotal * d.falhas) / d.chamadas) : 0;
        const x = i * passo + (passo - larguraBarra) / 2;
        const y = base - alturaTotal;
        return (
          <g key={d.dia}>
            <title>{`${d.dia}: ${d.chamadas} chamadas, ${d.falhas} falhas, ${d.tokens.toLocaleString("pt-BR")} tokens`}</title>
            <rect x={x} y={y} width={larguraBarra} height={alturaTotal - alturaFalha}
                  fill="var(--lime)" rx="2" />
            {alturaFalha > 0 && (
              <rect x={x} y={base - alturaFalha} width={larguraBarra} height={alturaFalha}
                    fill="var(--perigo)" rx="2" />
            )}
            {(dados.length <= 14 || i % Math.ceil(dados.length / 10) === 0) && (
              <text x={x + larguraBarra / 2} y={A - 5} textAnchor="middle"
                    fill="var(--texto-3)" fontSize="10" fontFamily="var(--corpo)">
                {rotulo(d.dia)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
