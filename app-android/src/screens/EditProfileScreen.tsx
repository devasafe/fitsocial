import React, { useState } from "react";
import { View, StyleSheet, TouchableOpacity, ScrollView, Platform, ActivityIndicator } from "react-native";
import { notify } from "../lib/notify";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../context/AuthContext";
import { updateMe } from "../api/auth";
import { uploadImage } from "../api/uploads";
import { Avatar } from "../components/Avatar";
import { Field, Button, Txt } from "../components/ui";
import { colors, spacing } from "../theme";

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
      if (!perm.granted) { notify("Permissão necessária", "Autorize o acesso às fotos."); return; }
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
      notify("Não foi possível enviar a foto", (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true); setError("");
    try {
      await updateMe(token!, {
        name,
        bio,
        avatarUrl,
        ...(username.trim() !== "" ? { username } : {}),
      });
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
        <TouchableOpacity onPress={pickImage} disabled={uploading} activeOpacity={0.7}>
          {uploading ? (
            // Texto parado não distingue "enviando" de "travou" — e a foto pode
            // ser grande no 4G do box.
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <ActivityIndicator color={colors.lime} size="small" />
              <Txt variant="bodyStrong" color={colors.text2}>
                Enviando foto…
              </Txt>
            </View>
          ) : (
            <Txt variant="bodyStrong" color={colors.lime}>
              Trocar foto
            </Txt>
          )}
        </TouchableOpacity>
      </View>

      <Field
        label="@usuário"
        value={username}
        autoCapitalize="none"
        onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ""))}
        placeholder="seu_usuario"
      />
      <Field
        label="Nome"
        value={name}
        onChangeText={setName}
        placeholder="Seu nome"
      />
      <Field
        label={`Bio (${bio.length}/160)`}
        value={bio}
        onChangeText={(v) => setBio(v.slice(0, 160))}
        placeholder="Fale de você"
        multiline
        style={styles.bio}
      />

      {error ? (
        <Txt variant="bodyStrong" color={colors.danger} style={styles.err}>
          {error}
        </Txt>
      ) : null}

      <Button title="Salvar" size="lg" onPress={handleSave} loading={saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.gutter },
  avatarRow: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  bio: { height: 96, textAlignVertical: "top" },
  err: { marginBottom: spacing.md },
});
