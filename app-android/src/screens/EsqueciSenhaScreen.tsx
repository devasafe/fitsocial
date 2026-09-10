// Recuperar a senha em uma tela só, em dois passos.
//
// Duas telas separadas fariam a pessoa perder o e-mail que acabou de digitar ao
// voltar — e voltar é comum aqui, porque o código chega em outro aplicativo e
// nem sempre chega rápido.
//
// A tela nunca diz se o e-mail tem conta. Não é omissão: se dissesse, qualquer
// um poderia usar esta tela para descobrir quem está cadastrado.

import React, { useState } from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { pedirCodigoDeSenha, redefinirSenhaComCodigo } from "../api/auth";
import { Screen, Txt, Field, Button, Card } from "../components/ui";
import { notify } from "../lib/notify";
import { colors, spacing } from "../theme";

const MINIMO = 8;

export function EsqueciSenhaScreen() {
  const nav = useNavigation();
  const { entrarComToken } = useAuth();

  const [passo, setPasso] = useState<"email" | "codigo">("email");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nova, setNova] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function pedirCodigo() {
    setOcupado(true);
    try {
      await pedirCodigoDeSenha(email.trim());
      setPasso("codigo");
    } catch (err) {
      notify("Não deu para enviar", (err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function concluir() {
    setOcupado(true);
    try {
      const { data } = await redefinirSenhaComCodigo(email.trim(), codigo.trim(), nova);
      // Entra direto: a pessoa acabou de provar que tem acesso ao e-mail, e
      // mandá-la digitar a senha que criou há dois segundos é fricção à toa.
      await entrarComToken(data.token, data.user);
    } catch (err) {
      notify("Não deu para redefinir", (err as Error).message);
      setOcupado(false);
    }
  }

  if (passo === "email") {
    return (
      <Screen scroll underHeader>
        <Txt variant="titleScreen">Esqueceu a senha?</Txt>
        <Txt variant="body" color={colors.text2} style={styles.texto}>
          Digite o e-mail da sua conta. Enviamos um código de 6 dígitos para criar uma senha
          nova.
        </Txt>

        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          placeholder="voce@email.com"
          autoFocus
        />

        <Button
          title="Enviar código"
          onPress={() => void pedirCodigo()}
          disabled={!email.includes("@") || ocupado}
          loading={ocupado}
          size="lg"
        />

        <TouchableOpacity style={styles.link} onPress={() => nav.goBack()} activeOpacity={0.7}>
          <Txt variant="body" color={colors.text2}>
            Lembrou? <Txt variant="bodyStrong" color={colors.lime}>Voltar para o login</Txt>
          </Txt>
        </TouchableOpacity>
      </Screen>
    );
  }

  const curta = nova.length > 0 && nova.length < MINIMO;

  return (
    <Screen scroll underHeader>
      <Txt variant="titleScreen">Digite o código</Txt>

      <Card level={2} style={styles.aviso}>
        <Txt variant="body" color={colors.text2}>
          Se <Txt variant="bodyStrong">{email.trim()}</Txt> tiver conta aqui, o código chegou
          por e-mail. Ele vale por 15 minutos.
        </Txt>
        <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.sm }}>
          Não chegou? Confira o spam — o remetente é do domínio satriz.club.
        </Txt>
      </Card>

      <Field
        label="Código de 6 dígitos"
        value={codigo}
        onChangeText={(t) => setCodigo(t.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        placeholder="000000"
        autoFocus
      />

      <Field
        label="Nova senha"
        value={nova}
        onChangeText={setNova}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder={`Pelo menos ${MINIMO} caracteres`}
      />

      {curta ? (
        <Txt variant="caption" color={colors.danger} style={styles.erro}>
          A senha precisa de pelo menos {MINIMO} caracteres.
        </Txt>
      ) : null}

      <Button
        title="Criar senha nova"
        onPress={() => void concluir()}
        disabled={codigo.length !== 6 || nova.length < MINIMO || ocupado}
        loading={ocupado}
        size="lg"
      />

      <Txt variant="caption" color={colors.text3} style={styles.rodape}>
        Ao criar a senha nova, qualquer aparelho conectado nesta conta é desconectado.
      </Txt>

      <TouchableOpacity
        style={styles.link}
        onPress={() => {
          setCodigo("");
          setPasso("email");
        }}
        activeOpacity={0.7}
      >
        <Txt variant="body" color={colors.text2}>
          Errou o e-mail? <Txt variant="bodyStrong" color={colors.lime}>Corrigir</Txt>
        </Txt>
      </TouchableOpacity>
    </Screen>
  );
}

const styles = StyleSheet.create({
  texto: { marginTop: spacing.sm, marginBottom: spacing.lg },
  aviso: { marginTop: spacing.md, marginBottom: spacing.lg },
  erro: { marginTop: -spacing.sm, marginBottom: spacing.md },
  rodape: { marginTop: spacing.md, textAlign: "center" },
  link: { marginTop: spacing.lg, alignItems: "center" },
});
