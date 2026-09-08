import React, { useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { checkUsername, updateMe } from "../api/auth";
import { Button, Txt } from "../components/ui";
import { colors, radius, spacing, type as typeScale } from "../theme";

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

  const focused = valid && available === true;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Txt variant="titleScreen">Escolha seu @usuário</Txt>
        <Txt variant="body" color={colors.text2} style={styles.sub}>
          É como as pessoas vão te encontrar. Pode trocar depois.
        </Txt>

        <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
          <Txt variant="bodyStrong" color={colors.text3}>@</Txt>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ""))}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="seu_usuario"
            placeholderTextColor={colors.text3}
          />
          {checking ? <ActivityIndicator color={colors.text3} /> : null}
        </View>

        <Txt variant="caption" color={colors.text3} style={styles.hint}>
          3 a 20 caracteres: letras minúsculas, números, ponto e sublinhado
        </Txt>

        {valid && available === false ? (
          <Txt variant="label" color={colors.danger} style={styles.status}>
            Esse nome já está em uso.
          </Txt>
        ) : null}
        {valid && available === true ? (
          <Txt variant="label" color={colors.lime} style={styles.status}>
            Disponível ✓
          </Txt>
        ) : null}
        {error ? (
          <Txt variant="label" color={colors.danger} style={styles.status}>
            {error}
          </Txt>
        ) : null}

        <Button
          title="Continuar"
          onPress={handleSave}
          loading={saving}
          disabled={!valid || available !== true}
          size="lg"
          glow
          style={styles.cta}
        />

        <TouchableOpacity onPress={logout} style={styles.logout} activeOpacity={0.7}>
          <Txt variant="bodyStrong" color={colors.text2}>Sair da conta</Txt>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", padding: spacing.gutter },
  sub: { marginTop: spacing.sm, marginBottom: spacing.lg },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surface2,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
  },
  inputRowFocused: { borderColor: colors.lineStrong },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: typeScale.body.fontFamily,
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: spacing.xs,
  },
  hint: { marginTop: spacing.sm },
  status: { marginTop: spacing.sm },
  cta: { marginTop: spacing.lg },
  logout: { alignItems: "center", marginTop: spacing.md },
});
