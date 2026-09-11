// O treino aberto: bloco a bloco, na ordem em que aconteceu.
//
// O card resume; aqui nada é escondido. Quem abre o próprio treino de três
// meses atrás quer saber o que aqueceu, quanto levantou e o que escalou — é
// isso que transforma registro em histórico.
//
// Cada bloco se apresenta pelo MODO que o coach escreveu, não por um rótulo
// que o app escolheu. "EMOM (1'15\") x 4" diz mais que "Aquecimento".

import React from "react";
import { View } from "react-native";
import { Txt, Card } from "../ui";
import { resumoDoMovimento } from "./MovimentosEditor";
import { mmss, resultadoEmTexto, rotuloDaEscala, ehDescanso } from "../../lib/crossfitResumo";
import type { Bloco, PayloadDeCrossfit } from "../../api/crossfit";
import { colors, spacing } from "../../theme";

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 4,
        gap: spacing.md,
      }}
    >
      <Txt variant="body" color={colors.text2} style={{ flexShrink: 1 }}>
        {rotulo}
      </Txt>
      <Txt variant="bodyStrong" tabular>
        {valor}
      </Txt>
    </View>
  );
}

/** "6 min · 4 rounds · janela de 1:15" — o que o servidor entendeu do modo. */
function estruturaEmTexto(bloco: Bloco): string {
  const l = bloco.lido;
  if (!l) return "";
  return [
    l.duracaoSec ? `${Math.round(l.duracaoSec / 60)} min` : null,
    l.timeCapSec ? `cap de ${Math.round(l.timeCapSec / 60)} min` : null,
    l.rounds ? `${l.rounds} rounds` : null,
    l.intervaloSec ? `janela de ${mmss(l.intervaloSec)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function BlocoAberto({ bloco }: { bloco: Bloco }) {
  const descanso = ehDescanso(bloco);
  const estrutura = estruturaEmTexto(bloco);
  const resultado = resultadoEmTexto(bloco.resultado);

  return (
    <Card style={{ marginTop: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
        <Txt variant="titleCard" style={{ flexShrink: 1 }}>
          {bloco.nome?.trim() || bloco.modo}
        </Txt>
        {bloco.nome?.trim() ? (
          <Txt variant="caption" color={colors.text3}>
            {bloco.modo}
          </Txt>
        ) : null}
      </View>

      {estrutura ? (
        <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
          {estrutura}
        </Txt>
      ) : null}

      {descanso ? null : (
        <>
          {bloco.movimentos.length ? (
            <View style={{ marginTop: spacing.sm }}>
              {bloco.movimentos.map((m, i) => (
                <Txt key={i} variant="body" color={colors.text2} style={{ paddingVertical: 2 }}>
                  {resumoDoMovimento(m)}
                </Txt>
              ))}
            </View>
          ) : null}

          {resultado ? (
            <View style={{ marginTop: spacing.sm }}>
              <Linha rotulo="Resultado" valor={resultado} />
              <Linha rotulo="Escala" valor={rotuloDaEscala(bloco.escala?.nivel)} />
            </View>
          ) : null}

          {/* O que foi trocado para o treino caber. O nível sozinho nunca soube
              dizer O QUE mudou — e é o que a pessoa esquece em duas semanas. */}
          {bloco.escala?.ajustes?.length ? (
            <View style={{ marginTop: spacing.sm }}>
              {bloco.escala.ajustes.map((a, i) => (
                <Linha key={i} rotulo={a.de} valor={a.para} />
              ))}
            </View>
          ) : null}
        </>
      )}

      {bloco.notas ? (
        <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
          {bloco.notas}
        </Txt>
      ) : null}
    </Card>
  );
}

export function DetalheDoTreino({ wod }: { wod?: PayloadDeCrossfit | null }) {
  const blocos = wod?.blocos ?? [];

  return (
    <View>
      {(wod?.tamanhoDoTime ?? 1) > 1 ? (
        <Txt variant="body" color={colors.text2} style={{ marginBottom: spacing.xs }}>
          Em {wod!.tamanhoDoTime}
          {wod?.parceiros?.length ? ` com ${wod.parceiros.join(", ")}` : ""}
        </Txt>
      ) : null}

      {blocos.map((b, i) => (
        <BlocoAberto key={i} bloco={b} />
      ))}

      {/* O quadro como foi colado. Os blocos são a interpretação; este texto é
          a fonte — se a leitura errou, ele ainda diz o que o coach escreveu. */}
      {wod?.quadro?.trim() ? (
        <Card style={{ marginTop: spacing.md }}>
          <Txt variant="label" color={colors.text3}>
            O quadro, como estava escrito
          </Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.xs }}>
            {wod.quadro.trim()}
          </Txt>
        </Card>
      ) : null}
    </View>
  );
}
