import React from "react";
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { colors, radius, spacing } from "../theme";

// Bottom sheet reutilizável. Cada tela que precisou disso reimplementou o seu
// (CoachSheet, ExerciseVideoModal) — este existe para a próxima não repetir.
//
// Tocar fora fecha, porque um menu que só fecha no botão faz a pessoa procurar
// a saída.
//
// A folha ROLA POR DENTRO, com teto de altura. Sem isso ela cresce para cima
// sem limite e o TOPO sai da tela: o editor de bloco abria no meio do
// formulário, com o campo mais importante — o modo do treino — já fora de
// vista, e nada indicava que havia algo acima.

export function Sheet({
  visivel,
  aoFechar,
  children,
}: {
  visivel: boolean;
  aoFechar: () => void;
  children: React.ReactNode;
}) {
  const { height: altura } = useWindowDimensions();

  return (
    <Modal visible={visivel} transparent animationType="slide" onRequestClose={aoFechar}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(8,11,9,0.6)", justifyContent: "flex-end" }}
        onPress={aoFechar}
      >
        {/* Toque dentro do sheet não fecha. */}
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.surface2,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            borderTopWidth: 1,
            borderColor: colors.line,
            paddingTop: spacing.sm,
            // 88%: sobra um naco do fundo escurecido em cima, que é o que diz
            // "isto é uma folha, toque fora para sair".
            maxHeight: altura * 0.88,
          }}
        >
          {/* Alça: sinaliza que dá para arrastar/fechar. */}
          <View
            style={{
              alignSelf: "center",
              backgroundColor: colors.line,
              borderRadius: 2,
              height: 4,
              marginBottom: spacing.md,
              width: 36,
            }}
          />
          {/* `bounces` desligado: no iOS a folha inteira balançava junto e
              parecia que ia fechar. */}
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
