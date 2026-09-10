import React from "react";
import { Modal, Pressable, View } from "react-native";
import { colors, radius, spacing } from "../theme";

// Bottom sheet reutilizável. Cada tela que precisou disso reimplementou o seu
// (CoachSheet, ExerciseVideoModal) — este existe para a próxima não repetir.
//
// Tocar fora fecha, porque um menu que só fecha no botão faz a pessoa procurar
// a saída.

export function Sheet({
  visivel,
  aoFechar,
  children,
}: {
  visivel: boolean;
  aoFechar: () => void;
  children: React.ReactNode;
}) {
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
            paddingBottom: spacing.xl,
            paddingTop: spacing.sm,
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
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
