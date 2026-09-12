import React, { useCallback, useState } from "react";
import { View, Image } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Card, Button } from "./ui";
import { listarConvitesRecebidos, rotuloDoPapel, type ConviteRecebido } from "../api/pro";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

/**
 * O convite esperando resposta, onde não tem como não ver.
 *
 * Nasceu porque depender da notificação era frágil demais: ela some da lista
 * quando outras chegam, some de vez se a pessoa deslizar sem ler, e no
 * aplicativo instalado nem abre nada ao ser tocada. Um convite que exige
 * resposta não pode morar só num aviso passageiro — e a tela de
 * acompanhamentos, dentro de Configurações, é fundo demais para quem ainda não
 * sabe que foi convidado.
 *
 * Some sozinho quando não há convite: nenhum espaço é gasto no caso normal.
 */
export function ConvitesPendentes() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [convites, setConvites] = useState<ConviteRecebido[]>([]);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      listarConvitesRecebidos(token!)
        .then((r) => vivo && setConvites(r))
        // Silencioso de propósito: é um extra da tela, e uma falha aqui não
        // pode encher a Home de erro sobre algo que talvez nem exista.
        .catch(() => vivo && setConvites([]));
      return () => {
        vivo = false;
      };
    }, [token])
  );

  if (convites.length === 0) return null;

  return (
    <>
      {convites.map((c) => (
        <Card key={c.code} level={2}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            {c.profissional.avatarUrl ? (
              <Image
                source={{ uri: c.profissional.avatarUrl }}
                style={{ width: 44, height: 44, borderRadius: radius.full }}
              />
            ) : (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.full,
                  backgroundColor: colors.surface3,
                }}
              />
            )}
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
    </>
  );
}
