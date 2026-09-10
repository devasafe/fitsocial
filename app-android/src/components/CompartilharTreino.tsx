// Levar o treino para o Instagram (ou para onde a pessoa quiser).
//
// O cartão é montado no servidor com a foto do post, o nome do treino, os
// números e — em corrida e pedal — o traçado do percurso. Aqui só se escolhe o
// destino e se espera o desenho ficar pronto.
//
// Duas saídas, porque são dois desejos: Story é o caminho de um toque logo
// depois do treino; a bandeja do sistema cobre o feed do Instagram, o WhatsApp
// e o resto.

import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { Sheet } from "./Sheet";
import { Txt } from "./ui";
import { EsperaLonga } from "./Espera";
import { notify } from "../lib/notify";
import { gerarCartao, type FormatoDoCartao } from "../api/social";
import { abrirBandeja, abrirStoryDoInstagram, temCompartilhamentoNativo } from "../lib/compartilhar";
import { useAuth } from "../context/AuthContext";
import { colors, radius, spacing } from "../theme";

export function CompartilharTreino({
  postId,
  visivel,
  aoFechar,
}: {
  postId: string;
  visivel: boolean;
  aoFechar: () => void;
}) {
  const { token } = useAuth();
  const [ocupado, setOcupado] = useState<FormatoDoCartao | null>(null);

  async function compartilhar(formato: FormatoDoCartao, paraStory: boolean) {
    if (ocupado) return;
    setOcupado(formato);
    try {
      const { url } = await gerarCartao(token!, postId, formato);

      // Story primeiro; se o Instagram não estiver instalado, a bandeja
      // resolve em vez de a pessoa tocar e nada acontecer.
      const foi = paraStory ? await abrirStoryDoInstagram(url) : false;
      if (!foi) await abrirBandeja(url);

      aoFechar();
    } catch (err) {
      notify("Não deu para compartilhar", (err as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Sheet visivel={visivel} aoFechar={aoFechar}>
      <Txt variant="titleSection" style={{ marginBottom: spacing.md }}>
        Compartilhar treino
      </Txt>
      <View style={{ gap: spacing.sm }}>
        {ocupado ? (
          <EsperaLonga ativo passos={["Montando seu cartão…"]} />
        ) : (
          <>
            {temCompartilhamentoNativo ? (
              <Opcao
                titulo="Story do Instagram"
                descricao="Abre o Instagram com a imagem pronta"
                aoTocar={() => void compartilhar("story", true)}
              />
            ) : null}
            <Opcao
              titulo={temCompartilhamentoNativo ? "Outro app" : "Baixar a imagem"}
              descricao={
                temCompartilhamentoNativo
                  ? "Feed do Instagram, WhatsApp, o que você preferir"
                  : "No navegador o Instagram não recebe imagem por link"
              }
              aoTocar={() => void compartilhar("feed", false)}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}

function Opcao({
  titulo,
  descricao,
  aoTocar,
}: {
  titulo: string;
  descricao: string;
  aoTocar: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={aoTocar}
      activeOpacity={0.8}
      style={{
        backgroundColor: colors.surface2,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        // Alvo confortável: isto é tocado com o celular na mão, depois do treino.
        minHeight: 64,
        justifyContent: "center",
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.s12,
      }}
    >
      <Txt variant="titleCard">{titulo}</Txt>
      <Txt variant="caption" color={colors.text2} style={{ marginTop: 2 }}>
        {descricao}
      </Txt>
    </TouchableOpacity>
  );
}
