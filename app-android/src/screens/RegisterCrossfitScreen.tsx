// Registrar um treino de CrossFit.
//
// A tela é uma lista de blocos e um botão de adicionar. Nenhum bloco é
// obrigatório: um treino pode ser aquecimento + força + WOD, ou só o WOD.
//
// O que mudou no v3: não se escolhe mais o TIPO do bloco antes de escrever.
// Escolher categoria no começo é decidir, sem informação, algo que só faz
// sentido no fim — e "EMOM (1'15\") x 4" não era nenhuma das opções. Agora se
// escreve o modo como está no quadro, e o servidor deduz o resto.
//
// Registrar acontece no box, cansado, de celular na mão. Então a tela principal
// só mostra resumos, a edição de cada bloco vive num sheet, e o rascunho é
// salvo a cada mudança para dar para sair e voltar.

import React, { useCallback, useEffect, useState } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { EditorDeBloco } from "../components/crossfit/EditorDeBloco";
import { ColarOQuadro } from "../components/crossfit/ColarOQuadro";
import { resumoDoMovimento } from "../components/crossfit/MovimentosEditor";
import { Campo, Linha, paraInteiro, paraSegundos } from "../components/crossfit/campos";
import { createActivity } from "../api/activities";
import { blocoVazio, type Bloco, type PayloadDeCrossfit } from "../api/crossfit";
import { comoNoQuadro, resultadoEmTexto, ehDescanso } from "../lib/crossfitResumo";
import { anotarTreino } from "../lib/sugestoes";
import { usePRCelebration } from "../components/PRCelebration";
import { usePerguntaDePrivacidade } from "../components/PrivacidadeTreinos";
import { notify } from "../lib/notify";
import { colors, radius, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterCrossfit">;

const RASCUNHO = "fitsocial.rascunhoCrossfit";

/** Um bloco tem conteúdo quando tem modo, movimento, resultado ou nota. */
function temAlgo(b: Bloco): boolean {
  return !!(
    b.modo.trim() ||
    b.movimentos.some((m) => m.nome.trim()) ||
    b.resultado ||
    b.notas?.trim()
  );
}

/** As duas linhas que o card de cada bloco mostra. */
function resumo(b: Bloco): string[] {
  const linhas: string[] = [];
  const cabecalho = [b.nome?.trim(), resultadoEmTexto(b.resultado)].filter(Boolean).join(" — ");
  if (cabecalho) linhas.push(cabecalho);

  const movs = b.movimentos.filter((m) => m.nome.trim()).map(resumoDoMovimento);
  if (movs.length) linhas.push(movs.join(" · "));

  return linhas;
}

export function RegisterCrossfitScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const celebratePR = usePRCelebration();
  const perguntarPrivacidade = usePerguntaDePrivacidade();

  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [box, setBox] = useState("");
  // O quadro que a pessoa colou. Guardado junto dos blocos: eles são a
  // interpretação, ele é a fonte.
  const [quadro, setQuadro] = useState("");
  const [colando, setColando] = useState(false);
  const [duracao, setDuracao] = useState("");
  const [rpe, setRpe] = useState("");
  const [notas, setNotas] = useState("");
  const [time, setTime] = useState("");
  const [parceiros, setParceiros] = useState("");

  const [editando, setEditando] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [carregou, setCarregou] = useState(false);

  const tamanhoDoTime = Math.max(1, paraInteiro(time) ?? 1);
  const emEquipe = tamanhoDoTime > 1;

  // Rascunho: dá para sair no meio e voltar. Um treino registrado pela metade e
  // perdido é o motivo de alguém parar de registrar.
  useEffect(() => {
    void AsyncStorage.getItem(RASCUNHO)
      .then((raw) => {
        if (!raw) return;
        const d = JSON.parse(raw) as Record<string, unknown>;
        setBlocos((d.blocos as Bloco[]) ?? []);
        setBox((d.box as string) ?? "");
        setQuadro((d.quadro as string) ?? "");
        setDuracao((d.duracao as string) ?? "");
        setRpe((d.rpe as string) ?? "");
        setNotas((d.notas as string) ?? "");
        setTime((d.time as string) ?? "");
        setParceiros((d.parceiros as string) ?? "");
      })
      .catch(() => {})
      .finally(() => setCarregou(true));
  }, []);

  useEffect(() => {
    if (!carregou) return;
    void AsyncStorage.setItem(
      RASCUNHO,
      JSON.stringify({ blocos, box, quadro, duracao, rpe, notas, time, parceiros })
    ).catch(() => {});
  }, [carregou, blocos, box, quadro, duracao, rpe, notas, time, parceiros]);

  const limparRascunho = useCallback(() => {
    void AsyncStorage.removeItem(RASCUNHO).catch(() => {});
  }, []);

  function adicionar() {
    setBlocos((prev) => [...prev, blocoVazio()]);
    // Abre já no editor: adicionar um bloco vazio e ter que tocar de novo para
    // preencher é um toque que não serve para nada.
    setEditando(blocos.length);
  }

  const previa: PayloadDeCrossfit = {
    v: 3,
    box: box.trim() || null,
    quadro: quadro.trim() || null,
    tamanhoDoTime,
    parceiros: parceiros.trim() ? parceiros.split(",").map((p) => p.trim()).filter(Boolean) : null,
    blocos,
  };

  async function salvar() {
    // Bloco sem nada dentro é ruído: some no salvamento em vez de virar erro.
    const limpos = blocos.filter(temAlgo);
    if (!limpos.length && !quadro.trim()) {
      notify("Treino vazio", "Escreva ao menos um bloco, ou cole o quadro da aula.");
      return;
    }

    setSalvando(true);
    try {
      const res = await createActivity(token!, {
        sportId,
        kind: "wod",
        payload: { ...previa, blocos: limpos },
        durationSec: paraSegundos(duracao) ?? undefined,
        perceivedEffort: paraInteiro(rpe) ?? undefined,
        notes: notas.trim() || undefined,
      });

      // O acervo de sugestões se enche do que VOCÊ escreve, no salvamento —
      // nunca a cada tecla, senão ele guardaria "Thrus" e "Thrust" também.
      void anotarTreino(
        limpos.map((b) => b.modo),
        limpos.flatMap((b) => b.movimentos.map((m) => m.nome))
      );

      limparRascunho();
      celebratePR(res.meta.newPRs ?? []);
      perguntarPrivacidade();
      navigation.navigate("CreatePost", { activity: res.data });
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const textoDoQuadro = comoNoQuadro(previa);

  return (
    <Screen scroll underHeader>
      <View style={styles.cabecalho}>
        <View style={[styles.ponto, { backgroundColor: sportColor(sportId) }]} />
        <Txt variant="titleScreen">{sportLabel(sportId)}</Txt>
      </View>

      <Card style={styles.basicas}>
        <Linha>
          <Campo rotulo="Box" valor={box} aoMudar={setBox} placeholder="Onde treinou" flex={2} />
          <Campo rotulo="Duração" valor={duracao} aoMudar={setDuracao} placeholder="1:05" />
        </Linha>
        <View style={{ marginTop: spacing.sm }}>
          <Linha>
            {/* Acima de 1, o escopo de cada movimento passa a importar — e é o
                que faz a conta de volume e de recorde ficar certa. */}
            <Campo
              rotulo="Quantos treinaram"
              valor={time}
              aoMudar={setTime}
              placeholder="1"
              teclado="numeric"
            />
            {emEquipe ? (
              <Campo
                rotulo="Com quem"
                valor={parceiros}
                aoMudar={setParceiros}
                placeholder="Bruno, Ana"
                flex={2}
              />
            ) : null}
          </Linha>
        </View>
      </Card>

      {/* Antes dos blocos: colar o quadro é o caminho curto, e é o primeiro que
          a pessoa deve enxergar. Montar bloco a bloco continua ali embaixo. */}
      {blocos.length === 0 ? (
        <TouchableOpacity onPress={() => setColando(true)} activeOpacity={0.85} style={styles.colar}>
          <Txt variant="titleCard">Colar o quadro da aula</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: 2 }}>
            Cole o treino como está escrito e eu monto os blocos
          </Txt>
        </TouchableOpacity>
      ) : quadro ? (
        <TouchableOpacity onPress={() => setColando(true)} activeOpacity={0.7}>
          <Txt variant="label" color={colors.lime} style={{ marginBottom: spacing.sm }}>
            Quadro colado · tocar para trocar
          </Txt>
        </TouchableOpacity>
      ) : null}

      {blocos.map((b, i) => {
        const linhas = resumo(b);
        return (
          <TouchableOpacity key={i} onPress={() => setEditando(i)} activeOpacity={0.85}>
            <Card level={2} style={styles.bloco}>
              <Txt variant="label" color={ehDescanso(b) ? colors.text3 : colors.lime}>
                {b.modo.trim() || "sem modo"}
              </Txt>
              {linhas.length ? (
                linhas.map((l, j) => (
                  <Txt
                    key={j}
                    variant={j === 0 ? "bodyStrong" : "body"}
                    color={j === 0 ? colors.text : colors.text2}
                    style={{ marginTop: 2 }}
                  >
                    {l}
                  </Txt>
                ))
              ) : (
                <Txt variant="body" color={colors.text3} style={{ marginTop: 2 }}>
                  Toque para preencher
                </Txt>
              )}
            </Card>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity onPress={adicionar} activeOpacity={0.7} style={styles.adicionar}>
        <Txt variant="bodyStrong" color={colors.text2}>
          + Adicionar bloco
        </Txt>
      </TouchableOpacity>

      {/* O treino escrito de volta no formato do quadro.
          É o teste de aceite do briefing, e por isso ele fica à vista DURANTE o
          cadastro: se não sai igual ao que o coach escreveria, falta campo. */}
      {textoDoQuadro ? (
        <Card style={styles.previa}>
          <Txt variant="label" color={colors.text3}>
            Como vai ficar
          </Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.xs }}>
            {textoDoQuadro}
          </Txt>
        </Card>
      ) : null}

      <Card style={styles.basicas}>
        <Linha>
          <Campo
            rotulo="Esforço (1-10)"
            valor={rpe}
            aoMudar={setRpe}
            placeholder="8"
            teclado="numeric"
          />
          <Campo
            rotulo="Observações"
            valor={notas}
            aoMudar={setNotas}
            placeholder="Como foi?"
            flex={2}
          />
        </Linha>
      </Card>

      <Button title="Salvar treino" size="lg" glow onPress={() => void salvar()} loading={salvando} />

      <ColarOQuadro
        visivel={colando}
        aoFechar={() => setColando(false)}
        aoLer={({ blocos: lidos, box: caixa, quadro: texto, tamanhoDoTime: time2 }) => {
          // Substitui, não acumula: colar de novo é trocar o quadro, não
          // registrar dois treinos.
          setBlocos(lidos);
          setQuadro(texto);
          if (caixa && !box.trim()) setBox(caixa);
          if (time2 > 1 && !time.trim()) setTime(String(time2));
        }}
      />

      <Sheet visivel={editando != null} aoFechar={() => setEditando(null)}>
        <View style={{ paddingHorizontal: spacing.gutter }}>
          {editando != null && blocos[editando] ? (
            <EditorDeBloco
              bloco={blocos[editando]}
              emEquipe={emEquipe}
              aoMudar={(b) => setBlocos((prev) => prev.map((x, j) => (j === editando ? b : x)))}
              aoRemover={() => {
                setBlocos((prev) => prev.filter((_, j) => j !== editando));
                setEditando(null);
              }}
            />
          ) : null}
          <View style={{ marginTop: spacing.md }}>
            <Button title="Pronto" size="lg" onPress={() => setEditando(null)} />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  colar: {
    backgroundColor: colors.surface2,
    borderColor: colors.lime,
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: spacing.card,
    padding: spacing.md,
  },
  cabecalho: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.md },
  ponto: { width: 12, height: 12, borderRadius: 6 },
  basicas: { marginBottom: spacing.md },
  bloco: { marginBottom: spacing.sm },
  previa: { marginBottom: spacing.md },
  adicionar: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderStyle: "dashed",
    borderRadius: radius.card,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginBottom: spacing.md,
  },
});
