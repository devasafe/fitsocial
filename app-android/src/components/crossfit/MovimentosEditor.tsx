// A lista de movimentos de um bloco.
//
// A ordem é a ordem do treino — é ela que preserva um chipper, onde 100 double
// unders vêm antes de 50 wall balls. Por isso mover para cima/baixo existe.
//
// Cada movimento tem UMA medida ("quanto?"), e o campo muda conforme a unidade:
// reps, metros, calorias ou tempo. Mostrar as quatro ao mesmo tempo daria
// quatro caixas vazias para quem só quer escrever "15 Wall Balls".
//
// O NOME não leva número junto. Num campo só, o autocomplete acumularia
// "10 Bíceps Curl", "12 Bíceps Curl" e "15 Bíceps Curl" como exercícios
// distintos, e o acervo da pessoa apodreceria em um mês.

import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Txt } from "../ui";
import {
  Campo,
  CampoComSugestoes,
  Linha,
  Opcoes,
  paraInteiro,
  paraNumero,
  paraRepScheme,
  paraSegundos,
  mmss,
} from "./campos";
import {
  ROTULO_DO_ESCOPO,
  type Escopo,
  type Movimento,
  type UnidadeDeCarga,
  type UnidadeDeVolume,
} from "../../api/crossfit";
import { colors, radius, spacing } from "../../theme";

/** "escada" não é unidade do modelo: é reps com valor em lista. */
type Medida = UnidadeDeVolume | "escada";

const MEDIDAS: { id: Medida; label: string }[] = [
  { id: "reps", label: "Reps" },
  { id: "escada", label: "21-15-9" },
  { id: "metros", label: "Metros" },
  { id: "cal", label: "Calorias" },
  { id: "seg", label: "Tempo" },
];

const UNIDADES: { id: UnidadeDeCarga; label: string }[] = [
  { id: "kg", label: "kg" },
  { id: "lb", label: "lb" },
  { id: "percent_1rm", label: "% 1RM" },
  { id: "corporal", label: "corporal" },
];

const ESCOPOS_VISIVEIS: { id: Escopo; label: string }[] = [
  { id: "individual", label: "Cada um faz tudo" },
  { id: "dividido", label: "Dividido" },
  { id: "cada", label: "Cada um" },
  { id: "junto", label: "Juntos" },
];

function medidaDe(m: Movimento): Medida {
  if (!m.volume) return "reps";
  if (Array.isArray(m.volume.valor)) return "escada";
  return m.volume.unidade;
}

function textoDoValor(m: Movimento, medida: Medida): string {
  const v = m.volume;
  if (!v) return "";
  if (medida === "escada") return Array.isArray(v.valor) ? v.valor.join("-") : String(v.valor);
  if (Array.isArray(v.valor)) return v.valor.join("-");
  return medida === "seg" ? mmss(v.valor) : String(v.valor);
}

/** Aplica o que foi digitado à medida escolhida. Vazio apaga o volume. */
function comMedida(m: Movimento, medida: Medida, texto: string): Movimento {
  if (!texto.trim()) return { ...m, volume: null };

  if (medida === "escada") {
    const escada = paraRepScheme(texto);
    // Um número só numa escada ainda é um número: vira reps normal em vez de
    // sumir enquanto a pessoa digita o primeiro dígito.
    const valor = escada ?? paraInteiro(texto);
    return valor == null ? { ...m, volume: null } : { ...m, volume: { valor, unidade: "reps" } };
  }

  const valor = medida === "seg" ? paraSegundos(texto) : paraInteiro(texto);
  return valor == null ? { ...m, volume: null } : { ...m, volume: { valor, unidade: medida } };
}

export function MovimentosEditor({
  movimentos,
  aoMudar,
  comCarga = true,
  emEquipe = false,
}: {
  movimentos: Movimento[];
  aoMudar: (m: Movimento[]) => void;
  comCarga?: boolean;
  /** Só com time > 1 o escopo muda alguma conta. */
  emEquipe?: boolean;
}) {
  function atualizar(i: number, patch: Partial<Movimento>) {
    aoMudar(movimentos.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  function trocar(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= movimentos.length) return;
    const copia = [...movimentos];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    aoMudar(copia);
  }

  return (
    <View style={{ gap: spacing.md }}>
      {movimentos.map((m, i) => {
        const medida = medidaDe(m);
        return (
          <View
            key={i}
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.card,
              padding: spacing.md,
              gap: spacing.sm,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Txt variant="label" color={colors.text3}>
                {i + 1}
              </Txt>
              <View style={{ flex: 1 }}>
                <CampoComSugestoes
                  tipo="movimento"
                  valor={m.nome}
                  aoMudar={(t) => atualizar(i, { nome: t })}
                  placeholder="Movimento (ex.: Thruster)"
                />
              </View>
              {/* A ordem importa: num chipper ela É o treino. */}
              <TouchableOpacity onPress={() => trocar(i, -1)} hitSlop={8} disabled={i === 0}>
                <Txt variant="titleCard" color={i === 0 ? colors.text3 : colors.text2}>
                  ↑
                </Txt>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => trocar(i, 1)}
                hitSlop={8}
                disabled={i === movimentos.length - 1}
              >
                <Txt
                  variant="titleCard"
                  color={i === movimentos.length - 1 ? colors.text3 : colors.text2}
                >
                  ↓
                </Txt>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => aoMudar(movimentos.filter((_, j) => j !== i))}
                hitSlop={8}
              >
                <Txt variant="titleCard" color={colors.danger}>
                  ×
                </Txt>
              </TouchableOpacity>
            </View>

            <Opcoes
              valor={medida}
              opcoes={MEDIDAS}
              aoEscolher={(id) =>
                aoMudar(
                  movimentos.map((mm, j) =>
                    j === i ? comMedida(mm, id, textoDoValor(mm, medidaDe(mm))) : mm
                  )
                )
              }
            />

            <Linha>
              <Campo
                valor={textoDoValor(m, medida)}
                aoMudar={(t) =>
                  aoMudar(movimentos.map((mm, j) => (j === i ? comMedida(mm, medida, t) : mm)))
                }
                placeholder={
                  medida === "escada" ? "21-15-9" : medida === "seg" ? "mm:ss" : "quanto?"
                }
                teclado={medida === "escada" || medida === "seg" ? "default" : "numeric"}
              />
              <Campo
                rotulo="Séries"
                valor={m.series != null ? String(m.series) : ""}
                aoMudar={(t) => atualizar(i, { series: paraInteiro(t) })}
                placeholder="3×"
                teclado="numeric"
              />
            </Linha>

            {comCarga ? (
              <Linha>
                <Campo
                  rotulo="Carga"
                  valor={m.carga?.rx != null ? String(m.carga.rx) : ""}
                  aoMudar={(t) =>
                    atualizar(i, {
                      carga: {
                        ...(m.carga ?? { unidade: "kg" }),
                        rx: paraNumero(t),
                      },
                    })
                  }
                  placeholder="43"
                  teclado="numeric"
                />
                {/* A segunda prescrição do quadro: o "/30" de "43/30". Fica
                    sempre visível porque ela é do QUADRO, não da pessoa — e
                    esconder atrás de um toque fez o campo nunca ser usado. */}
                <Campo
                  rotulo="Carga (2ª)"
                  valor={m.carga?.rxF != null ? String(m.carga.rxF) : ""}
                  aoMudar={(t) =>
                    atualizar(i, {
                      carga: {
                        ...(m.carga ?? { unidade: "kg" }),
                        rxF: paraNumero(t),
                      },
                    })
                  }
                  placeholder="30"
                  teclado="numeric"
                />
              </Linha>
            ) : null}

            {comCarga && (m.carga?.rx != null || m.carga?.rxF != null) ? (
              <Opcoes
                valor={m.carga.unidade}
                opcoes={UNIDADES}
                aoEscolher={(id) => atualizar(i, { carga: { ...m.carga!, unidade: id } })}
              />
            ) : null}

            {/* "400m Run together" e "2 Rope Climb (cada)" no MESMO bloco: é
                por isso que o escopo é de cada movimento, e não do bloco. */}
            {emEquipe ? (
              <View style={{ gap: 4 }}>
                <Opcoes
                  valor={m.escopo}
                  opcoes={ESCOPOS_VISIVEIS}
                  aoEscolher={(id) => atualizar(i, { escopo: id })}
                />
                <Txt variant="caption" color={colors.text3}>
                  {ROTULO_DO_ESCOPO[m.escopo]}
                </Txt>
              </View>
            ) : null}
          </View>
        );
      })}

      <TouchableOpacity
        onPress={() =>
          aoMudar([...movimentos, { nome: "", volume: null, carga: null, escopo: "individual" }])
        }
        activeOpacity={0.7}
        style={{
          borderWidth: 1,
          borderColor: colors.lineStrong,
          borderStyle: "dashed",
          borderRadius: radius.card,
          paddingVertical: spacing.md,
          alignItems: "center",
        }}
      >
        <Txt variant="bodyStrong" color={colors.text2}>
          + Movimento
        </Txt>
      </TouchableOpacity>
    </View>
  );
}

/** Resumo curto de um movimento, para o card do bloco e para o preview. */
export function resumoDoMovimento(m: Movimento): string {
  const v = m.volume;
  const quanto = !v
    ? ""
    : Array.isArray(v.valor)
      ? v.valor.join("-")
      : v.unidade === "metros"
        ? `${v.valor}m`
        : v.unidade === "cal"
          ? `${v.valor} cal`
          : v.unidade === "seg"
            ? mmss(v.valor)
            : String(v.valor);

  const series = m.series ? `${m.series}×` : "";

  const carga =
    m.carga?.rx != null
      ? ` @ ${m.carga.rx}${m.carga.rxF != null ? `/${m.carga.rxF}` : ""}${
          m.carga.unidade === "percent_1rm"
            ? "% 1RM"
            : m.carga.unidade === "corporal"
              ? ""
              : ` ${m.carga.unidade}`
        }`
      : m.carga?.texto
        ? ` @ ${m.carga.texto}`
        : "";

  const escopo =
    m.escopo === "cada" ? " (cada)" : m.escopo === "junto" ? " (juntos)" : "";

  return `${series}${quanto ? `${quanto} ` : ""}${m.nome}${carga}${escopo}`.trim();
}
