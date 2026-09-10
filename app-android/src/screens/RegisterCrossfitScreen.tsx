// Registrar um treino de CrossFit.
//
// A tela é uma lista de blocos e um botão de adicionar. Nenhum bloco é
// obrigatório: um treino pode ser aquecimento + força + WOD, ou só o WOD. Era
// exatamente isso que não cabia no formulário anterior, que assumia um WOD só.
//
// Registrar acontece no box, cansado, de celular na mão. Então a tela principal
// só mostra resumos — a edição de cada bloco vive num sheet, e o rascunho é
// salvo a cada mudança para dar para sair e voltar.

import React, { useCallback, useEffect, useState } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button } from "../components/ui";
import { MenuSheet } from "../components/MenuSheet";
import { EditorDeBloco, blocoNovo, ROTULO_DO_BLOCO } from "../components/crossfit/EditorDeBloco";
import { ColarOQuadro } from "../components/crossfit/ColarOQuadro";
import { resumoDoMovimento } from "../components/crossfit/MovimentosEditor";
import { resumoDaForca } from "../components/crossfit/EditorDeForca";
import { resumoDoMetcon } from "../components/crossfit/EditorDeMetcon";
import { Campo, Linha, paraInteiro, paraSegundos, mmss } from "../components/crossfit/campos";
import { createActivity } from "../api/activities";
import type { Bloco, PayloadDeCrossfit } from "../api/crossfit";
import { usePRCelebration } from "../components/PRCelebration";
import { usePerguntaDePrivacidade } from "../components/PrivacidadeTreinos";
import { notify } from "../lib/notify";
import { colors, radius, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "RegisterCrossfit">;

const RASCUNHO = "fitsocial.rascunhoCrossfit";

const TIPOS: Bloco["tipo"][] = [
  "aquecimento",
  "mobilidade",
  "skill",
  "forca",
  "metcon",
  "cooldown",
];

/** As duas linhas que o card de cada bloco mostra. */
function resumo(b: Bloco): string[] {
  switch (b.tipo) {
    case "forca":
      return resumoDaForca(b);
    case "metcon": {
      const linhas: string[] = [];
      const cabecalho = [b.nome, b.escala.nivel === "rx" ? "RX" : b.escala.nivel]
        .filter(Boolean)
        .join(" · ");
      const r = resumoDoMetcon(b);
      if (cabecalho || r) linhas.push([cabecalho, r].filter(Boolean).join(" — "));
      linhas.push(
        b.prescricao.movimentos
          .filter((m) => m.nome.trim())
          .map(resumoDoMovimento)
          .join(" · ")
      );
      return linhas.filter(Boolean);
    }
    case "skill":
      return [
        [b.movimento, b.melhorSequencia ? `${b.melhorSequencia} sem quebrar` : ""]
          .filter(Boolean)
          .join(" · "),
      ].filter(Boolean);
    case "descanso":
      return [b.duracaoSec ? mmss(b.duracaoSec) : "Descanso"];
    default:
      return [
        [
          b.formato === "emom" && b.intervaloSec ? `EMOM ${mmss(b.intervaloSec)}` : "",
          b.rounds ? `${b.rounds} rounds` : "",
          b.duracaoSec ? mmss(b.duracaoSec) : "",
          b.movimentos.filter((m) => m.nome.trim()).map(resumoDoMovimento).join(" · "),
        ]
          .filter(Boolean)
          .join(" · "),
      ].filter(Boolean);
  }
}

export function RegisterCrossfitScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const celebratePR = usePRCelebration();
  const perguntarPrivacidade = usePerguntaDePrivacidade();

  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [box, setBox] = useState("");
  // O quadro que a pessoa colou. Guardado junto dos blocos: eles sao a
  // interpretacao, ele e a fonte.
  const [quadro, setQuadro] = useState("");
  const [colando, setColando] = useState(false);
  const [duracao, setDuracao] = useState("");
  const [rpe, setRpe] = useState("");
  const [notas, setNotas] = useState("");

  const [escolhendoTipo, setEscolhendoTipo] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [carregou, setCarregou] = useState(false);

  // Rascunho: dá para sair no meio e voltar. Um treino registrado pela metade e
  // perdido é o motivo de alguém parar de registrar.
  useEffect(() => {
    void AsyncStorage.getItem(RASCUNHO)
      .then((raw) => {
        if (raw) {
          const d = JSON.parse(raw) as { blocos: Bloco[]; box: string; duracao: string; rpe: string; notas: string };
          setBlocos(d.blocos ?? []);
          setBox(d.box ?? "");
          setDuracao(d.duracao ?? "");
          setRpe(d.rpe ?? "");
          setNotas(d.notas ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setCarregou(true));
  }, []);

  useEffect(() => {
    if (!carregou) return;
    void AsyncStorage.setItem(RASCUNHO, JSON.stringify({ blocos, box, duracao, rpe, notas })).catch(
      () => {}
    );
  }, [carregou, blocos, box, duracao, rpe, notas]);

  const limparRascunho = useCallback(() => {
    void AsyncStorage.removeItem(RASCUNHO).catch(() => {});
  }, []);

  function adicionar(tipo: Bloco["tipo"]) {
    setBlocos((prev) => [...prev, blocoNovo(tipo)]);
    setEscolhendoTipo(false);
    // Abre já no editor: adicionar um bloco vazio e ter que tocar de novo para
    // preencher é um toque que não serve para nada.
    setEditando(blocos.length);
  }

  async function salvar() {
    // Bloco sem nada dentro é ruído: some no salvamento em vez de virar erro.
    const limpos = blocos.filter((b) => resumo(b).length > 0 || b.notas?.trim());
    if (!limpos.length) {
      notify("Treino vazio", "Adicione ao menos um bloco com algum conteúdo.");
      return;
    }

    const payload: PayloadDeCrossfit = {
      v: 2,
      box: box.trim() || null,
      quadro: quadro.trim() || null,
      blocos: limpos,
    };

    setSalvando(true);
    try {
      const res = await createActivity(token!, {
        sportId,
        kind: "wod",
        payload,
        durationSec: paraSegundos(duracao) ?? undefined,
        perceivedEffort: paraInteiro(rpe) ?? undefined,
        notes: notas.trim() || undefined,
      });
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

  return (
    <Screen scroll underHeader>
      <View style={styles.cabecalho}>
        <View style={[styles.ponto, { backgroundColor: sportColor(sportId) }]} />
        <Txt variant="titleScreen">{sportLabel(sportId)}</Txt>
      </View>

      <Card style={styles.basicas}>
        <Linha>
          <Campo rotulo="Box" valor={box} aoMudar={setBox} placeholder="Onde treinou" flex={2} />
          <Campo
            rotulo="Duração"
            valor={duracao}
            aoMudar={setDuracao}
            placeholder="1:05"
          />
        </Linha>
      </Card>

      {/* Antes dos blocos: colar o quadro e o caminho curto, e e o primeiro
          que a pessoa deve enxergar. Montar oito blocos a mao continua ali
          embaixo para quem preferir. */}
      {blocos.length === 0 ? (
        <TouchableOpacity
          onPress={() => setColando(true)}
          activeOpacity={0.85}
          style={styles.colar}
        >
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
              <Txt variant="label" color={colors.lime}>
                {ROTULO_DO_BLOCO[b.tipo].toUpperCase()}
              </Txt>
              {linhas.length ? (
                linhas.map((l, j) => (
                  <Txt key={j} variant={j === 0 ? "bodyStrong" : "body"} color={j === 0 ? colors.text : colors.text2} style={{ marginTop: 2 }}>
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

      <TouchableOpacity onPress={() => setEscolhendoTipo(true)} activeOpacity={0.7} style={styles.adicionar}>
        <Txt variant="bodyStrong" color={colors.text2}>
          + Adicionar bloco
        </Txt>
      </TouchableOpacity>

      <Card style={styles.basicas}>
        <Linha>
          <Campo
            rotulo="Esforço (1-10)"
            valor={rpe}
            aoMudar={setRpe}
            placeholder="8"
            teclado="numeric"
          />
          <Campo rotulo="Observações" valor={notas} aoMudar={setNotas} placeholder="Como foi?" flex={2} />
        </Linha>
      </Card>

      <Button title="Salvar treino" size="lg" glow onPress={() => void salvar()} loading={salvando} />

      <MenuSheet
        visivel={escolhendoTipo}
        aoFechar={() => setEscolhendoTipo(false)}
        acoes={TIPOS.map((t) => ({
          chave: t,
          rotulo: ROTULO_DO_BLOCO[t],
          aoTocar: () => adicionar(t),
        }))}
      />

      <ColarOQuadro
        visivel={colando}
        aoFechar={() => setColando(false)}
        aoLer={({ blocos: lidos, box: caixa, quadro: texto }) => {
          // Substitui, nao acumula: colar de novo e trocar o quadro, nao
          // registrar dois treinos.
          setBlocos(lidos);
          setQuadro(texto);
          if (caixa && !box.trim()) setBox(caixa);
        }}
      />

      <EditorDeBloco
        bloco={editando != null ? (blocos[editando] ?? null) : null}
        visivel={editando != null}
        aoFechar={() => setEditando(null)}
        aoSalvar={(b) => {
          setBlocos((prev) => prev.map((x, j) => (j === editando ? b : x)));
          setEditando(null);
        }}
        aoRemover={() => {
          setBlocos((prev) => prev.filter((_, j) => j !== editando));
          setEditando(null);
        }}
      />
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
