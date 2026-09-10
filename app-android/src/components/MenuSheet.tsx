import React from "react";
import { TouchableOpacity, View } from "react-native";
import { Sheet } from "./Sheet";
import { Txt } from "./ui";
import { colors, spacing } from "../theme";

// Lista de ações do menu (...). Só mostra o que a pessoa pode fazer: ação sem
// permissão não aparece desabilitada, não aparece.

export interface AcaoDoMenu {
  chave: string;
  rotulo: string;
  descricao?: string;
  perigosa?: boolean;
  aoTocar: () => void;
}

export function MenuSheet({
  visivel,
  aoFechar,
  acoes,
}: {
  visivel: boolean;
  aoFechar: () => void;
  acoes: AcaoDoMenu[];
}) {
  return (
    <Sheet visivel={visivel} aoFechar={aoFechar}>
      <View>
        {acoes.map((a) => (
          <TouchableOpacity
            key={a.chave}
            activeOpacity={0.7}
            onPress={() => {
              aoFechar();
              a.aoTocar();
            }}
            style={{
              paddingHorizontal: spacing.gutter,
              paddingVertical: spacing.md,
            }}
          >
            <Txt variant="bodyStrong" color={a.perigosa ? colors.danger : colors.text}>
              {a.rotulo}
            </Txt>
            {a.descricao ? (
              <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                {a.descricao}
              </Txt>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
    </Sheet>
  );
}
