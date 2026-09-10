// Espera de ação longa — as que passam de dois segundos e dependem de IA ou
// upload.
//
// Spinner mudo por trinta segundos é indistinguível de tela travada: a pessoa
// não sabe se ainda está indo ou se morreu. Texto que AVANÇA resolve isso sem
// prometer precisão que não existe — não dá para saber a porcentagem de uma
// geração de IA, mas dá para dizer em que etapa ela está.
//
// O padrão nasceu na Home (geração de plano) e vivia preso lá. Aqui ele serve
// a todas as esperas longas: importar plano, gerar dieta, resposta do coach,
// upload de foto.

import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "./ui";
import { colors, spacing } from "../theme";

/** Quanto tempo cada etapa fica na tela antes de avançar. */
const PASSO_MS = 7000;

export function EsperaLonga({
  ativo,
  passos,
  style,
}: {
  ativo: boolean;
  /** Etapas em ordem. A última fica até a ação terminar — nunca "volta". */
  passos: readonly string[];
  style?: StyleProp<ViewStyle>;
}) {
  const [atual, setAtual] = useState(0);

  useEffect(() => {
    if (!ativo) {
      setAtual(0);
      return;
    }
    const t = setInterval(() => {
      // Trava na última: seguir girando faria a pessoa achar que recomeçou.
      setAtual((i) => Math.min(i + 1, passos.length - 1));
    }, PASSO_MS);
    return () => clearInterval(t);
  }, [ativo, passos.length]);

  if (!ativo) return null;

  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: spacing.sm }, style]}>
      <ActivityIndicator color={colors.lime} />
      <Txt variant="body" color={colors.text2} style={{ flex: 1 }}>
        {passos[atual] ?? passos[0]}
      </Txt>
    </View>
  );
}

/** Etapas prontas para as esperas que se repetem no app. */
export const PASSOS = {
  plano: [
    "Lendo sua ficha…",
    "Montando seu treino…",
    "Ajustando a dieta…",
    "Terminando os detalhes…",
  ],
  dieta: ["Lendo sua ficha…", "Calculando as calorias…", "Montando as refeições…"],
  importarPlano: [
    "Lendo o que você colou…",
    "Identificando os exercícios…",
    "Organizando em sessões…",
  ],
  foto: ["Preparando a foto…", "Enviando…"],
} as const;
