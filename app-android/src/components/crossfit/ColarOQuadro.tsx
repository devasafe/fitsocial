// Colar o quadro da aula em vez de montar bloco por bloco.
//
// Um WOD de box tem aquecimento, skill, três partes e os descansos entre elas:
// oito blocos de formulário para um quadro que a pessoa copia em vinte
// segundos. Aqui ela cola, e confere o que saiu.
//
// A leitura preenche o QUE ESTAVA NO QUADRO e nunca o resultado — quanto ela
// fez não está escrito lá. Então depois de colar ela preenche três números, em
// vez de montar oito blocos.

import React, { useState } from "react";
import { View, TextInput } from "react-native";
import { Sheet } from "../Sheet";
import { Txt, Button } from "../ui";
import { EsperaLonga } from "../Espera";
import { notify } from "../../lib/notify";
import { useAuth } from "../../context/AuthContext";
import { lerQuadro, type Bloco } from "../../api/crossfit";
import { colors, radius, spacing } from "../../theme";

export function ColarOQuadro({
  visivel,
  aoFechar,
  aoLer,
}: {
  visivel: boolean;
  aoFechar: () => void;
  /** Recebe os blocos montados E o texto original — o texto fica guardado. */
  aoLer: (dados: {
    blocos: Bloco[];
    box: string | null;
    quadro: string;
  }) => void;
}) {
  const { token } = useAuth();
  const [texto, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);

  async function interpretar() {
    const limpo = texto.trim();
    if (limpo.length < 3) {
      notify(
        "Falta o quadro",
        "Cole o treino da aula para eu montar os blocos.",
      );
      return;
    }

    setLendo(true);
    try {
      const leitura = await lerQuadro(token!, limpo);

      if (leitura.blocos.length === 0) {
        // Melhor um bloco a menos do que um bloco inventado. O texto vai junto
        // de qualquer jeito, então o treino continua registrável.
        notify(
          "Não consegui montar os blocos",
          leitura.observacao ||
            "O texto fica guardado do jeito que você colou.",
        );
      }

      aoLer({
        blocos: leitura.blocos,
        box: leitura.box ?? null,
        quadro: limpo,
      });
      setTexto("");
      aoFechar();
    } catch (err) {
      notify("Não deu para ler o quadro", (err as Error).message);
    } finally {
      setLendo(false);
    }
  }

  return (
    <Sheet visivel={visivel} aoFechar={aoFechar}>
      {/* O Sheet nao traz margem lateral; cada folha poe a sua. */}
      <View style={{ paddingHorizontal: spacing.gutter }}>
        <Txt variant="titleSection">Colar o quadro</Txt>
        <Txt
          variant="body"
          color={colors.text2}
          style={{ marginTop: 4, marginBottom: spacing.md }}
        >
          Cole o treino como está escrito. Eu monto os blocos e você confere — o
          resultado quem preenche é você, porque ele não está no quadro.
        </Txt>

        {lendo ? (
          <EsperaLonga
            ativo
            passos={[
              "Lendo o quadro…",
              "Separando os blocos…",
              "Montando os movimentos…",
            ]}
          />
        ) : (
          <>
            <TextInput
              value={texto}
              onChangeText={setTexto}
              multiline
              placeholder={"WARM-UP\nEMOM (1'15\") X 4\n-4 Beat Swing\n…"}
              placeholderTextColor={colors.text3}
              style={{
                backgroundColor: colors.surface2,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.media,
                color: colors.text,
                fontSize: 16,
                minHeight: 200,
                padding: spacing.md,
                textAlignVertical: "top",
              }}
            />
            <View style={{ marginTop: spacing.md }}>
              <Button
                title="Montar os blocos"
                onPress={() => void interpretar()}
                size="lg"
                glow
              />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}
