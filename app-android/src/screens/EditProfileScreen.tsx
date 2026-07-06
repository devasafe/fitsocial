import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Platform, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../context/AuthContext";
import { updateMe } from "../api/auth";
import { uploadImage } from "../api/uploads";
import { Avatar } from "../components/Avatar";
import { PrimaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme";

export function EditProfileScreen() {
  const nav = useNavigation();
  const { user, token, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function pickImage() {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permissão necessária", "Autorize o acesso às fotos."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(asset.uri)).blob();
        form.append("image", blob, asset.fileName ?? "avatar.jpg");
      } else {
        form.append("image", { uri: asset.uri, name: asset.fileName ?? "avatar.jpg", type: asset.mimeType ?? "image/jpeg" } as unknown as Blob);
      }
      const { url } = await uploadImage(token!, form);
      setAvatarUrl(url);
    } catch (e) {
      Alert.alert("Não foi possível enviar a foto", (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true); setError("");
    try {
      await updateMe(token!, { name, username, bio, avatarUrl });
      await refreshUser();
      nav.goBack();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.avatarRow}>
        <Avatar uri={avatarUrl} name={name || "?"} size={84} />
        <TouchableOpacity onPress={pickImage} disabled={uploading}>
          <Text style={styles.change}>{uploading ? "Enviando…" : "Trocar foto"}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.label}>@usuário</Text>
      <TextInput style={styles.input} value={username} autoCapitalize="none" onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ""))} placeholder="seu_usuario" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Nome</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Seu nome" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Bio ({bio.length}/160)</Text>
      <TextInput style={[styles.input, styles.bio]} value={bio} onChangeText={(v) => setBio(v.slice(0, 160))} placeholder="Fale de você" placeholderTextColor={colors.textMuted} multiline />
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <PrimaryButton title="Salvar" onPress={handleSave} loading={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm },
  avatarRow: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  change: { color: colors.primary, fontWeight: "700" },
  label: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, color: colors.text, fontSize: 16 },
  bio: { height: 90, textAlignVertical: "top" },
  err: { color: colors.danger, fontWeight: "600" },
});
