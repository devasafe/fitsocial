// A lista de movimentos de um bloco.
//
// A ordem é a ordem do treino — é ela que preserva um chipper, onde 100 double
// unders vêm antes de 50 wall balls. Por isso mover para cima/baixo existe.
//
// Cada movimento tem UMA medida principal ("quanto?"), e o campo muda conforme
// a medida: reps, distância, calorias ou tempo. Mostrar os quatro ao mesmo
// tempo daria quatro caixas vazias para quem só quer escrever "15 Wall Balls".

import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Txt } from "../ui";
import { Campo, Linha, Opcoes, entradaBase, paraInteiro, paraNumero, paraRepScheme, paraSegundos, repSchemeParaTexto, mmss } from "./campos";
import type { Movimento, UnidadeDeCarga } from "../../api/crossfit";
import { colors, radius, spacing } from "../../theme";

type Medida = "reps" | "scheme" | "distancia" | "calorias" | "tempo";

const MEDIDAS: { id: Medida; label: string }[] = [
  { id: "reps", label: "Reps" },
  { id: "scheme", label: "21-15-9" },
  { id: "distancia", label: "Metros" },
  { id: "calorias", label: "Calorias" },
  { id: "tempo", label: "Tempo" },
];

const UNIDADES: { id: UnidadeDeCarga; label: string }[] = [
  { id: "kg", label: "kg" },
  { id: "lb", label: "lb" },
  { id: "percent_1rm", label: "% 1RM" },
  { id: "corporal", label: "corporal" },
];

/** Descobre a medida em uso, para reabrir o editor no campo certo. */
function medidaDe(m: Movimento): Medida {
  if (m.repScheme?.length) return "scheme";
  if (m.distanciaM != null) return "distancia";
  if (m.calorias != null) return "calorias";
  if (m.duracaoSec != null) return "tempo";
  return "reps";
}

function valorDe(m: Movimento, medida: Medida): string {
  switch (medida) {
    case "scheme":
      return repSchemeParaTexto(m.repScheme);
    case "distancia":
      return m.distanciaM != null ? String(m.distanciaM) : "";
    case "calorias":
      return m.calorias != null ? String(m.calorias) : "";
    case "tempo":
      return mmss(m.duracaoSec);
    default:
      return m.reps != null ? String(m.reps) : "";
  }
}

/** Aplica a medida escolhida, limpando as outras: só uma vale por vez. */
function comMedida(m: Movimento, medida: Medida, texto: string): Movimento {
  const limpo: Movimento = {
    ...m,
    reps: null,
    repScheme: null,
    distanciaM: null,
    calorias: null,
    duracaoSec: null,
  };
  switch (medida) {
    case "scheme":
      return { ...limpo, repScheme: paraRepScheme(texto) };
    case "distancia":
      return { ...limpo, distanciaM: paraNumero(texto) };
    case "calorias":
      return { ...limpo, calorias: paraInteiro(texto) };
    case "tempo":
      return { ...limpo, duracaoSec: paraSegundos(texto) };
    default:
      return { ...limpo, reps: paraInteiro(texto) };
  }
}

export function MovimentosEditor({
  movimentos,
  aoMudar,
  comCarga = true,
}: {
  movimentos: Movimento[];
  aoMudar: (movs: Movimento[]) => void;
  comCarga?: boolean;
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
                <Campo
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
                <Txt variant="titleCard" color={i === movimentos.length - 1 ? colors.text3 : colors.text2}>
                  ↓
                </Txt>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => aoMudar(movimentos.filter((_, j) => j !== i))} hitSlop={8}>
                <Txt variant="titleCard" color={colors.danger}>
                  ×
                </Txt>
              </TouchableOpacity>
            </View>

            <Opcoes
              valor={medida}
              opcoes={MEDIDAS}
              aoEscolher={(id) => aoMudar(movimentos.map((mm, j) => (j === i ? comMedida(mm, id, "") : mm)))}
            />

            <Linha>
              <Campo
                valor={valorDe(m, medida)}
                aoMudar={(t) => aoMudar(movimentos.map((mm, j) => (j === i ? comMedida(mm, medida, t) : mm)))}
                placeholder={
                  medida === "scheme" ? "21-15-9" : medida === "tempo" ? "mm:ss" : "quanto?"
                }
                teclado={medida === "scheme" || medida === "tempo" ? "default" : "numeric"}
                flex={comCarga ? 1 : 2}
              />
              {comCarga ? (
                <Campo
                  valor={m.carga?.valor != null ? String(m.carga.valor) : ""}
                  aoMudar={(t) =>
                    atualizar(i, {
                      carga: {
                        valor: paraNumero(t),
                        unidade: m.carga?.unidade ?? "kg",
                        texto: m.carga?.texto ?? null,
                      },
                    })
                  }
                  placeholder="carga"
                  teclado="numeric"
                />
              ) : null}
            </Linha>

            {comCarga && m.carga?.valor != null ? (
              <Opcoes
                valor={m.carga.unidade}
                opcoes={UNIDADES}
                aoEscolher={(id) =>
                  atualizar(i, { carga: { ...m.carga!, unidade: id } })
                }
              />
            ) : null}
          </View>
        );
      })}

      <TouchableOpacity
        onPress={() => aoMudar([...movimentos, { nome: "" }])}
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

/** Resumo curto de um movimento, para o card do bloco. */
export function resumoDoMovimento(m: Movimento): string {
  const quanto = m.repScheme?.length
    ? m.repScheme.join("-")
    : m.reps != null
      ? String(m.reps)
      : m.distanciaM != null
        ? `${m.distanciaM}m`
        : m.calorias != null
          ? `${m.calorias} cal`
          : m.duracaoSec != null
            ? mmss(m.duracaoSec)
            : "";
  const carga =
    m.carga?.valor != null
      ? ` @ ${m.carga.valor}${m.carga.unidade === "percent_1rm" ? "% 1RM" : m.carga.unidade === "corporal" ? "" : ` ${m.carga.unidade}`}`
      : "";
  return `${quanto ? `${quanto} ` : ""}${m.nome}${carga}`.trim();
}
