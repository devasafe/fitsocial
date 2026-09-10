// O WOD.
//
// A tela é dividida em PRESCRIÇÃO (o que estava no quadro) e RESULTADO (o que
// aconteceu). São coisas diferentes: um AMRAP de 15' onde a pessoa parou aos 12'
// não é um AMRAP de 12'.
//
// Os campos da prescrição mudam conforme o formato — mostrar time cap, duração,
// intervalo e trabalho/descanso ao mesmo tempo seria pedir para a pessoa
// adivinhar quais servem para o treino dela.

import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Txt } from "../ui";
import { SuggestField } from "../SuggestField";
import { MovimentosEditor } from "./MovimentosEditor";
import { Campo, Linha, Opcoes, Secao, paraInteiro, paraNumero, paraSegundos, mmss } from "./campos";
import { useAuth } from "../../context/AuthContext";
import { buscarBenchmarks } from "../../api/crossfit";
import type { BlocoMetcon, FormatoDeMetcon, NivelDeEscala, TipoDeScore, Benchmark } from "../../api/crossfit";
import { colors, spacing } from "../../theme";

const FORMATOS: { id: FormatoDeMetcon; label: string }[] = [
  { id: "for_time", label: "For Time" },
  { id: "amrap", label: "AMRAP" },
  { id: "rft", label: "Rounds For Time" },
  { id: "emom", label: "EMOM" },
  { id: "tabata", label: "Tabata" },
  { id: "intervalo", label: "Intervalos" },
  { id: "max_reps", label: "Max Reps" },
  { id: "max_load", label: "Carga máxima" },
  { id: "outro", label: "Outro" },
];

const ESCALAS: { id: NivelDeEscala; label: string }[] = [
  { id: "rx", label: "RX" },
  { id: "rx_plus", label: "RX+" },
  { id: "scaled", label: "Scaled" },
  { id: "iniciante", label: "Iniciante" },
  { id: "custom", label: "Adaptado" },
];

/** O tipo de resultado que cada formato costuma produzir. */
function scorePadrao(formato: FormatoDeMetcon): TipoDeScore {
  switch (formato) {
    case "amrap":
      return "rounds_reps";
    case "max_reps":
    case "tabata":
    case "emom":
      return "reps";
    case "max_load":
      return "carga";
    default:
      return "tempo";
  }
}

export function EditorDeMetcon({
  bloco,
  aoMudar,
}: {
  bloco: BlocoMetcon;
  aoMudar: (b: BlocoMetcon) => void;
}) {
  const { token } = useAuth();

  const p = bloco.prescricao;
  const tipoScore = bloco.resultado?.tipo ?? scorePadrao(bloco.formato);
  const capado = bloco.resultado?.capado === true;

  function mudarPrescricao(patch: Partial<BlocoMetcon["prescricao"]>) {
    aoMudar({ ...bloco, prescricao: { ...p, ...patch } });
  }

  function mudarResultado(patch: Partial<NonNullable<BlocoMetcon["resultado"]>>) {
    aoMudar({
      ...bloco,
      resultado: { tipo: tipoScore, ...bloco.resultado, ...patch },
    });
  }

  /** Escolher um benchmark conhecido traz a prescrição pronta. */
  function usarBenchmark(b: Benchmark) {
    aoMudar({
      ...bloco,
      nome: b.nome,
      benchmark: { slug: b.slug, familia: b.familia },
      formato: b.formato,
      prescricao: {
        ...p,
        rounds: b.rounds ?? null,
        duracaoSec: b.duracaoSec ?? null,
        timeCapSec: b.timeCapSec ?? null,
        movimentos: b.movimentos,
      },
    });
  }

  return (
    <View>
      <SuggestField
        label="Nome do WOD"
        value={bloco.nome ?? ""}
        // Digitar por cima desfaz o vínculo: o nome deixou de ser aquele WOD,
        // e manter o slug faria o recorde comparar coisas diferentes.
        onChangeText={(t) => aoMudar({ ...bloco, nome: t, benchmark: null })}
        placeholder="Fran, Murph, WOD do dia…"
        fetchSuggestions={async (q) => {
          const r = await buscarBenchmarks(token!, q);
          return r.data.map((b) => ({
            id: b.slug,
            label: b.nome,
            sub: b.notaRx ?? (b.familia === "hero" ? "Hero WOD" : "Benchmark"),
            data: b,
          }));
        }}
        onPick={(s) => usarBenchmark(s.data as Benchmark)}
      />

      {bloco.benchmark ? (
        <Txt variant="caption" color={colors.lime} style={{ marginTop: -spacing.sm }}>
          Benchmark reconhecido — seus tempos vão ser comparados entre si.
        </Txt>
      ) : null}

      <Secao titulo="Formato">
        <Opcoes
          valor={bloco.formato}
          opcoes={FORMATOS}
          aoEscolher={(id) => aoMudar({ ...bloco, formato: id, resultado: null })}
        />
      </Secao>

      {/* ---- Prescrição: só os campos que o formato usa ---- */}
      <Secao titulo="O que estava no quadro">
        <Linha>
          {(bloco.formato === "rft" || bloco.formato === "tabata") && (
            <Campo
              rotulo="Rounds"
              valor={p.rounds != null ? String(p.rounds) : ""}
              aoMudar={(t) => mudarPrescricao({ rounds: paraInteiro(t) })}
              placeholder="5"
              teclado="numeric"
            />
          )}
          {(bloco.formato === "amrap" ||
            bloco.formato === "emom" ||
            bloco.formato === "intervalo" ||
            bloco.formato === "max_reps") && (
            <Campo
              rotulo="Duração"
              valor={mmss(p.duracaoSec)}
              aoMudar={(t) => mudarPrescricao({ duracaoSec: paraSegundos(t) })}
              placeholder="12:00"
            />
          )}
          {(bloco.formato === "emom" || bloco.formato === "intervalo") && (
            <Campo
              rotulo="A cada"
              valor={mmss(p.intervaloSec)}
              aoMudar={(t) => mudarPrescricao({ intervaloSec: paraSegundos(t) })}
              placeholder="1:00"
            />
          )}
          {(bloco.formato === "for_time" || bloco.formato === "rft") && (
            <Campo
              rotulo="Time cap"
              valor={mmss(p.timeCapSec)}
              aoMudar={(t) => mudarPrescricao({ timeCapSec: paraSegundos(t) })}
              placeholder="15:00"
            />
          )}
        </Linha>

        {bloco.formato === "tabata" ? (
          <Linha>
            <Campo
              rotulo="Trabalho"
              valor={p.trabalhoSec != null ? String(p.trabalhoSec) : ""}
              aoMudar={(t) => mudarPrescricao({ trabalhoSec: paraInteiro(t) })}
              placeholder="20"
              teclado="numeric"
            />
            <Campo
              rotulo="Descanso"
              valor={p.descansoSec != null ? String(p.descansoSec) : ""}
              aoMudar={(t) => mudarPrescricao({ descansoSec: paraInteiro(t) })}
              placeholder="10"
              teclado="numeric"
            />
          </Linha>
        ) : null}

        <MovimentosEditor
          movimentos={p.movimentos}
          aoMudar={(movs) => mudarPrescricao({ movimentos: movs })}
        />
      </Secao>

      {/* ---- Resultado ---- */}
      <Secao titulo="Como foi">
        {p.timeCapSec ? (
          <TouchableOpacity
            onPress={() =>
              // Estourar o cap muda o TIPO do resultado: não existe tempo final,
              // existe o quanto deu para fazer.
              mudarResultado({
                capado: !capado,
                tipo: !capado ? "rounds_reps" : "tempo",
                tempoSec: null,
              })
            }
            activeOpacity={0.7}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: capado ? colors.lime : colors.line,
                backgroundColor: capado ? colors.lime : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {capado ? <Txt variant="caption" color={colors.onLime}>✓</Txt> : null}
            </View>
            <Txt variant="body" color={colors.text2}>
              Estourei o time cap
            </Txt>
          </TouchableOpacity>
        ) : null}

        {tipoScore === "tempo" && !capado ? (
          <Campo
            rotulo="Tempo"
            valor={mmss(bloco.resultado?.tempoSec)}
            aoMudar={(t) => mudarResultado({ tipo: "tempo", tempoSec: paraSegundos(t) })}
            placeholder="11:42"
          />
        ) : null}

        {tipoScore === "rounds_reps" || capado ? (
          <Linha>
            <Campo
              rotulo="Rounds"
              valor={bloco.resultado?.rounds != null ? String(bloco.resultado.rounds) : ""}
              aoMudar={(t) => mudarResultado({ tipo: "rounds_reps", rounds: paraInteiro(t) })}
              placeholder="7"
              teclado="numeric"
            />
            <Campo
              rotulo="+ reps"
              valor={bloco.resultado?.repsExtras != null ? String(bloco.resultado.repsExtras) : ""}
              aoMudar={(t) => mudarResultado({ tipo: "rounds_reps", repsExtras: paraInteiro(t) })}
              placeholder="12"
              teclado="numeric"
            />
          </Linha>
        ) : null}

        {tipoScore === "reps" && !capado ? (
          <Campo
            rotulo="Repetições"
            valor={bloco.resultado?.reps != null ? String(bloco.resultado.reps) : ""}
            aoMudar={(t) => mudarResultado({ tipo: "reps", reps: paraInteiro(t) })}
            placeholder="42"
            teclado="numeric"
          />
        ) : null}

        {tipoScore === "carga" && !capado ? (
          <Campo
            rotulo="Carga (kg)"
            valor={bloco.resultado?.cargaKg != null ? String(bloco.resultado.cargaKg) : ""}
            aoMudar={(t) => mudarResultado({ tipo: "carga", cargaKg: paraNumero(t) })}
            placeholder="110"
            teclado="numeric"
          />
        ) : null}
      </Secao>

      <Secao titulo="Escala">
        <Opcoes
          valor={bloco.escala.nivel}
          opcoes={ESCALAS}
          aoEscolher={(id) => aoMudar({ ...bloco, escala: { ...bloco.escala, nivel: id } })}
        />
        <Txt variant="caption" color={colors.text3}>
          Só compara com quem fez no mesmo nível — RX com RX.
        </Txt>

        {/* O que MUDOU. Sem isto, "scaled" três meses depois não diz se você
            escalou o mesmo movimento ou já evoluiu naquele e escalou outro. */}
        {bloco.escala.nivel !== "rx" && bloco.escala.nivel !== "rx_plus" ? (
          <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
            {(bloco.escala.ajustes ?? []).map((a, i) => (
              <Linha key={i}>
                <Campo
                  valor={a.de}
                  aoMudar={(t) =>
                    aoMudar({
                      ...bloco,
                      escala: {
                        ...bloco.escala,
                        ajustes: (bloco.escala.ajustes ?? []).map((x, j) =>
                          j === i ? { ...x, de: t } : x
                        ),
                      },
                    })
                  }
                  placeholder="Pull Up"
                />
                <View style={{ justifyContent: "center" }}>
                  <Txt variant="body" color={colors.text3}>
                    →
                  </Txt>
                </View>
                <Campo
                  valor={a.para}
                  aoMudar={(t) =>
                    aoMudar({
                      ...bloco,
                      escala: {
                        ...bloco.escala,
                        ajustes: (bloco.escala.ajustes ?? []).map((x, j) =>
                          j === i ? { ...x, para: t } : x
                        ),
                      },
                    })
                  }
                  placeholder="Ring Row"
                />
                <TouchableOpacity
                  onPress={() =>
                    aoMudar({
                      ...bloco,
                      escala: {
                        ...bloco.escala,
                        ajustes: (bloco.escala.ajustes ?? []).filter((_, j) => j !== i),
                      },
                    })
                  }
                  hitSlop={8}
                  style={{ justifyContent: "center", width: 24 }}
                >
                  <Txt variant="body" color={colors.danger}>
                    ×
                  </Txt>
                </TouchableOpacity>
              </Linha>
            ))}

            <TouchableOpacity
              onPress={() =>
                aoMudar({
                  ...bloco,
                  escala: {
                    ...bloco.escala,
                    ajustes: [...(bloco.escala.ajustes ?? []), { de: "", para: "" }],
                  },
                })
              }
              activeOpacity={0.7}
              style={{ alignSelf: "flex-start", paddingVertical: spacing.xs }}
            >
              <Txt variant="label" color={colors.lime}>
                + O que você trocou
              </Txt>
            </TouchableOpacity>
          </View>
        ) : null}
      </Secao>
    </View>
  );
}

/** Resumo do metcon para o card do bloco. */
export function resumoDoMetcon(bloco: BlocoMetcon): string {
  const r = bloco.resultado;
  if (!r) return "";
  if (r.capado) return `${r.rounds ?? 0} + ${r.repsExtras ?? 0} (cap)`;
  switch (r.tipo) {
    case "tempo":
      return mmss(r.tempoSec);
    case "rounds_reps":
      return `${r.rounds ?? 0} + ${r.repsExtras ?? 0}`;
    case "reps":
      return `${r.reps ?? 0} reps`;
    case "carga":
      return `${r.cargaKg ?? 0} kg`;
    case "distancia":
      return `${r.distanciaM ?? 0} m`;
  }
}
