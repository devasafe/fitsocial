import type { UsoPorDia } from "../api";
import { useEhCelular } from "../hooks/useEhCelular";

/** Série diária em SVG puro. O app já desenha seus gráficos assim
 *  (app-android/src/components/LineChart.tsx) e a necessidade aqui é uma série
 *  simples — não justifica uma biblioteca de gráficos no bundle.
 *
 *  As falhas ficam empilhadas sobre as chamadas, em vermelho: é a leitura que
 *  interessa de relance — "queimou muito" é diferente de "queimou e falhou".
 *
 *  Sobre o tamanho: o viewBox tinha 900 de largura e o SVG, altura fixa de 180.
 *  Com preserveAspectRatio padrão, numa caixa de 288px isso escalava o desenho
 *  inteiro por 0,32 — o gráfico virava uma tira de 57px flutuando no meio de
 *  uma caixa vazia, e os rótulos de 10px renderizavam a 3px. Agora a altura
 *  sai da razão do viewBox (height: auto), e o viewBox acompanha a largura de
 *  destino, então as unidades voltam a ser pixels de verdade. */
export function Serie({ dados }: { dados: UsoPorDia[] }) {
  const ehCelular = useEhCelular();

  if (dados.length === 0) {
    return (
      <p className="vazio">
        Nenhuma chamada de IA registrada ainda. Os números aparecem aqui assim que
        alguém conversar com o coach ou gerar um plano.
      </p>
    );
  }

  const L = ehCelular ? 360 : 900;
  const A = ehCelular ? 200 : 180;
  const base = A - 22;
  const teto = Math.max(...dados.map((d) => d.chamadas), 1);
  const passo = L / dados.length;
  const larguraBarra = Math.max(Math.min(passo - 6, 34), 3);

  // Dez "09/09" em 288px é uma mancha. Quatro dá para ler.
  const alvoRotulos = ehCelular ? 4 : 10;
  const corpoRotulo = ehCelular ? 13 : 10;

  const rotulo = (dia: string) => dia.slice(8) + "/" + dia.slice(5, 7);

  return (
    <svg
      viewBox={`0 0 ${L} ${A}`}
      style={{ display: "block", height: "auto", width: "100%" }}
      role="img"
      aria-label={`Chamadas de IA por dia nos últimos ${dados.length} dias`}
    >
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
            {(dados.length <= 14 || i % Math.ceil(dados.length / alvoRotulos) === 0) && (
              /* Preso dentro do viewBox: centrado na primeira barra, metade da
                 data ficava cortada na borda esquerda. */
              <text
                x={Math.min(Math.max(x + larguraBarra / 2, 18), L - 18)}
                y={A - 5}
                textAnchor="middle"
                fill="var(--texto-3)"
                fontSize={corpoRotulo}
                fontFamily="var(--corpo)"
              >
                {rotulo(d.dia)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
