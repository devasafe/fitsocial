import React, { useState } from "react";
import { View, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity } from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Field, Button, Txt } from "../components/ui";
import { colors, spacing } from "../theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Login">;

export function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      notify("Não deu para entrar", (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Txt variant="metricLg" color={colors.lime} style={styles.logo}>
          FitSocial
        </Txt>
        <Txt variant="body" color={colors.text2} style={styles.subtitle}>
          Seu treino, sua evolução e sua comunidade num só lugar.
        </Txt>

        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="voce@email.com"
        />
        <Field
          label="Senha"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />

        <Button title="Entrar" onPress={handleLogin} loading={loading} size="lg" glow />

        <TouchableOpacity
          style={styles.linkSenha}
          onPress={() => navigation.navigate("EsqueciSenha")}
          activeOpacity={0.7}
        >
          <Txt variant="body" color={colors.text2}>
            Esqueci minha senha
          </Txt>
        </TouchableOpacity>

        <TouchableOpacity style={styles.link} onPress={() => navigation.navigate("Register")} activeOpacity={0.7}>
          <Txt variant="body" color={colors.text2}>
            Ainda não tem conta? <Txt variant="bodyStrong" color={colors.lime}>Criar conta</Txt>
          </Txt>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", padding: spacing.gutter },
  logo: { textAlign: "center" },
  subtitle: { textAlign: "center", marginBottom: spacing.xl, marginTop: spacing.sm },
  link: { marginTop: spacing.lg, alignItems: "center" },
  linkSenha: { marginTop: spacing.md, alignItems: "center" },
});
