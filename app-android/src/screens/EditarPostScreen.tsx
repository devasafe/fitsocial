import React, { useState } from "react";
import { View, TextInput, Image } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { editarPost } from "../api/social";
import { Screen, Txt, Button, Card } from "../components/ui";
import { notify } from "../lib/notify";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

// Editar altera só o texto. A imagem fica: trocá-la depois de curtidas e
// comentários mudaria aquilo que as pessoas endossaram — vira outra publicação
// com o histórico social da anterior.

export function EditarPostScreen() {
  const route = useRoute<RouteProp<AppStackParams, "EditarPost">>();
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const post = route.params.post;

  const [texto, setTexto] = useState(post.text ?? "");
  const [salvando, setSalvando] = useState(false);

  const semConteudo = !texto.trim() && !post.imageUrl && !post.activity;

  async function salvar() {
    setSalvando(true);
    try {
      await editarPost(token!, post.id, texto);
      nav.goBack();
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Screen scroll underHeader>
      <Txt variant="titleScreen" style={{ marginBottom: spacing.md }}>
        Editar publicação
      </Txt>

      <TextInput
        value={texto}
        onChangeText={setTexto}
        placeholder="O que você quer dizer?"
        placeholderTextColor={colors.text3}
        multiline
        autoFocus
        style={{
          backgroundColor: colors.surface2,
          borderColor: colors.line,
          borderRadius: radius.card,
          borderWidth: 1,
          color: colors.text,
          fontSize: 16,
          minHeight: 130,
          padding: spacing.md,
          textAlignVertical: "top",
        }}
      />

      {post.imageUrl ? (
        <Card style={{ marginTop: spacing.md }}>
          <Image
            source={{ uri: post.imageUrl }}
            style={{ borderRadius: radius.media, height: 180, width: "100%" }}
          />
          <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.sm }}>
            A foto continua a mesma. Para trocar a imagem, publique de novo.
          </Txt>
        </Card>
      ) : null}

      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <Button
          title="Salvar alterações"
          onPress={salvar}
          loading={salvando}
          disabled={semConteudo}
          size="lg"
          glow
        />
        <Button title="Cancelar" variant="ghost" onPress={() => nav.goBack()} disabled={salvando} />
      </View>

      {semConteudo ? (
        <Txt variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
          A publicação ficaria vazia. Escreva algo ou exclua a publicação.
        </Txt>
      ) : null}
    </Screen>
  );
}
