// Excluir a conta é o único caminho sem volta do app, e a tela trata assim:
// diz o que vai embora ANTES de pedir a senha, em vez de um "tem certeza?" que
// ninguém lê.
//
// Não existe "desativar". Desativar é continuar guardando os dados de alguém
// que pediu para parar — que é exatamente o que a pessoa está pedindo que
// acabe. O que volta, se ela voltar, é uma conta nova.

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useAuth } from "../context/AuthContext";
import { excluirConta } from "../api/auth";
import { Screen, Txt, Field, Button, Card } from "../components/ui";
import { confirmDialog, notify } from "../lib/notify";
import { colors, spacing } from "../theme";

const VAI_EMBORA = [
  "Seus treinos, recordes e histórico de atividades",
  "Sua ficha de saúde e os planos gerados para você",
  "Suas publicações, comentários e curtidas",
  "Sua foto de perfil e quem você segue",
];

export function ExcluirContaScreen() {
  const { token, logout } = useAuth();
  const [senha, setSenha] = useState("");
  const [excluindo, setExcluindo] = useState(false);

  function confirmar() {
    confirmDialog(
      "Excluir para sempre?",
      "Isto não pode ser desfeito. Seus treinos e publicações somem e não voltam.",
      () => void excluir(),
      "Excluir"
    );
  }

  async function excluir() {
    setExcluindo(true);
    try {
      await excluirConta(token!, senha);
      // A conta não existe mais: sair é só limpar o que ficou neste aparelho.
      // O app volta sozinho para o login quando o token some.
      await logout();
    } catch (err) {
      notify("Não deu para excluir", (err as Error).message);
      setExcluindo(false);
    }
  }

  return (
    <Screen scroll underHeader>
      <Card level={2} style={styles.aviso}>
        <Txt variant="titleCard" color={colors.danger}>
          Isto não tem volta
        </Txt>
        <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
          Ao excluir a conta, apagamos de vez:
        </Txt>
        <View style={styles.lista}>
          {VAI_EMBORA.map((item) => (
            <Txt key={item} variant="body" color={colors.text2}>
              {`•  ${item}`}
            </Txt>
          ))}
        </View>
        <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.md }}>
          Desafios que você criou e têm outras pessoas continuam existindo para elas. Você pode
          se cadastrar de novo com o mesmo e-mail, mas será uma conta nova, vazia.
        </Txt>
      </Card>

      <Field
        label="Confirme sua senha"
        value={senha}
        onChangeText={setSenha}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        placeholder="Sua senha atual"
      />

      <Button
        title="Excluir minha conta"
        variant="danger"
        size="lg"
        onPress={confirmar}
        disabled={senha.length === 0 || excluindo}
        loading={excluindo}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  aviso: { marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.danger },
  lista: { gap: 4, marginTop: spacing.sm },
});
