// Trocar a senha derruba as outras sessões — é o principal motivo de alguém
// vir aqui: desconfiou que outra pessoa está na conta. A tela avisa isso antes,
// não depois, e o token novo que a API devolve mantém este aparelho dentro.

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { alterarSenha } from "../api/settings";
import { Screen, Txt, Field, Button, Card } from "../components/ui";
import { notify } from "../lib/notify";
import { colors, spacing } from "../theme";

const MINIMO = 8;

export function AlterarSenhaScreen() {
  const nav = useNavigation();
  const { token, trocarToken } = useAuth();

  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const curta = nova.length > 0 && nova.length < MINIMO;
  const naoConfere = confirmacao.length > 0 && confirmacao !== nova;
  const repetida = nova.length > 0 && nova === atual;
  const podeSalvar =
    atual.length > 0 && nova.length >= MINIMO && confirmacao === nova && !repetida && !salvando;

  async function salvar() {
    setSalvando(true);
    try {
      const { data } = await alterarSenha(token!, atual, nova);
      // Antes de qualquer navegação: sem isso, a próxima chamada usaria o token
      // que a troca acabou de invalidar e a pessoa cairia para a tela de login.
      await trocarToken(data.token);
      notify("Senha alterada", "Os outros aparelhos vão precisar entrar de novo.", () =>
        nav.goBack()
      );
    } catch (err) {
      notify("Não deu para alterar", (err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Screen scroll underHeader>
      <Card level={2} style={styles.aviso}>
        <Txt variant="body" color={colors.text2}>
          Ao trocar a senha, todos os outros aparelhos conectados saem da conta. Este continua
          conectado.
        </Txt>
      </Card>

      <View style={styles.form}>
        <Field
          label="Senha atual"
          value={atual}
          onChangeText={setAtual}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
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

        <Field
          label="Repita a nova senha"
          value={confirmacao}
          onChangeText={setConfirmacao}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />

        {curta ? <Aviso texto={`A nova senha precisa de pelo menos ${MINIMO} caracteres.`} /> : null}
        {repetida ? <Aviso texto="A nova senha é igual à atual." /> : null}
        {naoConfere ? <Aviso texto="As duas senhas não são iguais." /> : null}
      </View>

      <Button
        title="Alterar senha"
        onPress={() => void salvar()}
        disabled={!podeSalvar}
        loading={salvando}
        size="lg"
      />
    </Screen>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <Txt variant="caption" color={colors.danger} style={styles.erro}>
      {texto}
    </Txt>
  );
}

const styles = StyleSheet.create({
  aviso: { marginBottom: spacing.lg },
  form: { marginBottom: spacing.sm },
  erro: { marginTop: -spacing.sm, marginBottom: spacing.md },
});
