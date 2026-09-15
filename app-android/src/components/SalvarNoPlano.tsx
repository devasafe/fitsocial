// "Quer adicionar este treino ao plano?"
//
// A pergunta que faltava para o treino montado à mão virar rotina. Sem ela,
// quem cadastra o treino de terça no "+" cadastra de novo na terça seguinte, e
// de novo na outra — o app guardava o histórico e nunca a ficha.
//
// A folha só aparece quando a pergunta faz sentido (ver `TreinoConcluidoScreen`):
// treino de musculação, que não veio do plano, de quem pode editar o próprio
// plano. Quem tem treinador não vê — quem escreve o treino dele é o treinador.

import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { Sheet } from "./Sheet";
import { Txt, Button, Field, Chip } from "./ui";
import { notify } from "../lib/notify";
import { useAuth } from "../context/AuthContext";
import { adicionarSessaoAoPlano } from "../api/plans";
import { DIAS_CURTOS } from "../lib/semana";
import { colors, spacing } from "../theme";

export function SalvarNoPlano({
  visivel,
  aoFechar,
  activityId,
  nomeSugerido,
  /** O dia em que o treino foi feito — já marcado, porque é o palpite óbvio. */
  diaSugerido,
  aoSalvar,
}: {
  visivel: boolean;
  aoFechar: () => void;
  activityId: string;
  nomeSugerido: string;
  diaSugerido: number;
  /** `aviso` traz o que a pessoa precisa saber depois de salvar, quando há. */
  aoSalvar: (aviso?: string) => void;
}) {
  const { token } = useAuth();
  const [nome, setNome] = useState(nomeSugerido);
  const [dias, setDias] = useState<number[]>([diaSugerido]);
  const [salvando, setSalvando] = useState(false);

  function alternar(dia: number) {
    setDias((prev) => (prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia].sort()));
  }

  async function salvar() {
    if (dias.length === 0) {
      notify("Escolha o dia", "Em que dia da semana este treino acontece?");
      return;
    }
    setSalvando(true);
    try {
      const r = await adicionarSessaoAoPlano(token!, {
        activityId,
        day: nome.trim() || nomeSugerido,
        weekdays: dias,
      });
      // Um dia só pode ser de um treino. Quando este tomou o dia de outro, a
      // pessoa precisa saber agora — não na terça seguinte, ao abrir o "+" e
      // encontrar um treino diferente do que ela esperava.
      const tomados = r.meta.diasTomadosDe ?? [];
      aoSalvar(
        tomados.length
          ? `${tomados.join(" e ")} ficou sem esse dia.`
          : undefined
      );
    } catch (e) {
      notify("Não deu para salvar no plano", (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Sheet visivel={visivel} aoFechar={aoFechar}>
      <View style={{ paddingHorizontal: spacing.gutter, paddingBottom: spacing.lg }}>
        <Txt variant="titleSection">Salvar no meu plano</Txt>
        <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm, marginBottom: spacing.lg }}>
          Nos dias que você marcar, este treino aparece pronto quando você tocar no +.
        </Txt>

        <Field label="Nome do treino" value={nome} onChangeText={setNome} placeholder="Peito e tríceps" />

        <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
          Em que dias
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg }}>
          {DIAS_CURTOS.map((rotulo, dia) => (
            <Chip key={dia} label={rotulo} active={dias.includes(dia)} onPress={() => alternar(dia)} />
          ))}
        </View>

        <Button title="Salvar no plano" onPress={salvar} loading={salvando} size="lg" glow />
        <TouchableOpacity
          onPress={aoFechar}
          disabled={salvando}
          activeOpacity={0.7}
          style={{ paddingVertical: spacing.md, alignItems: "center" }}
        >
          <Txt variant="label" color={colors.text2}>
            Agora não
          </Txt>
        </TouchableOpacity>
      </View>
    </Sheet>
  );
}
