import React from "react";
import { View, Image } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Txt, Card, Button } from "./ui";
import { rotuloDoPapel, type Avisos } from "../api/pro";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

/**
 * O que o acompanhamento está esperando de você, na Home.
 *
 * Duas coisas moram aqui, e as duas pelo mesmo motivo: pedem resposta. Um
 * convite que ninguém respondeu deixa um profissional esperando; uma mensagem
 * não lida deixa uma conversa pela metade.
 *
 * Os dados chegam de fora (`useAcompanhamento`, na Home): o cartão do treinador
 * precisa da MESMA resposta, e dois relógios batendo na mesma rota seria pagar
 * duas vezes por ela.
 *
 * Some inteiro quando não há nada pendente: no dia a dia, não custa espaço.
 */

function Avatar({ url, tamanho = 44 }: { url?: string; tamanho?: number }) {
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: tamanho, height: tamanho, borderRadius: radius.full }}
      />
    );
  }
  return (
    <View
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: radius.full,
        backgroundColor: colors.surface3,
      }}
    />
  );
}

export function AvisosDoAcompanhamento({ avisos }: { avisos: Avisos }) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();

  if (avisos.convites.length === 0 && avisos.conversas.length === 0) return null;

  return (
    <>
      {avisos.convites.map((c) => (
        <Card key={c.code} level={2}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Avatar url={c.profissional.avatarUrl} />
            <View style={{ flex: 1 }}>
              <Txt variant="titleCard">{c.profissional.nome}</Txt>
              <Txt variant="caption" color={colors.text2}>
                quer te acompanhar como {rotuloDoPapel(c.papel)}
              </Txt>
            </View>
          </View>
          <Button
            title="Ver convite"
            onPress={() => nav.navigate("AceitarConvite", { code: c.code })}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ))}

      {/* O treinador tem cartão próprio na Home — mas ele fica DEPOIS de
          constância, comida e água. Enquanto há mensagem não lida, ela sobe
          para cá, que é o topo: o aviso de um treino novo é a primeira coisa
          que a pessoa precisa ver, não a sexta. Sem nada para ler, some daqui
          e o cartão dele lá embaixo basta. */}
      {avisos.conversas.map((c) => (
        <Card key={c.id} level={1}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Avatar url={c.profissional.avatarUrl} />
            <View style={{ flex: 1 }}>
              <Txt variant="titleCard">{c.profissional.nome}</Txt>
              <Txt variant="caption" color={colors.lime}>
                {c.naoLidas === 1 ? "1 mensagem nova" : `${c.naoLidas} mensagens novas`}
              </Txt>
            </View>
          </View>
          <Button
            title="Ler mensagens"
            onPress={() => nav.navigate("Conversa", { linkId: c.id, nome: c.profissional.nome })}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ))}
    </>
  );
}
