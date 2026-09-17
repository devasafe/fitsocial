// O envelope tematizado do Recharts, compartilhado entre os gráficos do
// painel — hoje `Grafico.tsx` (força/cardio), `Radar.tsx` (grupos musculares)
// e `Nutricao.tsx` (kcal).
//
// As decisões de desenho vêm de admin/src/components/Grafico.tsx, que já tinha
// acertado: grade só na horizontal, eixo sem linha, área tênue sob a curva,
// tooltip na superfície 2. O que NÃO veio de lá foi a cor — aquele arquivo
// ainda está no lima antigo (#c8fa4b), e a marca é verde desde 11/09/2026.
//
// Extraído para cá porque `VERDE` já mudou de valor uma vez neste projeto (a
// troca de 11/09), e há uma migração de cor em curso agora mesmo. O valor em
// si mora em `estilo.css` (`--verde`, `--verde-tenue`) — aqui só se aponta
// para a variável, em vez de repetir o hex — porque o recharts recebe essas
// strings como atributo SVG cru e o browser resolve a variável normalmente
// (é o que `EIXO.stroke` já faz com `var(--texto-3)`, em produção). Sem essa
// indireção, cada gráfico teria sua própria cópia do hex, e a próxima troca
// de cor atualizaria um lugar e esqueceria os outros — o painel ficaria com
// verdes diferentes lado a lado, sem erro de compilação, sem teste, e visível
// só para quem olhar dois gráficos na mesma tela.

export const VERDE = "var(--verde)";

/**
 * Cor de referência — usada em séries que são pano de fundo, não protagonista
 * (ex.: a meta no gráfico de calorias). A mesma variável que já apaga o eixo
 * (`EIXO.stroke`, logo abaixo): "referência" precisa ficar mais fraca que o
 * dado principal, e não é uma cor nova, é a cor que o painel já usa para
 * "discreto".
 */
export const REFERENCIA = "var(--texto-3)";

export const EIXO = { stroke: "var(--texto-3)", fontSize: 11 };
export const GRADE = { stroke: "var(--line)", strokeDasharray: "0" };
export const TOOLTIP = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--line-forte)",
    borderRadius: 10,
    color: "var(--texto)",
    fontSize: 13,
  },
  labelStyle: { color: "var(--texto-2)", marginBottom: 4 },
  cursor: { fill: "var(--verde-tenue)" },
};

/**
 * Encurta a data do eixo: "2026-09-09" vira "09/09".
 *
 * Aceita `unknown` porque o recharts tipa os formatadores com o valor cru do
 * dado, que pode ser qualquer coisa — estreitar aqui é mais honesto que um
 * cast na chamada dizendo que sempre será string.
 */
export function diaEMes(v: unknown): string {
  if (typeof v !== "string") return String(v ?? "");
  const d = new Date(v.length <= 10 ? `${v}T12:00:00` : v);
  if (Number.isNaN(d.getTime())) return v;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
