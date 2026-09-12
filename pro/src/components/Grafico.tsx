import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// O envelope tematizado do Recharts.
//
// As decisões de desenho vêm de admin/src/components/Grafico.tsx, que já tinha
// acertado: grade só na horizontal, eixo sem linha, área tênue sob a curva,
// tooltip na superfície 2. O que NÃO veio de lá foi a cor — aquele arquivo
// ainda está no lima antigo (#c8fa4b), e a marca é verde desde 11/09/2026.

const VERDE = "#3bcc06";

const EIXO = { stroke: "var(--texto-3)", fontSize: 11 };
const GRADE = { stroke: "var(--line)", strokeDasharray: "0" };
const TOOLTIP = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--line-forte)",
    borderRadius: 10,
    color: "var(--texto)",
    fontSize: 13,
  },
  labelStyle: { color: "var(--texto-2)", marginBottom: 4 },
  cursor: { fill: "rgba(59, 204, 6, 0.06)" },
};

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

/**
 * Encurta a data do eixo: "2026-09-09" vira "09/09".
 *
 * Aceita `unknown` porque o recharts tipa os formatadores com o valor cru do
 * dado, que pode ser qualquer coisa — estreitar aqui é mais honesto que um
 * cast na chamada dizendo que sempre será string.
 */
function diaEMes(v: unknown): string {
  if (typeof v !== "string") return String(v ?? "");
  const d = new Date(v.length <= 10 ? `${v}T12:00:00` : v);
  if (Number.isNaN(d.getTime())) return v;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function Grafico({
  dados,
  altura = 200,
  formatar = (v: number) => String(v),
}: {
  dados: PontoDoGrafico[];
  altura?: number;
  formatar?: (v: number) => string;
}) {
  if (dados.length === 0) return <p className="vazio">Sem dados nesta janela.</p>;

  return (
    <ResponsiveContainer width="100%" height={altura}>
      <AreaChart data={dados} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid {...GRADE} vertical={false} />
        <XAxis dataKey="x" {...EIXO} tickLine={false} minTickGap={18} tickFormatter={diaEMes} />
        <YAxis {...EIXO} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => formatar(Number(v))} />
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
