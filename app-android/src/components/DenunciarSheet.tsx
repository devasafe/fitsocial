import React, { useState } from "react";
import { TouchableOpacity, View } from "react-native";
import { Sheet } from "./Sheet";
import { Txt, Button } from "./ui";
import { MOTIVOS_DE_DENUNCIA, denunciarPost } from "../api/social";
import { useAuth } from "../context/AuthContext";
import { notify } from "../lib/notify";
import { colors, radius, spacing } from "../theme";

// Escolher o motivo é o passo que faz a denúncia servir para alguma coisa: sem
// ele, quem analisa recebe "algo errado" e precisa adivinhar o quê.

export function DenunciarSheet({
  postId,
  visivel,
  aoFechar,
}: {
  postId: string | null;
  visivel: boolean;
  aoFechar: () => void;
}) {
  const { token } = useAuth();
  const [motivo, setMotivo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (!motivo || !postId) return;
    setEnviando(true);
    try {
      await denunciarPost(token!, postId, motivo);
      aoFechar();
      setMotivo(null);
      notify("Denúncia enviada", "Nossa equipe vai analisar o conteúdo.");
    } catch (err) {
      notify("Não deu para enviar", (err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Sheet
      visivel={visivel}
      aoFechar={() => {
        setMotivo(null);
        aoFechar();
      }}
    >
      <View style={{ paddingHorizontal: spacing.gutter }}>
        <Txt variant="titleCard">Por que está denunciando?</Txt>
        <Txt variant="caption" color={colors.text3} style={{ marginTop: 4, marginBottom: spacing.md }}>
          Isso não é enviado ao autor da publicação.
        </Txt>

        {MOTIVOS_DE_DENUNCIA.map((m) => {
          const ativo = motivo === m.chave;
          return (
            <TouchableOpacity
              key={m.chave}
              activeOpacity={0.7}
              onPress={() => setMotivo(m.chave)}
              style={{
                backgroundColor: ativo ? colors.surface3 : "transparent",
                borderColor: ativo ? colors.lime : colors.line,
                borderRadius: radius.chip,
                borderWidth: 1,
                marginBottom: spacing.xs,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              }}
            >
              <Txt variant="body" color={ativo ? colors.text : colors.text2}>
                {m.rotulo}
              </Txt>
            </TouchableOpacity>
          );
        })}

        <Button
          title="Enviar denúncia"
          onPress={enviar}
          disabled={!motivo || enviando}
          loading={enviando}
          size="lg"
          style={{ marginTop: spacing.md }}
        />
      </View>
    </Sheet>
  );
}
