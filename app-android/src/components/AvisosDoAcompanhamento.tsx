import React, { useCallback, useState } from "react";
import { View, Image, AppState } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Card, Button } from "./ui";
import { buscarAvisos, rotuloDoPapel, type Avisos } from "../api/pro";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

/**
 * O que o acompanhamento está esperando de você, na Home.
 *
 * Duas coisas moram aqui, e as duas pelo mesmo motivo: pedem resposta. Um
 * convite que ninguém respondeu deixa um profissional esperando; uma mensagem
 * não lida deixa uma conversa pela metade.
 *
 * Aparece SOZINHO, sem recarregar a tela: enquanto a Home está na frente da
 * pessoa, pergunta a cada vinte segundos se há algo novo. Vinte, e não oito
 * como na conversa, porque aqui ninguém está esperando resposta — é um aviso
 * que pode chegar com meio minuto de atraso sem prejuízo nenhum, e a Home fica
 * aberta muito mais tempo que uma conversa.
 *
 * Some inteiro quando não há nada pendente: no dia a dia, não custa espaço.
 */
const DE_QUANTO_EM_QUANTO_MS = 20_000;

const VAZIO: Avisos = { convites: [], conversas: [] };

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
  const [avisos, setAvisos] = useState<Avisos>(VAZIO);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;

      // Silencioso de propósito: é um extra da Home, e uma falha aqui não pode
      // encher a tela de erro sobre algo que talvez nem exista.
      const buscar = () => {
        if (AppState.currentState !== "active") return;
        buscarAvisos(token!)
          .then((r) => vivo && setAvisos(r))
          .catch(() => vivo && setAvisos(VAZIO));
      };

      buscar();
      const relogio = setInterval(buscar, DE_QUANTO_EM_QUANTO_MS);
      // Voltar para o app é quando mais provavelmente há algo novo.
      const sub = AppState.addEventListener("change", (estado) => {
        if (estado === "active") buscar();
      });

      return () => {
        vivo = false;
        clearInterval(relogio);
        sub.remove();
      };
    }, [token])
  );

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
