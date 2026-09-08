import React, { useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { notify } from "../lib/notify";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../context/AuthContext";
import { createPost } from "../api/social";
import { uploadImage } from "../api/uploads";
import { Button, Txt } from "../components/ui";
import { colors, radius, spacing, type as typeScale } from "../theme";

export function CreatePostScreen() {
  const nav = useNavigation();
  const { token } = useAuth();
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function pickImage() {
    // Em nativo, pede permissão da galeria (no web não é necessário).
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        notify("Permissão necessária", "Autorize o acesso às fotos para adicionar uma imagem.");
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const form = new FormData();
      if (Platform.OS === "web") {
        // No web, o uri é blob/data URL: converte para blob antes de enviar.
        const blob = await (await fetch(asset.uri)).blob();
        form.append("image", blob, asset.fileName ?? "foto.jpg");
      } else {
        form.append("image", {
          uri: asset.uri,
          name: asset.fileName ?? "foto.jpg",
          type: asset.mimeType ?? "image/jpeg",
        } as unknown as Blob);
      }
      const { url } = await uploadImage(token!, form);
      setImageUrl(url);
    } catch (err) {
      notify("Não foi possível enviar a foto", (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handlePost() {
    const body = text.trim();
    if (!body) return;
    setSaving(true);
    try {
      await createPost(token!, body, imageUrl ?? undefined);
      nav.goBack();
    } catch (err) {
      notify("Não foi possível postar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Txt variant="titleScreen" style={styles.title}>
          Compartilhe sua evolução
        </Txt>
        <Txt variant="label" color={colors.text2} style={styles.label}>
          Como foi seu treino de hoje?
        </Txt>
        <TextInput
          style={styles.textArea}
          value={text}
          onChangeText={setText}
          placeholder="Conte o que você treinou, como se sentiu e o que veio de novo."
          placeholderTextColor={colors.text3}
          multiline
          autoFocus
        />

        {imageUrl ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: imageUrl }} style={styles.preview} />
            <TouchableOpacity style={styles.removeBtn} onPress={() => setImageUrl(null)} activeOpacity={0.7}>
              <Txt variant="bodyStrong" color={colors.danger}>
                Remover foto
              </Txt>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.pickBtn} onPress={pickImage} disabled={uploading} activeOpacity={0.7}>
            {uploading ? (
              <ActivityIndicator color={colors.lime} />
            ) : (
              <Txt variant="bodyStrong" color={colors.text2}>
                Adicionar foto
              </Txt>
            )}
          </TouchableOpacity>
        )}

        <View style={styles.spacer} />
        <Button
          title="Publicar"
          size="lg"
          onPress={handlePost}
          loading={saving}
          disabled={!text.trim() || uploading}
          glow
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, padding: spacing.gutter },
  title: { marginTop: spacing.sm, marginBottom: spacing.lg },
  label: { marginBottom: spacing.sm },
  textArea: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: spacing.md,
    color: colors.text,
    fontFamily: typeScale.body.fontFamily,
    fontSize: 16,
    minHeight: 140,
    textAlignVertical: "top",
  },
  pickBtn: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderStyle: "dashed",
    borderRadius: radius.card,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  previewWrap: { marginTop: spacing.md },
  preview: { width: "100%", height: 260, borderRadius: radius.media, backgroundColor: colors.surface2 },
  removeBtn: { alignSelf: "center", paddingVertical: spacing.s12 },
  spacer: { height: spacing.lg },
});
