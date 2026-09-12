import React from "react";
import { View, Image } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Txt, Card, Button } from "./ui";
import type { ProfissionalAtivo } from "../api/pro";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

/**
 * Quem cuida do treino desta pessoa — quando é gente, e não a IA.
 *
 * Ocupa o lugar do cartão "Seu coach ✦" na Home. Não é decoração: enquanto
 * existe um treinador, é ELE quem escreve o plano (`POST /plans/generate`
 * recusa), e a tela tem de dizer isso com nome e rosto. Um cartão de IA em
 * cima de um treino que um profissional prescreveu faria a pessoa achar que o
 * robô mudou o treino dela — e faria o treinador ser cobrado por uma decisão
 * que não foi dele.
 *
 * A última fala aparece aqui porque é o que dá assunto ao cartão. Sem ela, o
 * cartão diria só que existe um treinador, o que a pessoa já sabe.
 */
export function CartaoDoTreinador({
  treinador,
  temTreinoDele,
}: {
  treinador: ProfissionalAtivo;
  /**
   * O treino ATUAL é dele. Vem da Home (`plan.autor`), e não da última
   * mensagem: amarrar o atalho em `ultima.plan` fazia o botão sumir assim que
   * o treinador dissesse qualquer outra coisa depois de prescrever.
   */
  temTreinoDele: boolean;
}) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { profissional, ultima, naoLidas } = treinador;

  const abrirConversa = () =>
    nav.navigate("Conversa", { linkId: treinador.id, nome: profissional.nome });

  return (
    <Card level={2}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        {profissional.avatarUrl ? (
          <Image
            source={{ uri: profissional.avatarUrl }}
            style={{ width: 44, height: 44, borderRadius: radius.full }}
          />
        ) : (
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.full,
              backgroundColor: colors.surface3,
            }}
          />
        )}
        <View style={{ flex: 1 }}>
          <Txt variant="titleCard" numberOfLines={1}>
            {profissional.nome}
          </Txt>
          <Txt variant="caption" color={colors.text2}>
            seu treinador
          </Txt>
        </View>
        {naoLidas > 0 && (
          <Txt variant="label" color={colors.lime}>
            {naoLidas === 1 ? "1 nova" : `${naoLidas} novas`}
          </Txt>
        )}
      </View>

      {/* Só a fala DELE. A própria mensagem da pessoa de volta no cartão é ela
          lendo o que acabou de escrever. */}
      {ultima?.dele && !!ultima.texto && (
        <Txt
          variant="body"
          color={colors.text2}
          numberOfLines={3}
          style={{ marginTop: spacing.md }}
        >
          {ultima.texto}
        </Txt>
      )}

      <View style={{ flexDirection: "row", gap: spacing.s8, marginTop: spacing.md }}>
        {/* "Ver treino" só quando há treino dele: um botão que leva a lugar
            nenhum é pior que a ausência dele. */}
        {temTreinoDele && (
          <Button
            title="Ver treino"
            onPress={() => nav.navigate("TodayWorkout")}
            style={{ flex: 1 }}
          />
        )}
        <Button
          title={naoLidas > 0 ? "Ler mensagens" : "Responder"}
          variant={temTreinoDele ? "secondary" : "primary"}
          onPress={abrirConversa}
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}
