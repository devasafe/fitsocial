import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { useAuth } from "../context/AuthContext";
import { checkUsername, updateMe } from "../api/auth";
import { PrimaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme";

export function ChooseUsernameScreen() {
  const { token, refreshUser, logout } = useAuth();
  const [username, setUsername] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const valid = /^[a-z0-9._]{3,20}$/.test(username) && !username.startsWith(".") && !username.endsWith(".") && !username.includes("..");

  useEffect(() => {
    setAvailable(null);
    if (timer.current) clearTimeout(timer.current);
    if (!valid) { setChecking(false); return; }
    setChecking(true);
    let cancelled = false;
    timer.current = setTimeout(async () => {
      try {
        const { available } = await checkUsername(token!, username);
        if (!cancelled) setAvailable(available);
      } catch {
        if (!cancelled) setAvailable(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [username, valid, token]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await updateMe(token!, { username });
      await refreshUser();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Escolha seu @usuário</Text>
      <Text style={styles.sub}>É como as pessoas vão te encontrar. Pode trocar depois.</Text>
      <View style={styles.inputRow}>
        <Text style={styles.at}>@</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ""))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="seu_usuario"
          placeholderTextColor={colors.textMuted}
        />
        {checking ? <ActivityIndicator color={colors.textMuted} /> : null}
      </View>
      <Text style={styles.hint}>3–20 caracteres: letras minúsculas, números, . e _</Text>
      {valid && available === false ? <Text style={styles.err}>Esse nome já está em uso.</Text> : null}
      {valid && available === true ? <Text style={styles.ok}>Disponível ✓</Text> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <PrimaryButton title="Continuar" onPress={handleSave} loading={saving} disabled={!valid || available !== true} />
      <TouchableOpacity onPress={logout} style={styles.logout}>
        <Text style={styles.logoutText}>Sair da conta</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: "center", gap: spacing.sm },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.textMuted, marginBottom: spacing.md },
  inputRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  at: { color: colors.textMuted, fontSize: 16 },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: spacing.md, paddingHorizontal: spacing.xs },
  hint: { color: colors.textMuted, fontSize: 12 },
  ok: { color: colors.primary, fontWeight: "700" },
  err: { color: colors.danger, fontWeight: "600" },
  logout: { alignItems: "center", marginTop: spacing.md },
  logoutText: { color: colors.textMuted, fontWeight: "600" },
});
