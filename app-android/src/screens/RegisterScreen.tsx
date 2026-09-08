import React, { useState } from "react";
import {
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { notify } from "../lib/notify";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Field, Button, Txt } from "../components/ui";
import { colors, spacing } from "../theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (password.length < 8) {
      notify("Senha curta", "A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    setLoading(true);
    try {
      await register(name.trim(), email.trim(), password, username || undefined);
    } catch (err) {
      notify("Não foi possível cadastrar", (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        <Txt variant="titleScreen" style={styles.title}>
          Criar conta
        </Txt>
        <Txt variant="body" color={colors.text2} style={styles.subtitle}>
          Leva menos de um minuto.
        </Txt>

        <Field label="Nome" value={name} onChangeText={setName} placeholder="Seu nome" />

        <Field
          label="@usuário"
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ""))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="seu_usuario"
        />
        <Txt variant="caption" color={colors.text3} style={styles.hint}>
          3 a 20 caracteres: letras minúsculas, números, ponto e sublinhado
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
          placeholder="mínimo 8 caracteres"
        />

        <Button title="Criar conta" onPress={handleRegister} loading={loading} size="lg" glow />

        <TouchableOpacity
          style={styles.link}
          onPress={() => navigation.navigate("Login")}
          activeOpacity={0.7}
        >
          <Txt variant="body" color={colors.text2}>
            Já tem conta? <Txt variant="bodyStrong" color={colors.lime}>Entrar</Txt>
          </Txt>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flexGrow: 1, justifyContent: "center", padding: spacing.gutter },
  title: { marginBottom: spacing.xs },
  subtitle: { marginBottom: spacing.xl },
  hint: { marginTop: -spacing.sm, marginBottom: spacing.md },
  link: { marginTop: spacing.lg, alignItems: "center" },
});
