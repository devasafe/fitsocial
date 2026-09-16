import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { diaEMes, EIXO, GRADE, TOOLTIP, VERDE } from "./grafico-base";

export interface PontoDoGrafico {
  /** yyyy-mm-dd ou ISO — o eixo mostra dia/mês. */
  x: string;
  valor: number;
  /** Neste dia caiu um recorde. Vira a bolinha marcada na curva. */
  ehPR?: boolean;
}

/**
 * A bolinha só aparece onde houve recorde.
 *
 * Marcar todos os pontos polui a curva e some com a informação; marcar só o
 * recorde faz o contrário — o coach acha o dia que interessa sem ler a série
 * inteira. É a mesma marca que o aluno vê no gráfico dele.
 *
 * O recharts clona este elemento por ponto e injeta `cx`, `cy` e `payload`.
 */
function PontoDeRecorde({ cx, cy, payload }: { cx?: number; cy?: number; payload?: PontoDoGrafico }) {
  if (!payload?.ehPR || cx == null || cy == null) return <g />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill={VERDE} stroke="var(--bg)" strokeWidth={2} />
    </g>
  );
}

export function Grafico({
  dados,
  altura = 200,
  formatar = (v: number) => String(v),
  menorEhMelhor = false,
}: {
  dados: PontoDoGrafico[];
  altura?: number;
  formatar?: (v: number) => string;
  /** Vira o eixo Y. Num pace, correr melhor é um número menor — sem inverter,
   *  a melhora desenha uma linha descendo e o coach lê o contrário do que é. */
  menorEhMelhor?: boolean;
}) {
  if (dados.length === 0) return <p className="vazio">Sem dados nesta janela.</p>;

  return (
    <ResponsiveContainer width="100%" height={altura}>
      <AreaChart data={dados} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid {...GRADE} vertical={false} />
        <XAxis dataKey="x" {...EIXO} tickLine={false} minTickGap={18} tickFormatter={diaEMes} />
        <YAxis
          {...EIXO}
          tickLine={false}
          axisLine={false}
          width={52}
          reversed={menorEhMelhor}
          tickFormatter={(v) => formatar(Number(v))}
        />
        <Tooltip
          {...TOOLTIP}
          labelFormatter={diaEMes}
          formatter={(v) => [formatar(Number(v)), ""]}
        />
        <Area
          type="monotone"
          dataKey="valor"
          stroke={VERDE}
          strokeWidth={2}
          fill={VERDE}
          fillOpacity={0.08}
          dot={<PontoDeRecorde />}
          activeDot={{ r: 4, fill: VERDE, stroke: "var(--bg)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
