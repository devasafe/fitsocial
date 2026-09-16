import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buscarNutricao, ErroApi, type EvolucaoDeNutricao, type Janela } from "../api";
import { diaEMes, EIXO, GRADE, TOOLTIP, VERDE } from "./grafico-base";

// A aba de nutrição do nutricionista — a mesma regra da tela do aluno
// (app-android/src/screens/NutricaoProgressoScreen.tsx), do outro lado do
// vínculo:
//
//   - dia sem registro chega como `kcal: null`, nunca `0`. Zero é uma
//     afirmação sobre a comida do aluno; `null` é ausência de afirmação, e o
//     gráfico tem que desenhar essa ausência como buraco, não como vale.
//   - a média nunca aparece sozinha: vem sempre ao lado de "X de N dias
//     registrados". Uma média de 12 dias lida como se fosse de 30 é
//     exatamente a mentira que esta tela existe para evitar.
//
// E o guardrail do projeto (docs/VISAO.md) vale igual do lado do
// profissional: a tela descreve o que houve, não acusa. Nenhum "falhou",
// nenhum vermelho de reprovação para dia fora do alvo.
//
// O gráfico é escrito à mão em vez de reusar `Grafico.tsx`: aquele componente
// tipa `valor` como `number`, e aqui o `null` do dia sem registro PRECISA
// entrar na série — é o dado, não um buraco a preencher. A moldura (cores,
// grade, tooltip, formato de data) vem de `grafico-base.ts`, compartilhada
// com `Grafico.tsx`, para as duas telas nunca divergirem de cor.

export function Nutricao({
  token,
  alunoId,
  janela,
}: {
  token: string;
  alunoId: string;
  janela: Janela;
}) {
  const [evolucao, setEvolucao] = useState<EvolucaoDeNutricao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Guarda de resultado obsoleto, no mesmo padrão dos efeitos vizinhos em
  // `Aluno.tsx` (`buscarSerie`, `buscarGrupos`, `buscarCardio`,
  // `buscarSerieDeCardio`): trocar de janela duas vezes em sequência (90 → 30
  // → 90, o gesto normal de comparar períodos) dispara duas requisições, e sem
  // isto quem escreve o estado é quem CHEGA por último, não quem foi PEDIDO
  // por último — o gráfico ficaria mostrando uma janela com o chip aceso
  // dizendo outra, exatamente a mentira que esta tela existe para evitar.
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    // A janela `0` (Tudo) já chega convertida para 365 no rótulo da tela
    // inteira — o backend faz o mesmo mapeamento nesta rota, então repassar
    // `janela` direto é consistente com o resto de `Aluno.tsx`.
    buscarNutricao(token, alunoId, janela)
      .then((r) => {
        if (!vivo) return;
        setEvolucao(r.data);
        setErro(null);
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar a nutrição.");
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [token, alunoId, janela]);

  if (carregando) return <p className="vazio">Carregando…</p>;
  if (erro || !evolucao) {
    return <p className="erro">{erro ?? "Não foi possível carregar a nutrição."}</p>;
  }

  const { dias, resumo } = evolucao;
  const semRegistro = resumo.diasComRegistro === 0;

  // O mesmo denominador que o backend usa para contar `diasDentroDoAlvo`
  // (api/src/services/nutricao.ts: `dentro = comRegistro.filter(d => d.alvo
  // && …)`) — dias com registro E com meta vigente. Usar `diasNaJanela` aqui
  // reproduziria o bug já documentado do lado do aluno: um plano só de treino
  // que ganhou dieta na metade da janela mostraria "0 de 30 dentro da meta"
  // para quem acertou todos os dias em que a meta existia.
  const diasComMeta = dias.filter((d) => d.registros > 0 && d.alvo).length;

  return (
    <>
      {/* Cabeçalho honesto: a média nunca sozinha, sempre com a contagem ao
          lado — os três números do mesmo peso, no mesmo cartão. */}
      <div className="cartoes" style={{ marginBottom: 16 }}>
        <div className="cartao">
          <div className="num">{resumo.mediaKcal ?? "—"}</div>
          <div className="rotulo">kcal por dia registrado</div>
        </div>
        <div className="cartao">
          <div className="num">{resumo.diasComRegistro}</div>
          <div className="rotulo">de {resumo.diasNaJanela} dias registrados</div>
        </div>
        {/* Some inteiro quando não há dia algum com meta na janela — mostrar
            "0 de 0" não informa nada e "0 de N" acusaria o aluno de ter
            errado uma meta que não existia. */}
        {diasComMeta > 0 && (
          <div className="cartao">
            <div className="num">{resumo.diasDentroDoAlvo}</div>
            <div className="rotulo">de {diasComMeta} dias dentro da meta</div>
          </div>
        )}
      </div>

      {semRegistro ? (
        <p className="vazio">Este aluno ainda não registrou nada nesta janela.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dias} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid {...GRADE} vertical={false} />
              <XAxis dataKey="dia" {...EIXO} tickLine={false} minTickGap={18} tickFormatter={diaEMes} />
              <YAxis
                {...EIXO}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v) => String(v)}
              />
              <Tooltip
                {...TOOLTIP}
                labelFormatter={diaEMes}
                formatter={(v) => [v == null ? "sem registro" : `${v} kcal`, ""]}
              />
              {/* `connectNulls` fica de fora de propósito: o padrão do recharts
                  é `false`, e é ele que abre o buraco no dia sem registro.
                  Ligá-lo desenharia consumo por cima de um dia em que
                  ninguém registrou nada. */}
              <Area
                type="monotone"
                dataKey="kcal"
                stroke={VERDE}
                strokeWidth={2}
                fill={VERDE}
                fillOpacity={0.08}
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="sub" style={{ marginTop: 8 }}>
            Onde a linha some, o aluno não registrou nada naquele dia.
          </p>
        </>
      )}
    </>
  );
}
