import type { ReactNode } from "react";
import { useEhCelular } from "../hooks/useEhCelular";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// Envelope do Recharts já com o tema aplicado. Sem isto, cada gráfico repetiria
// dez props de cor e um deles acabaria fora do padrão.

const EIXO = { stroke: "var(--texto-3)", fontSize: 11 };
const GRADE = { stroke: "var(--line)", strokeDasharray: "0" };

/** Rótulo do eixo: "09/09" em vez da data inteira, que não cabe. */
const curto = (dia: string) => dia.slice(8) + "/" + dia.slice(5, 7);

/** O Recharts tipa o rótulo do tooltip como ReactNode, não string. */
const curtoNode = (label: ReactNode): ReactNode =>
  typeof label === "string" ? curto(label) : label;

/** Ajustes de tela estreita, iguais nos dois gráficos.
 *
 *  A `Legend` é o problema silencioso: com 3 séries ela quebra em duas linhas
 *  numa tela de celular e, como vive dentro do container de altura fixa, quem
 *  encolhe é o gráfico. Reservando altura para ela, o Recharts passa a
 *  descontar de forma previsível — e a altura total cresce em vez de o
 *  desenho murchar. */
const ALTURA_LEGENDA = 28;

function medidas(movel: boolean, faixas: number, altura: number) {
  const comLegenda = faixas > 1;
  return {
    // O eixo Y custa largura fixa; em 288px de gráfico, 44px são 15%.
    larguraY: movel ? 34 : 44,
    margemEsq: movel ? -10 : -22,
    altura: (movel ? Math.round(altura * 0.8) : altura) + (movel && comLegenda ? ALTURA_LEGENDA : 0),
    legenda: comLegenda,
  };
}

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

export interface Faixa {
  chave: string;
  nome: string;
  cor: string;
}

/** Barras por dia. Use para contagem de eventos. */
export function GraficoBarras({
  dados,
  faixas,
  altura = 200,
}: {
  dados: Record<string, unknown>[];
  faixas: Faixa[];
  altura?: number;
}) {
  const m = medidas(useEhCelular(), faixas.length, altura);
  return (
    <ResponsiveContainer width="100%" height={m.altura}>
      <BarChart data={dados} margin={{ top: 4, right: 4, bottom: 0, left: m.margemEsq }}>
        <CartesianGrid {...GRADE} vertical={false} />
        <XAxis dataKey="dia" tickFormatter={curto} {...EIXO} tickLine={false} minTickGap={18} />
        <YAxis {...EIXO} tickLine={false} axisLine={false} allowDecimals={false} width={m.larguraY} />
        <Tooltip {...TOOLTIP} labelFormatter={curtoNode} />
        {m.legenda && (
          <Legend height={ALTURA_LEGENDA} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        )}
        {faixas.map((f) => (
          <Bar key={f.chave} dataKey={f.chave} name={f.nome} fill={f.cor} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Linhas por dia. Use para acompanhar tendência, não volume. */
export function GraficoLinhas({
  dados,
  faixas,
  altura = 200,
}: {
  dados: Record<string, unknown>[];
  faixas: Faixa[];
  altura?: number;
}) {
  const m = medidas(useEhCelular(), faixas.length, altura);
  return (
    <ResponsiveContainer width="100%" height={m.altura}>
      <AreaChart data={dados} margin={{ top: 4, right: 4, bottom: 0, left: m.margemEsq }}>
        <CartesianGrid {...GRADE} vertical={false} />
        <XAxis dataKey="dia" tickFormatter={curto} {...EIXO} tickLine={false} minTickGap={18} />
        <YAxis {...EIXO} tickLine={false} axisLine={false} allowDecimals={false} width={m.larguraY} />
        <Tooltip {...TOOLTIP} labelFormatter={curtoNode} cursor={{ stroke: "var(--line-forte)" }} />
        {m.legenda && (
          <Legend height={ALTURA_LEGENDA} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        )}
        {faixas.map((f) => (
          <Area
            key={f.chave}
            type="monotone"
            dataKey={f.chave}
            name={f.nome}
            stroke={f.cor}
            strokeWidth={2}
            fill={f.cor}
            fillOpacity={0.08}
            dot={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
