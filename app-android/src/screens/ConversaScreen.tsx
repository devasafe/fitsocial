import React, { useCallback, useRef, useState } from "react";
import {
  View,
  FlatList,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, ErrorState } from "../components/ui";
import * as ImagePicker from "expo-image-picker";
import { buscarMensagens, enviarMensagem, type Mensagem } from "../api/pro";
import { uploadImage } from "../api/uploads";
import { notify } from "../lib/notify";
import { ApiHttpError } from "../api/client";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

/**
 * A conversa com o profissional.
 *
 * Lista invertida: a mensagem mais nova fica embaixo, encostada no campo de
 * escrever, e a rolagem sobe para o passado. É como toda conversa funciona, e
 * é o que evita ter de rolar até o fim toda vez que a tela abre.
 *
 * Sem tempo real, como no painel: busca ao abrir e ao voltar o foco. Um
 * `setInterval` numa tela que fica aberta seria consumo constante de bateria
 * por uma mensagem que chega de vez em quando.
 */
export function ConversaScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const route = useRoute<RouteProp<AppStackParams, "Conversa">>();
  const { token, user } = useAuth();
  const { linkId, nome } = route.params;

  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [encerrado, setEncerrado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const carregandoMais = useRef(false);

  const carregar = useCallback(async () => {
    try {
      const r = await buscarMensagens(token!, linkId);
      setMensagens(r.itens);
      setCursor(r.nextCursor);
      setEncerrado(r.encerrado);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ApiHttpError ? e.message : "Não foi possível abrir a conversa.");
    } finally {
      setCarregando(false);
    }
  }, [token, linkId]);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar])
  );

  // O título da tela é o nome de quem está do outro lado — quem abriu daqui já
  // sabe com quem fala, e repetir isso no corpo seria ruído.
  useFocusEffect(
    useCallback(() => {
      nav.setOptions({ title: nome });
    }, [nav, nome])
  );

  async function maisAntigas() {
    if (!cursor || carregandoMais.current) return;
    carregandoMais.current = true;
    try {
      const r = await buscarMensagens(token!, linkId, cursor);
      setMensagens((atual) => [...atual, ...r.itens]);
      setCursor(r.nextCursor);
    } catch {
      // Falhar em buscar o passado não pode apagar o presente da tela.
    } finally {
      carregandoMais.current = false;
    }
  }

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || enviando) return;

    setEnviando(true);
    setErro(null);
    try {
      const nova = await enviarMensagem(token!, linkId, { texto: conteudo });
      setMensagens((atual) => [nova, ...atual]);
      setTexto("");
    } catch (e) {
      // O texto continua na caixa: perder o que a pessoa escreveu por causa de
      // uma falha de rede é o pior jeito de avisar que houve falha.
      setErro(e instanceof ApiHttpError ? e.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Manda uma foto: sobe pelo mesmo `POST /uploads` do resto do app, que
   * reencoda e descarta o EXIF — inclusive a coordenada de GPS —, e só então a
   * mensagem carrega a URL.
   */
  async function mandarFoto() {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        notify("Permissão necessária", "Autorize o acesso às fotos para enviar uma imagem.");
        return;
      }
    }

    const escolha = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (escolha.canceled) return;

    const asset = escolha.assets[0];
    setEnviando(true);
    setErro(null);
    try {
      const form = new FormData();
      if (Platform.OS === "web") {
        // No web o uri é blob/data URL: converte antes de enviar.
        const blob = await (await fetch(asset.uri)).blob();
        form.append("image", blob, asset.fileName ?? "foto.jpg");
      } else {
        form.append("image", {
          uri: asset.uri,
          name: asset.fileName ?? "foto.jpg",
          type: asset.mimeType ?? "image/jpeg",
        } as unknown as Blob);
      }

      const { url, width, height } = await uploadImage(token!, form);
      const nova = await enviarMensagem(token!, linkId, {
        imageUrl: url,
        imageWidth: width,
        imageHeight: height,
      });
      setMensagens((atual) => [nova, ...atual]);
    } catch (e) {
      setErro(e instanceof ApiHttpError ? e.message : "Não foi possível enviar a foto.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} />
      </View>
    );
  }

  if (erro && mensagens.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.gutter }}>
        <ErrorState message={erro} onRetry={carregar} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={mensagens}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.gutter, gap: spacing.s8 }}
        onEndReached={maisAntigas}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <Txt variant="body" color={colors.text3} style={{ textAlign: "center", marginTop: spacing.xl }}>
            Nenhuma mensagem ainda.
          </Txt>
        }
        renderItem={({ item }) => {
          const meu = item.autor === user?.id;
          return (
            <View
              style={{
                maxWidth: "82%",
                alignSelf: meu ? "flex-end" : "flex-start",
                backgroundColor: meu ? colors.limeDeep : colors.surface2,
                borderRadius: radius.card,
                paddingVertical: spacing.s8,
                paddingHorizontal: spacing.md,
              }}
            >
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={{
                    width: 220,
                    height: 220,
                    borderRadius: radius.chip,
                    marginBottom: item.texto ? spacing.s8 : 0,
                  }}
                  resizeMode="cover"
                />
              ) : null}

              {item.texto ? <Txt variant="body">{item.texto}</Txt> : null}

              <Txt variant="caption" color={colors.text3} style={{ marginTop: 4 }}>
                {new Date(item.createdAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Txt>
            </View>
          );
        }}
      />

      {erro && mensagens.length > 0 && (
        <Txt variant="caption" color={colors.danger} style={{ paddingHorizontal: spacing.gutter }}>
          {erro}
        </Txt>
      )}

      {encerrado ? (
        <View style={{ padding: spacing.gutter, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Txt variant="caption" color={colors.text3} style={{ textAlign: "center" }}>
            Acompanhamento encerrado. O histórico fica, mas não dá para escrever.
          </Txt>
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            gap: spacing.s8,
            padding: spacing.gutter,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            alignItems: "flex-end",
          }}
        >
          <Pressable
            onPress={mandarFoto}
            disabled={enviando}
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.full,
              backgroundColor: colors.surface2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Txt variant="bodyStrong" color={colors.text2}>
              ⊕
            </Txt>
          </Pressable>

          <TextInput
            value={texto}
            onChangeText={setTexto}
            placeholder="Escreva uma mensagem…"
            placeholderTextColor={colors.text3}
            multiline
            maxLength={2000}
            style={{
              flex: 1,
              color: colors.text,
              backgroundColor: colors.surface2,
              borderRadius: radius.card,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.s8,
              maxHeight: 120,
              fontSize: 15,
            }}
          />
          <Pressable
            onPress={enviar}
            disabled={enviando || !texto.trim()}
            style={{
              backgroundColor: texto.trim() ? colors.lime : colors.surface3,
              borderRadius: radius.full,
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Txt variant="bodyStrong" color={texto.trim() ? colors.onLime : colors.text3}>
              ↑
            </Txt>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
