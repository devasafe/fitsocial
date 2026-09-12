import React, { useCallback, useState } from "react";
import { View, Image } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Card, Button } from "./ui";
import {
  buscarNaoLidas,
  listarAcompanhamentos,
  listarConvitesRecebidos,
  rotuloDoPapel,
  type Acompanhamento,
  type ConviteRecebido,
} from "../api/pro";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

/**
 * O que o acompanhamento está esperando de você, na Home.
 *
 * Duas coisas moram aqui, e as duas pelo mesmo motivo: pedem resposta. Um
 * convite que ninguém respondeu deixa um profissional esperando; uma mensagem
 * não lida deixa uma conversa pela metade. Nenhuma das duas podia depender de
 * a pessoa entrar em Configurações para descobrir que existe.
 *
 * Some inteiro quando não há nada pendente — no dia a dia, não custa espaço
 * nenhum na tela.
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

export function AvisosDoAcompanhamento() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [convites, setConvites] = useState<ConviteRecebido[]>([]);
  const [comMensagem, setComMensagem] = useState<{ a: Acompanhamento; quantas: number }[]>([]);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;

      // Silencioso de propósito: é um extra da Home, e uma falha aqui não pode
      // encher a tela de erro sobre algo que talvez nem exista.
      Promise.all([
        listarConvitesRecebidos(token!).catch(() => []),
        listarAcompanhamentos(token!).catch(() => []),
        buscarNaoLidas(token!).catch(() => ({}) as Record<string, number>),
      ]).then(([recebidos, acompanhamentos, naoLidas]) => {
        if (!vivo) return;
        setConvites(recebidos);
        setComMensagem(
          acompanhamentos
            .map((a) => ({ a, quantas: naoLidas[a.id] ?? 0 }))
            .filter((x) => x.quantas > 0)
        );
      });

      return () => {
        vivo = false;
      };
    }, [token])
  );

  if (convites.length === 0 && comMensagem.length === 0) return null;

  return (
    <>
      {convites.map((c) => (
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

      {comMensagem.map(({ a, quantas }) => (
        <Card key={a.id} level={1}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Avatar url={a.profissional.avatarUrl} />
            <View style={{ flex: 1 }}>
              <Txt variant="titleCard">{a.profissional.nome}</Txt>
              <Txt variant="caption" color={colors.lime}>
                {quantas === 1 ? "1 mensagem nova" : `${quantas} mensagens novas`}
              </Txt>
            </View>
          </View>
          <Button
            title="Ler mensagens"
            onPress={() => nav.navigate("Conversa", { linkId: a.id, nome: a.profissional.nome })}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ))}
    </>
  );
}
