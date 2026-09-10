// Bloco de força — o mesmo formato da musculação, série a série.
//
// "5×5 a 100 kg" e "80/85/90/95/100" são o MESMO dado: cinco séries. O botão
// "repetir série" existe porque digitar cinco linhas iguais no celular, cansado,
// é o tipo de atrito que faz a pessoa não registrar.

import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Txt } from "../ui";
import { Campo, Linha, paraInteiro, paraNumero } from "./campos";
import type { BlocoForca, ExercicioDeForca, SerieDeForca } from "../../api/crossfit";
import { colors, radius, spacing } from "../../theme";

export function EditorDeForca({
  bloco,
  aoMudar,
}: {
  bloco: BlocoForca;
  aoMudar: (b: BlocoForca) => void;
}) {
  function atualizarExercicio(i: number, patch: Partial<ExercicioDeForca>) {
    aoMudar({
      ...bloco,
      exercicios: bloco.exercicios.map((e, j) => (j === i ? { ...e, ...patch } : e)),
    });
  }

  function atualizarSerie(ei: number, si: number, patch: Partial<SerieDeForca>) {
    const ex = bloco.exercicios[ei];
    atualizarExercicio(ei, {
      sets: ex.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)),
    });
  }

  return (
    <View style={{ gap: spacing.md }}>
      {bloco.exercicios.map((ex, ei) => (
        <View
          key={ei}
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.card,
            padding: spacing.md,
            gap: spacing.sm,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Campo
                valor={ex.name}
                aoMudar={(t) => atualizarExercicio(ei, { name: t })}
                placeholder="Exercício (ex.: Back Squat)"
              />
            </View>
            {bloco.exercicios.length > 1 ? (
              <TouchableOpacity
                onPress={() =>
                  aoMudar({ ...bloco, exercicios: bloco.exercicios.filter((_, j) => j !== ei) })
                }
                hitSlop={8}
                style={{ paddingBottom: 12 }}
              >
                <Txt variant="titleCard" color={colors.danger}>
                  ×
                </Txt>
              </TouchableOpacity>
            ) : null}
          </View>

          {ex.sets.map((s, si) => (
            <Linha key={si}>
              <View style={{ justifyContent: "center", width: 28 }}>
                <Txt variant="label" color={colors.text3}>
                  {si + 1}
                </Txt>
              </View>
              <Campo
                valor={s.reps != null ? String(s.reps) : ""}
                aoMudar={(t) => atualizarSerie(ei, si, { reps: paraInteiro(t) })}
                placeholder="reps"
                teclado="numeric"
              />
              <Campo
                valor={s.weightKg ? String(s.weightKg) : ""}
                aoMudar={(t) => atualizarSerie(ei, si, { weightKg: paraNumero(t) ?? 0 })}
                placeholder="kg"
                teclado="numeric"
              />
              {ex.sets.length > 1 ? (
                <TouchableOpacity
                  onPress={() =>
                    atualizarExercicio(ei, { sets: ex.sets.filter((_, j) => j !== si) })
                  }
                  hitSlop={8}
                  style={{ justifyContent: "center", width: 24 }}
                >
                  <Txt variant="body" color={colors.text3}>
                    ×
                  </Txt>
                </TouchableOpacity>
              ) : (
                <View style={{ width: 24 }} />
              )}
            </Linha>
          ))}

          <TouchableOpacity
            onPress={() => {
              // Repete a última: cinco séries iguais viram um toque, e quem sobe
              // carga só troca o número.
              const ultima = ex.sets[ex.sets.length - 1] ?? { weightKg: 0, reps: null };
              atualizarExercicio(ei, { sets: [...ex.sets, { ...ultima }] });
            }}
            activeOpacity={0.7}
            style={{ alignSelf: "flex-start", paddingVertical: spacing.xs }}
          >
            <Txt variant="label" color={colors.lime}>
              + Repetir série
            </Txt>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        onPress={() =>
          aoMudar({
            ...bloco,
            exercicios: [...bloco.exercicios, { name: "", sets: [{ weightKg: 0, reps: null }] }],
          })
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
          + Exercício
        </Txt>
      </TouchableOpacity>
    </View>
  );
}

/** Resumo para o card: "Back Squat · 5×5 · até 100 kg". */
export function resumoDaForca(bloco: BlocoForca): string[] {
  return bloco.exercicios
    .filter((e) => e.name.trim())
    .map((e) => {
      const cargas = e.sets.map((s) => s.weightKg).filter((k) => k > 0);
      const reps = e.sets[0]?.reps;
      const iguais = cargas.length > 0 && cargas.every((k) => k === cargas[0]);
      const parteCarga = cargas.length
        ? iguais
          ? ` · ${cargas[0]} kg`
          : ` · até ${Math.max(...cargas)} kg`
        : "";
      return `${e.name} · ${e.sets.length}×${reps ?? "—"}${parteCarga}`;
    });
}
