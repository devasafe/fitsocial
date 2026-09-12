import React, { useCallback, useState } from "react";
import { View, Image, Switch, Alert, Platform } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button, ErrorState } from "../components/ui";
import { EmptyState } from "../components/EmptyState";
import { SkeletonLista } from "../components/Skeleton";
import {
  O_QUE_ABRE,
  ajustarEscopo,
  encerrarAcompanhamento,
  listarAcompanhamentos,
  listarConvitesRecebidos,
  rotuloDoPapel,
  type Acompanhamento,
  type ConviteRecebido,
  type Escopo,
} from "../api/pro";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

/**
 * Quem me acompanha — e o que cada um vê.
 *
 * A tela existe para que a resposta "sim" dada no convite continue sendo uma
 * decisão, e não algo que se dá uma vez e nunca mais se revê. Mudar um
 * interruptor aqui tira o acesso na hora.
 */
export function AcompanhamentosScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [lista, setLista] = useState<Acompanhamento[]>([]);
  const [convites, setConvites] = useState<ConviteRecebido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setLista(await listarAcompanhamentos(token!));
      setErro(false);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
    // Convite pendente é um extra da tela: falhar aqui não pode esconder os
    // acompanhamentos que já existem.
    try {
      setConvites(await listarConvitesRecebidos(token!));
    } catch {
      setConvites([]);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar])
  );

  async function mudar(a: Acompanhamento, chave: keyof Escopo, valor: boolean) {
    // Otimista com rollback: o interruptor precisa responder ao dedo na hora,
    // mas voltar sozinho se o servidor recusar — senão a tela mentiria sobre
    // quem tem acesso ao quê, que é o pior lugar para uma tela mentir.
    const antes = a.escopo[chave];
    setLista((atual) =>
      atual.map((x) => (x.id === a.id ? { ...x, escopo: { ...x.escopo, [chave]: valor } } : x))
    );
    try {
      await ajustarEscopo(token!, a.id, { [chave]: valor });
    } catch {
      setLista((atual) =>
        atual.map((x) => (x.id === a.id ? { ...x, escopo: { ...x.escopo, [chave]: antes } } : x))
      );
    }
  }

  function encerrar(a: Acompanhamento) {
    const titulo = `Encerrar com ${a.profissional.nome}?`;
    const texto = `Ele deixa de ver seus dados na hora. Você pode ser convidado de novo depois.`;

    const confirmar = async () => {
      try {
        await encerrarAcompanhamento(token!, a.id);
        carregar();
      } catch {
        setErro(true);
      }
    };

    // `Alert` do React Native não existe na web — o projeto já trata isso em
    // `lib/notify.ts`, e aqui vale a mesma regra.
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (window.confirm(`${titulo}\n\n${texto}`)) confirmar();
      return;
    }
    Alert.alert(titulo, texto, [
      { text: "Cancelar", style: "cancel" },
      { text: "Encerrar", style: "destructive", onPress: confirmar },
    ]);
  }

  if (carregando) {
    return (
      <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
        <SkeletonLista itens={2} altura={140} />
      </Screen>
    );
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      {/* Convite esperando resposta vem antes de tudo: é a única coisa nesta
          tela que pede uma ação, e não apenas informa. */}
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

      {erro && lista.length === 0 && convites.length === 0 ? (
        <ErrorState message="Não foi possível carregar." onRetry={carregar} />
      ) : lista.length === 0 && convites.length === 0 ? (
        <EmptyState
          icon="🤝"
          title="Ninguém te acompanha ainda"
          description="Quando um treinador ou nutricionista te mandar um convite, ele aparece aqui e você escolhe o que abrir."
          actionLabel="Voltar"
          onAction={() => nav.goBack()}
        />
      ) : (
        lista.map((a) => (
          <Card key={a.id} level={1}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              {a.profissional.avatarUrl ? (
                <Image
                  source={{ uri: a.profissional.avatarUrl }}
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
                <Txt variant="titleCard">{a.profissional.nome}</Txt>
                <Txt variant="caption" color={colors.text3}>
                  seu {rotuloDoPapel(a.papel)} desde{" "}
                  {new Date(a.desde).toLocaleDateString("pt-BR")}
                </Txt>
              </View>
            </View>

            <View style={{ marginTop: spacing.md, gap: spacing.s8 }}>
              {O_QUE_ABRE.map((item) => (
                <View
                  key={item.chave}
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
                >
                  <Txt variant="body" style={{ flex: 1 }}>
                    {item.titulo}
                  </Txt>
                  <Switch
                    value={a.escopo[item.chave]}
                    onValueChange={(v) => mudar(a, item.chave, v)}
                    trackColor={{ false: colors.surface3, true: colors.limeDeep }}
                    thumbColor={a.escopo[item.chave] ? colors.lime : colors.text3}
                  />
                </View>
              ))}
            </View>

            <Button
              title="Encerrar acompanhamento"
              variant="secondary"
              onPress={() => encerrar(a)}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}
