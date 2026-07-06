import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Field, PrimaryButton } from "../components/ui";
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
      Alert.alert("Senha curta", "A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    setLoading(true);
    try {
      await register(name.trim(), email.trim(), password, username || undefined);
    } catch (err) {
      Alert.alert("Não foi possível cadastrar", (err as Error).message);
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
        <Text style={styles.title}>Criar conta</Text>
        <Text style={styles.subtitle}>Comece hoje sua jornada fit.</Text>

        <Field label="Nome" value={name} onChangeText={setName} placeholder="Seu nome" />
        <View>
          <Field
            label="@usuário"
            value={username}
            onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ""))}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="seu_usuario"
          />
          <Text style={styles.hint}>3–20 caracteres: letras minúsculas, números, . e _</Text>
        </View>
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

        <PrimaryButton title="Criar conta" onPress={handleRegister} loading={loading} />

        <TouchableOpacity
          style={styles.link}
          onPress={() => navigation.navigate("Login")}
        >
          <Text style={styles.linkText}>
            Já tem conta? <Text style={styles.linkStrong}>Entrar</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", padding: spacing.lg },
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  subtitle: { color: colors.textMuted, marginBottom: spacing.xl, marginTop: spacing.xs },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs, marginBottom: spacing.md },
  link: { marginTop: spacing.lg, alignItems: "center" },
  linkText: { color: colors.textMuted },
  linkStrong: { color: colors.primary, fontWeight: "700" },
});
