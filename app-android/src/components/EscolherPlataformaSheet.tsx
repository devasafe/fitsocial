// A pergunta que aparece uma vez: onde você quer ver a execução do exercício.
//
// Perguntar toda vez seria um toque a mais entre a pessoa e o vídeo, no meio do
// treino — que é exatamente quando ninguém tem paciência. Por isso a resposta
// fica guardada, e mudar de ideia mora nas Configurações.

import React from "react";
import { TouchableOpacity, View } from "react-native";
import { Sheet } from "./Sheet";
import { Txt } from "./ui";
import { colors, spacing } from "../theme";
import { NOME_DA_PLATAFORMA, type PlataformaDeVideo } from "../lib/plataformaDeVideo";

const OPCOES: { chave: PlataformaDeVideo; descricao: string }[] = [
  { chave: "youtube", descricao: "Vídeo-aula completa, com explicação passo a passo." },
  { chave: "tiktok", descricao: "Vídeo curto, direto na execução." },
];

export function EscolherPlataformaSheet({
  visivel,
  aoFechar,
  aoEscolher,
  atual,
}: {
  visivel: boolean;
  aoFechar: () => void;
  aoEscolher: (plataforma: PlataformaDeVideo) => void;
  /** Marca a opção já guardada, quando o sheet é aberto para trocar. */
  atual?: PlataformaDeVideo | null;
}) {
  return (
    <Sheet visivel={visivel} aoFechar={aoFechar}>
      <View style={{ paddingHorizontal: spacing.gutter, paddingBottom: spacing.sm }}>
        <Txt variant="titleCard">Ver a execução onde?</Txt>
        <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
          Fica guardado. Dá para trocar em Configurações.
        </Txt>
      </View>

      {OPCOES.map((o) => {
        const escolhida = atual === o.chave;
        return (
          <TouchableOpacity
            key={o.chave}
            activeOpacity={0.7}
            onPress={() => {
              aoFechar();
              aoEscolher(o.chave);
            }}
            style={{ paddingHorizontal: spacing.gutter, paddingVertical: spacing.md }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Txt variant="bodyStrong" color={escolhida ? colors.lime : colors.text}>
                {NOME_DA_PLATAFORMA[o.chave]}
              </Txt>
              {escolhida ? (
                <Txt variant="caption" color={colors.lime}>
                  atual
                </Txt>
              ) : null}
            </View>
            <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
              {o.descricao}
            </Txt>
          </TouchableOpacity>
        );
      })}
    </Sheet>
  );
}
