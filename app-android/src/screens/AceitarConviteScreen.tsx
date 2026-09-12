import React, { useCallback, useEffect, useState } from "react";
import { View, Image, Switch, ActivityIndicator } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, ErrorState } from "../components/ui";
import {
  O_QUE_ABRE,
  aceitarConvite,
  rotuloDoPapel,
  verConvite,
  type ConvitePreview,
  type Escopo,
} from "../api/pro";
import { limparConvite } from "../lib/convitePendente";
import { ApiHttpError } from "../api/client";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

/**
 * A tela em que o aluno decide o que abrir.
 *
 * É o consentimento, e por isso ela não é um "ok" — mostra quem é o
 * profissional primeiro, e cada coisa que será aberta em uma linha própria,
 * com o que aquilo significa. Autorizar alguém a ver seu peso e suas fotos não
 * pode caber num botão só.
 *
 * Treino vem ligado porque é o mínimo do acompanhamento: sem ele o
 * profissional não tem o que acompanhar. O resto vem desligado.
 */
export function AceitarConviteScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const route = useRoute<RouteProp<AppStackParams, "AceitarConvite">>();
  const { token } = useAuth();
  const code = route.params?.code ?? "";

  const [convite, setConvite] = useState<ConvitePreview | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [escopo, setEscopo] = useState<Escopo>({
    treinos: true,
    dieta: false,
    medidas: false,
    fotos: false,
  });

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setConvite(await verConvite(token!, code));
      setErro(null);
    } catch (e) {
      setErro(
        e instanceof ApiHttpError ? e.message : "Não foi possível abrir este convite."
      );
    } finally {
      setCarregando(false);
    }
  }, [token, code]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function aceitar() {
    if (!convite) return;
    setEnviando(true);
    try {
      await aceitarConvite(token!, code, escopo);
      await limparConvite();
      nav.replace("Acompanhamentos");
    } catch (e) {
      setErro(e instanceof ApiHttpError ? e.message : "Não foi possível aceitar.");
      setEnviando(false);
    }
  }

  async function agoraNao() {
    // Recusar apaga o convite guardado: sem isso ele voltaria a aparecer na
    // próxima abertura do app, e recusar deixaria de ser uma resposta.
    await limparConvite();
    nav.replace("Tabs");
  }

  if (carregando) {
    return (
      <Screen underHeader>
        <View style={{ paddingTop: spacing.xl, alignItems: "center" }}>
          <ActivityIndicator color={colors.lime} />
        </View>
      </Screen>
    );
  }

  if (erro || !convite) {
    return (
      <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
        <ErrorState message={erro ?? "Convite inválido."} onRetry={carregar} />
        <Button title="Voltar" variant="secondary" onPress={agoraNao} />
      </Screen>
    );
  }

  const papel = rotuloDoPapel(convite.papel);

  if (convite.jaVinculado) {
    return (
      <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
        <Card level={1}>
          <Txt variant="titleCard">Você já é acompanhado por {convite.profissional.nome}</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.s8 }}>
            Para mudar o que está aberto, vá em Acompanhamentos.
          </Txt>
        </Card>
        <Button title="Ver acompanhamentos" onPress={() => nav.replace("Acompanhamentos")} />
      </Screen>
    );
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      <Card level={2}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {convite.profissional.avatarUrl ? (
            <Image
              source={{ uri: convite.profissional.avatarUrl }}
              style={{ width: 56, height: 56, borderRadius: radius.full }}
            />
          ) : (
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.full,
                backgroundColor: colors.surface3,
              }}
            />
          )}
          <View style={{ flex: 1 }}>
            <Txt variant="titleCard">{convite.profissional.nome}</Txt>
            <Txt variant="body" color={colors.text2}>
              quer te acompanhar como {papel}
            </Txt>
          </View>
        </View>
      </Card>

      <View>
        <Txt variant="titleSection">O que você abre</Txt>
        <Txt variant="body" color={colors.text2} style={{ marginTop: 2 }}>
          Você escolhe agora e pode mudar quando quiser.
        </Txt>
      </View>

      {O_QUE_ABRE.map((item) => (
        <Card key={item.chave} level={1}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{item.titulo}</Txt>
              <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                {item.explica}
              </Txt>
            </View>
            <Switch
              value={escopo[item.chave]}
              onValueChange={(v) => setEscopo((e) => ({ ...e, [item.chave]: v }))}
              trackColor={{ false: colors.surface3, true: colors.limeDeep }}
              thumbColor={escopo[item.chave] ? colors.lime : colors.text3}
            />
          </View>
        </Card>
      ))}

      <Txt variant="caption" color={colors.text3}>
        {convite.profissional.nome} não vê suas conversas, seus dados de acesso nem o percurso dos
        seus treinos ao ar livre.
      </Txt>

      <Button
        title={enviando ? "Aceitando…" : `Aceitar acompanhamento`}
        onPress={aceitar}
        disabled={enviando}
      />
      <Button title="Agora não" variant="secondary" onPress={agoraNao} />
    </Screen>
  );
}
