import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { GrupoTreinado } from "../api";

// O mesmo radar que o aluno vê na aba Progresso, desenhado com a lib que o
// painel já carrega. O que precisa bater é o NÚMERO, não o traço: os dois lados
// leem `/evolucao/grupos` e `/pro/alunos/:id/grupos`, que são a mesma função.

const VERDE = "#3bcc06";

/**
 * "Posterior de coxa" em doze eixos não cabe em lugar nenhum.
 *
 * Encurtar aqui, e não no servidor, é de propósito: o texto gravado em
 * `metrics.seriesPorGrupo` é chave de dado, não rótulo de tela.
 */
function curto(grupo: string): string {
  switch (grupo) {
    case "Posterior de coxa":
      return "Posterior";
    case "Quadríceps":
      return "Quadr.";
    case "Panturrilha":
      return "Pantur.";
    case "Corpo todo":
      return "Corpo";
    default:
      return grupo;
  }
}

export function RadarDeGrupos({ dados, altura = 280 }: { dados: GrupoTreinado[]; altura?: number }) {
  const total = dados.reduce((s, g) => s + g.series, 0);
  if (total === 0) return <p className="vazio">Nenhuma série de força nesta janela.</p>;

  return (
    <ResponsiveContainer width="100%" height={altura}>
      <RadarChart data={dados.map((g) => ({ ...g, curto: curto(g.grupo) }))} outerRadius="72%">
        <PolarGrid stroke="var(--line)" />
        <PolarAngleAxis dataKey="curto" tick={{ fill: "var(--texto-3)", fontSize: 11 }} />
        {/* Sem números no raio: a leitura aqui é de forma — o que está cheio e
            o que está vazio —, e o valor exato sai no tooltip. */}
        <PolarRadiusAxis tick={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            background: "var(--surface-2)",
            border: "1px solid var(--line-forte)",
            borderRadius: 10,
            color: "var(--texto)",
            fontSize: 13,
          }}
          labelStyle={{ color: "var(--texto-2)", marginBottom: 4 }}
          formatter={(v) => [`${Number(v)} séries`, ""]}
          labelFormatter={(_, carga) => String(carga?.[0]?.payload?.grupo ?? "")}
        />
        <Radar dataKey="series" stroke={VERDE} strokeWidth={2} fill={VERDE} fillOpacity={0.14} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
