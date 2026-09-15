// A barra de macro e a linha "rótulo · valor / meta", num lugar só.
//
// Nasceram privadas no `DiarioScreen`, onde mostram o DIA. A tela de progresso
// de nutrição mostra a mesma barra com a soma do período no lugar do valor do
// dia — mesma forma, mesma leitura. Copiar o bloco faria as duas telas
// divergirem na primeira vez que uma delas mudasse de altura, de cor ou de
// arredondamento, e a pessoa leria duas barras diferentes para a mesma coisa.
import React from "react";
import { View } from "react-native";
import { Txt } from "./ui";
import { colors } from "../theme";

/** Quanto de `target` foi preenchido. Sem meta (`target` 0) não há barra a
 *  encher: fica vazia, em vez de cheia por divisão por zero. */
export function Bar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden", marginTop: 4 }}>
      <View style={{ width: `${pct}%`, height: 6, backgroundColor: colors.lime }} />
    </View>
  );
}

/** Um macro: o rótulo à esquerda, "consumido / meta" à direita, a barra embaixo. */
export function MacroRow({ label, v, t }: { label: string; v: number; t: number }) {
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Txt variant="label" color={colors.text2}>
          {label}
        </Txt>
        <Txt variant="label" tabular color={colors.text2}>
          {Math.round(v)} / {t} g
        </Txt>
      </View>
      <Bar value={v} target={t} />
    </View>
  );
}
