// O editor de um bloco. UM só, para qualquer bloco.
//
// Antes eram três telas diferentes (metcon, força, livre) mais um despachante,
// e a pessoa tinha que escolher o tipo ANTES de escrever qualquer coisa —
// decidindo, no começo, uma categoria que só faz sentido no fim.
//
// Agora ela escreve o modo como está no quadro e o servidor deduz o resto. O
// campo nunca bloqueia: se ninguém entender "aquela parada do coach", o treino
// salva igual, só sem timer automático.

import React, { useEffect, useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { Txt } from "../ui";
import { MovimentosEditor } from "./MovimentosEditor";
import {
  Campo,
  CampoComSugestoes,
  Linha,
  Opcoes,
  Secao,
  paraInteiro,
  paraNumero,
  paraSegundos,
  mmss,
} from "./campos";
import { interpretarModo } from "../../api/activities";
import type { Bloco, Leitura, NivelDeEscala, TipoDeScore } from "../../api/crossfit";
import { useAuth } from "../../context/AuthContext";
import { colors, radius, spacing } from "../../theme";

const ESCALAS: { id: NivelDeEscala; label: string }[] = [
  { id: "rx", label: "RX" },
  { id: "rx_plus", label: "RX+" },
  { id: "scaled", label: "Scaled" },
  { id: "iniciante", label: "Iniciante" },
  { id: "custom", label: "Adaptado" },
];

const TIPOS: { id: TipoDeScore; label: string }[] = [
  { id: "tempo", label: "Tempo" },
  { id: "rounds_reps", label: "Rounds + reps" },
  { id: "reps", label: "Reps" },
  { id: "carga", label: "Carga" },
  { id: "distancia", label: "Distância" },
  { id: "customizado", label: "Outro" },
];

const EXEMPLOS = ["AMRAP 8'", "FOR TIME", "5 ROUNDS FOR TIME", "EMOM (1'15\") x 4", "REST 1'"];

/** "AMRAP · 6 min · resultado em rounds + reps" — o eco do que foi entendido. */
function comoFoiLido(l: Leitura | null): string | null {
  if (!l || l.familia === "livre") return null;

  const partes = [
    l.familia?.replace("_", " ").toUpperCase(),
    l.duracaoSec ? `${Math.round(l.duracaoSec / 60)} min` : null,
    l.timeCapSec ? `cap de ${Math.round(l.timeCapSec / 60)} min` : null,
    l.intervaloSec ? `janela de ${mmss(l.intervaloSec)}` : null,
    l.rounds ? `${l.rounds} rounds` : null,
  ].filter(Boolean);

  const score = TIPOS.find((t) => t.id === l.scoreSugerido)?.label;
  if (score) partes.push(`resultado em ${score.toLowerCase()}`);

  return partes.join(" · ");
}

export function EditorDeBloco({
  bloco,
  aoMudar,
  aoRemover,
  emEquipe = false,
}: {
  bloco: Bloco;
  aoMudar: (b: Bloco) => void;
  aoRemover: () => void;
  emEquipe?: boolean;
}) {
  const { token } = useAuth();
  const [lido, setLido] = useState<Leitura | null>(bloco.lido ?? null);

  // Interpretar ao SAIR DO CAMPO, não a cada tecla: o eco mudando no meio da
  // frase distrai, e seria uma chamada por letra digitada.
  async function ecoar() {
    const modo = bloco.modo.trim();
    if (!modo) return setLido(null);
    try {
      setLido(await interpretarModo(token!, modo));
    } catch {
      // Sem eco a pessoa segue escrevendo: o entendimento sai no salvamento
      // de qualquer jeito.
      setLido(null);
    }
  }

  useEffect(() => {
    void ecoar();
    // Só na montagem: dali em diante quem dispara é o blur do campo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eco = comoFoiLido(lido);
  const ehDescanso = lido?.familia === "descanso";
  const semResultado = ehDescanso || lido?.scoreSugerido === "nenhum";
  const r = bloco.resultado;

  // UM valor para os chips E para os campos.
  //
  // Eram duas expressões iguais escritas separadas, e elas divergiram: com o
  // resultado ainda vazio, o chip mostrava a sugestão do servidor
  // ("Rounds + reps") enquanto o campo abaixo continuava pedindo tempo.
  const tipoAtual: TipoDeScore =
    r?.tipo ?? ((lido?.scoreSugerido as TipoDeScore) || "tempo");

  function mudarResultado(patch: Partial<NonNullable<Bloco["resultado"]>>) {
    aoMudar({
      ...bloco,
      resultado: { tipo: tipoAtual, ...r, ...patch },
    });
  }

  return (
    <View
      style={{
        backgroundColor: colors.surface2,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        padding: spacing.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <CampoComSugestoes
            tipo="modo"
            rotulo="Como era"
            valor={bloco.modo}
            aoMudar={(t) => aoMudar({ ...bloco, modo: t })}
            aoSairDoCampo={() => void ecoar()}
            placeholder="AMRAP 8'"
          />
        </View>
        <TouchableOpacity onPress={aoRemover} hitSlop={8} style={{ marginTop: 18 }}>
          <Txt variant="titleCard" color={colors.danger}>
            ×
          </Txt>
        </TouchableOpacity>
      </View>

      {/* Escreva do jeito do seu box. Os exemplos existem porque um campo de
          texto vazio sem nenhuma pista trava quem nunca viu o formulário. */}
      {!bloco.modo.trim() ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: 8 }}>
          {EXEMPLOS.map((e) => (
            <TouchableOpacity
              key={e}
              onPress={() => {
                aoMudar({ ...bloco, modo: e });
                void ecoar();
              }}
              activeOpacity={0.8}
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 6,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              <Txt variant="label" color={colors.text3}>
                {e}
              </Txt>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {eco ? (
        <Txt variant="caption" color={colors.lime} style={{ marginTop: 6 }}>
          entendi: {eco}
        </Txt>
      ) : bloco.modo.trim() ? (
        <Txt variant="caption" color={colors.text3} style={{ marginTop: 6 }}>
          não reconheci o formato — o treino salva igual, só sem timer
        </Txt>
      ) : null}

      {!ehDescanso ? (
        <>
          <Secao titulo="Nome (opcional)">
            <Campo
              valor={bloco.nome ?? ""}
              aoMudar={(t) => aoMudar({ ...bloco, nome: t || null })}
              placeholder="Fran, BLOCO A, Relay…"
            />
          </Secao>

          <Secao titulo="Movimentos">
            <MovimentosEditor
              movimentos={bloco.movimentos}
              aoMudar={(movimentos) => aoMudar({ ...bloco, movimentos })}
              emEquipe={emEquipe}
            />
          </Secao>

          {!semResultado ? (
            <Secao titulo="Quanto você fez">
              <Opcoes
                valor={tipoAtual}
                opcoes={TIPOS}
                aoEscolher={(tipo) => aoMudar({ ...bloco, resultado: { tipo } })}
              />
              <ResultadoCampos tipo={tipoAtual} score={r} aoMudar={mudarResultado} />

              {/* Estourar o cap não é um tempo: é o quanto deu para fazer.
                  Sem isto, "4 rounds no cap" derrubava um tempo de verdade no
                  quadro de recordes. */}
              <Opcoes
                valor={r?.capado ? "sim" : "nao"}
                opcoes={[
                  { id: "nao", label: "Terminei" },
                  { id: "sim", label: "Estourou o cap" },
                ]}
                aoEscolher={(id) => mudarResultado({ capado: id === "sim" })}
              />
            </Secao>
          ) : null}

          <Secao titulo="Escala">
            <Opcoes
              valor={bloco.escala.nivel}
              opcoes={ESCALAS}
              aoEscolher={(nivel) => aoMudar({ ...bloco, escala: { ...bloco.escala, nivel } })}
            />
          </Secao>
        </>
      ) : null}
    </View>
  );
}

/** Os campos do resultado mudam com o tipo — mostrar todos daria seis caixas. */
function ResultadoCampos({
  tipo,
  score,
  aoMudar,
}: {
  tipo: TipoDeScore;
  score: Bloco["resultado"];
  aoMudar: (patch: Partial<NonNullable<Bloco["resultado"]>>) => void;
}) {
  if (tipo === "rounds_reps") {
    return (
      <Linha>
        <Campo
          rotulo="Rounds"
          valor={score?.rounds != null ? String(score.rounds) : ""}
          aoMudar={(t) => aoMudar({ rounds: paraNumero(t) })}
          placeholder="7"
          teclado="numeric"
        />
        <Campo
          rotulo="+ reps"
          valor={score?.repsExtras != null ? String(score.repsExtras) : ""}
          aoMudar={(t) => aoMudar({ repsExtras: paraInteiro(t) })}
          placeholder="12"
          teclado="numeric"
        />
      </Linha>
    );
  }

  if (tipo === "tempo") {
    return (
      <Campo
        rotulo="Tempo"
        valor={score?.tempoSec != null ? mmss(score.tempoSec) : ""}
        aoMudar={(t) => aoMudar({ tempoSec: paraSegundos(t) })}
        placeholder="5:32"
      />
    );
  }

  if (tipo === "carga") {
    return (
      <Campo
        rotulo="Carga (kg)"
        valor={score?.cargaKg != null ? String(score.cargaKg) : ""}
        aoMudar={(t) => aoMudar({ cargaKg: paraNumero(t) })}
        placeholder="100"
        teclado="numeric"
      />
    );
  }

  if (tipo === "distancia") {
    return (
      <Campo
        rotulo="Distância (m)"
        valor={score?.distanciaM != null ? String(score.distanciaM) : ""}
        aoMudar={(t) => aoMudar({ distanciaM: paraNumero(t) })}
        placeholder="1200"
        teclado="numeric"
      />
    );
  }

  if (tipo === "customizado") {
    return (
      <Linha>
        <Campo
          rotulo="Número"
          valor={score?.reps != null ? String(score.reps) : ""}
          aoMudar={(t) => aoMudar({ reps: paraInteiro(t) })}
          placeholder="40"
          teclado="numeric"
        />
        {/* Sem a descrição, o número não significa nada daqui a um mês — e por
            isso ele também não entra em recorde nenhum. */}
        <Campo
          rotulo="O que é"
          valor={score?.descricao ?? ""}
          aoMudar={(t) => aoMudar({ descricao: t || null })}
          placeholder="soma do pior round"
        />
      </Linha>
    );
  }

  return (
    <Campo
      rotulo="Reps"
      valor={score?.reps != null ? String(score.reps) : ""}
      aoMudar={(t) => aoMudar({ reps: paraInteiro(t) })}
      placeholder="90"
      teclado="numeric"
    />
  );
}
