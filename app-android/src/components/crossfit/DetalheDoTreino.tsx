// O treino aberto: bloco a bloco, na ordem em que aconteceu.
//
// O card resume; aqui nada é escondido. Quem abre o próprio treino de três
// meses atrás quer saber o que aqueceu, quanto levantou e o que escalou — é
// isso que transforma registro em histórico.

import React from "react";
import { View } from "react-native";
import { Txt, Card } from "../ui";
import { resumoDoMovimento } from "./MovimentosEditor";
import {
  ROTULO_DO_BLOCO,
  mmss,
  prescricaoEmTexto,
  resultadoEmTexto,
  rotuloDaEscala,
} from "../../lib/crossfitResumo";
import type { Bloco, PayloadDeCrossfit } from "../../api/crossfit";
import { colors, spacing } from "../../theme";

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: spacing.md }}>
      <Txt variant="body" color={colors.text2} style={{ flexShrink: 1 }}>
        {rotulo}
      </Txt>
      <Txt variant="bodyStrong" tabular>
        {valor}
      </Txt>
    </View>
  );
}

function CorpoDoBloco({ bloco }: { bloco: Bloco }) {
  if (bloco.tipo === "forca") {
    return (
      <View>
        {bloco.exercicios.map((ex, i) => (
          <View key={i} style={{ marginTop: i === 0 ? 0 : spacing.sm }}>
            <Txt variant="bodyStrong">{ex.name}</Txt>
            {ex.sets.map((s, j) => (
              <Linha
                key={j}
                rotulo={`Série ${j + 1}`}
                valor={`${s.reps ?? "—"} × ${s.weightKg ?? 0} kg`}
              />
            ))}
          </View>
        ))}
      </View>
    );
  }

  if (bloco.tipo === "skill") {
    const acertos =
      bloco.acertos != null && bloco.tentativas != null
        ? `${bloco.acertos}/${bloco.tentativas}`
        : null;
    return (
      <View>
        <Txt variant="bodyStrong">{bloco.movimento}</Txt>
        {bloco.duracaoSec ? <Linha rotulo="Duração" valor={mmss(bloco.duracaoSec)} /> : null}
        {bloco.intervaloSec ? <Linha rotulo="A cada" valor={mmss(bloco.intervaloSec)} /> : null}
        {acertos ? <Linha rotulo="Completou" valor={acertos} /> : null}
        {bloco.melhorSequencia ? (
          <Linha rotulo="Melhor sequência" valor={`${bloco.melhorSequencia} sem quebrar`} />
        ) : null}
      </View>
    );
  }

  if (bloco.tipo === "metcon") {
    const p = bloco.prescricao;
    const resultado = resultadoEmTexto(bloco);
    return (
      <View>
        {bloco.nome ? <Txt variant="bodyStrong">{bloco.nome}</Txt> : null}
        <Txt variant="body" color={colors.text2} style={{ marginTop: 2 }}>
          {prescricaoEmTexto(bloco)}
          {p.timeCapSec ? ` · cap ${mmss(p.timeCapSec)}` : ""}
        </Txt>

        <View style={{ marginTop: spacing.sm }}>
          {p.movimentos
            .filter((m) => m.nome.trim())
            .map((m, i) => (
              <Txt key={i} variant="body" color={colors.text2}>
                {`•  ${resumoDoMovimento(m)}`}
              </Txt>
            ))}
        </View>

        {resultado ? (
          <View style={{ marginTop: spacing.sm }}>
            <Linha
              rotulo={bloco.resultado?.capado ? "Resultado (no cap)" : "Resultado"}
              valor={resultado}
            />
          </View>
        ) : null}

        <Linha rotulo="Escala" valor={rotuloDaEscala(bloco.escala?.nivel)} />
        {/* O que mudou. É isto que, meses depois, diz se você escalou o mesmo
            movimento ou já evoluiu naquele. */}
        {(bloco.escala?.ajustes ?? []).map((a, i) => (
          <Txt key={i} variant="caption" color={colors.text3}>
            {`${a.de} → ${a.para}`}
          </Txt>
        ))}

        {bloco.rounds?.length ? (
          <View style={{ marginTop: spacing.sm }}>
            <Txt variant="label" color={colors.text2}>
              Por round
            </Txt>
            {bloco.rounds.map((r) => (
              <Linha
                key={r.numero}
                rotulo={`Round ${r.numero}`}
                valor={r.tempoSec != null ? mmss(r.tempoSec) : `${r.reps ?? 0} reps`}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  // Aquecimento, mobilidade, cooldown.
  return (
    <View>
      {bloco.rounds || bloco.duracaoSec ? (
        <Txt variant="body" color={colors.text2}>
          {[bloco.rounds ? `${bloco.rounds} rounds` : "", bloco.duracaoSec ? mmss(bloco.duracaoSec) : ""]
            .filter(Boolean)
            .join(" · ")}
        </Txt>
      ) : null}
      {bloco.movimentos
        .filter((m) => m.nome.trim())
        .map((m, i) => (
          <Txt key={i} variant="body" color={colors.text2}>
            {`•  ${resumoDoMovimento(m)}`}
          </Txt>
        ))}
    </View>
  );
}

export function DetalheDoTreino({ wod }: { wod: PayloadDeCrossfit }) {
  return (
    <View style={{ gap: spacing.card }}>
      {wod.box ? (
        <Txt variant="body" color={colors.text2}>
          {wod.box}
        </Txt>
      ) : null}

      {wod.blocos.map((bloco, i) => (
        <Card key={i} level={2}>
          <Txt variant="label" color={colors.lime} style={{ marginBottom: spacing.xs }}>
            {ROTULO_DO_BLOCO[bloco.tipo].toUpperCase()}
          </Txt>
          <CorpoDoBloco bloco={bloco} />
          {bloco.notas ? (
            <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.sm }}>
              {bloco.notas}
            </Txt>
          ) : null}
        </Card>
      ))}
    </View>
  );
}
