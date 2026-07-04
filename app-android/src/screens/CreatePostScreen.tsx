import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../context/AuthContext";
import { createPost } from "../api/social";
import { uploadImage } from "../api/uploads";
import { PrimaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme";

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
        Alert.alert("Permissão necessária", "Autorize o acesso às fotos para adicionar uma imagem.");
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
      Alert.alert("Não foi possível enviar a foto", (err as Error).message);
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
      Alert.alert("Não foi possível postar", (err as Error).message);
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
        <Text style={styles.label}>Compartilhe sua evolução</Text>
        <TextInput
          style={styles.textArea}
          value={text}
          onChangeText={setText}
          placeholder="Como foi seu treino hoje? Conte pra galera…"
          placeholderTextColor={colors.textMuted}
          multiline
          autoFocus
        />

        {imageUrl ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: imageUrl }} style={styles.preview} />
            <TouchableOpacity style={styles.removeBtn} onPress={() => setImageUrl(null)}>
              <Text style={styles.removeText}>Remover foto</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.pickBtn} onPress={pickImage} disabled={uploading}>
            {uploading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.pickText}>📷 Adicionar foto</Text>
            )}
          </TouchableOpacity>
        )}

        <View style={{ height: spacing.lg }} />
        <PrimaryButton
          title="Publicar"
          onPress={handlePost}
          loading={saving}
          disabled={!text.trim() || uploading}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, padding: spacing.lg },
  label: { color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.md, fontSize: 13 },
  textArea: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: "top",
  },
  pickBtn: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: "dashed",
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  pickText: { color: colors.primary, fontWeight: "700" },
  previewWrap: { marginTop: spacing.md },
  preview: { width: "100%", height: 240, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  removeBtn: { alignSelf: "center", padding: spacing.sm },
  removeText: { color: colors.danger, fontWeight: "600" },
});
