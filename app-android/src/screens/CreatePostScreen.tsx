import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { createPost } from "../api/social";
import { PrimaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme";

export function CreatePostScreen() {
  const nav = useNavigation();
  const { token } = useAuth();
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function handlePost() {
    const body = text.trim();
    if (!body) return;
    setSaving(true);
    try {
      await createPost(token!, body, imageUrl.trim() || undefined);
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

        <Text style={styles.label}>URL da foto (opcional)</Text>
        <TextInput
          style={styles.input}
          value={imageUrl}
          onChangeText={setImageUrl}
          placeholder="https://…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="url"
        />
        <Text style={styles.hint}>
          O envio de fotos direto da galeria entra numa próxima etapa; por ora, cole
          uma URL de imagem.
        </Text>

        <View style={{ height: spacing.lg }} />
        <PrimaryButton title="Publicar" onPress={handlePost} loading={saving} disabled={!text.trim()} />
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
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs, lineHeight: 17 },
});
