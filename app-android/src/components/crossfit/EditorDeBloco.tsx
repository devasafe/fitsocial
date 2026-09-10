// Um sheet que edita qualquer bloco. A tela principal nunca vira formulário
// longo: ela lista resumos, e a edição acontece aqui dentro.

import React, { useState } from "react";
import { View, ScrollView, TouchableOpacity } from "react-native";
import { Txt, Button } from "../ui";
import { Sheet } from "../Sheet";
import { MovimentosEditor } from "./MovimentosEditor";
import { EditorDeForca } from "./EditorDeForca";
import { EditorDeMetcon } from "./EditorDeMetcon";
import { Campo, Linha, Secao, Opcoes, paraInteiro, paraSegundos, mmss } from "./campos";
import type {
  Bloco,
  BlocoLivre,
  BlocoDescanso,
  BlocoSkill,
  BlocoForca,
  BlocoMetcon,
} from "../../api/crossfit";
import { colors, spacing } from "../../theme";

export const ROTULO_DO_BLOCO: Record<Bloco["tipo"], string> = {
  aquecimento: "Aquecimento",
  mobilidade: "Mobilidade",
  skill: "Técnica / Skill",
  forca: "Força",
  metcon: "WOD / Metcon",
  descanso: "Descanso",
  cooldown: "Cooldown",
};

/** Um bloco vazio de cada tipo, para quando a pessoa acabou de adicionar. */
export function blocoNovo(tipo: Bloco["tipo"]): Bloco {
  switch (tipo) {
    case "skill":
      return { tipo: "skill", movimento: "" };
    case "forca":
      return { tipo: "forca", exercicios: [{ name: "", sets: [{ weightKg: 0, reps: null }] }] };
    case "metcon":
      return {
        tipo: "metcon",
        formato: "for_time",
        prescricao: { movimentos: [{ nome: "" }] },
        escala: { nivel: "rx" },
      };
    case "descanso":
      // Um minuto é o REST mais comum entre partes de um WOD.
      return { tipo: "descanso", duracaoSec: 60 };
    default:
      return { tipo, movimentos: [{ nome: "" }] };
  }
}

export function EditorDeBloco({
  bloco,
  visivel,
  aoFechar,
  aoSalvar,
  aoRemover,
}: {
  bloco: Bloco | null;
  visivel: boolean;
  aoFechar: () => void;
  aoSalvar: (b: Bloco) => void;
  aoRemover?: () => void;
}) {
  const [rascunho, setRascunho] = useState<Bloco | null>(bloco);

  // Reabrir o sheet com outro bloco precisa recarregar o rascunho.
  React.useEffect(() => setRascunho(bloco), [bloco]);

  if (!rascunho) return null;

  return (
    <Sheet visivel={visivel} aoFechar={aoFechar}>
      <View style={{ maxHeight: 560 }}>
        <View style={{ paddingHorizontal: spacing.gutter, marginBottom: spacing.sm }}>
          <Txt variant="titleCard">{ROTULO_DO_BLOCO[rascunho.tipo]}</Txt>
        </View>

        <ScrollView
          style={{ paddingHorizontal: spacing.gutter }}
          keyboardShouldPersistTaps="handled"
        >
          {rascunho.tipo === "forca" ? (
            <EditorDeForca
              bloco={rascunho as BlocoForca}
              aoMudar={(b) => setRascunho(b)}
            />
          ) : rascunho.tipo === "metcon" ? (
            <EditorDeMetcon
              bloco={rascunho as BlocoMetcon}
              aoMudar={(b) => setRascunho(b)}
            />
          ) : rascunho.tipo === "skill" ? (
            <EditorSkill bloco={rascunho as BlocoSkill} aoMudar={setRascunho} />
          ) : rascunho.tipo === "descanso" ? (
            <Campo
              rotulo="Quanto descansou"
              valor={mmss((rascunho as BlocoDescanso).duracaoSec)}
              aoMudar={(t) =>
                setRascunho({ ...(rascunho as BlocoDescanso), duracaoSec: paraSegundos(t) })
              }
              placeholder="1:00"
              autoFocus
            />
          ) : (
            <EditorLivre bloco={rascunho as BlocoLivre} aoMudar={setRascunho} />
          )}

          <Secao titulo="Observações">
            <Campo
              valor={rascunho.notas ?? ""}
              aoMudar={(t) => setRascunho({ ...rascunho, notas: t } as Bloco)}
              placeholder="Como foi? O que travou?"
            />
          </Secao>

          <View style={{ gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md }}>
            <Button title="Salvar bloco" size="lg" onPress={() => aoSalvar(rascunho)} />
            {aoRemover ? (
              <TouchableOpacity
                onPress={aoRemover}
                activeOpacity={0.7}
                style={{ alignItems: "center", paddingVertical: spacing.sm }}
              >
                <Txt variant="label" color={colors.danger}>
                  Remover bloco
                </Txt>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </Sheet>
  );
}

/**
 * Aquecimento, mobilidade e cooldown.
 *
 * Ganhou formato porque "EMOM 1'15\" × 4" é o warm-up mais comum de box, e
 * sem intervalo a pessoa acabava registrando o aquecimento como se fosse WOD
 * só para ter onde escrever o tempo de cada rodada.
 */
function EditorLivre({
  bloco,
  aoMudar,
}: {
  bloco: BlocoLivre;
  aoMudar: (b: BlocoLivre) => void;
}) {
  return (
    <View>
      <Secao titulo="Como foi">
        <Opcoes
          valor={bloco.formato ?? "livre"}
          opcoes={[
            { id: "livre", label: "Solto" },
            { id: "circuito", label: "Circuito" },
            { id: "emom", label: "EMOM" },
          ]}
          aoEscolher={(id) => aoMudar({ ...bloco, formato: id === "livre" ? null : id })}
        />
      </Secao>

      <Linha>
        {bloco.formato === "emom" ? (
          <Campo
            rotulo="A cada"
            valor={mmss(bloco.intervaloSec)}
            aoMudar={(t) => aoMudar({ ...bloco, intervaloSec: paraSegundos(t) })}
            placeholder="1:15"
          />
        ) : (
          <Campo
            rotulo="Duração"
            valor={mmss(bloco.duracaoSec)}
            aoMudar={(t) => aoMudar({ ...bloco, duracaoSec: paraSegundos(t) })}
            placeholder="mm:ss"
          />
        )}
        <Campo
          rotulo="Rounds"
          valor={bloco.rounds != null ? String(bloco.rounds) : ""}
          aoMudar={(t) => aoMudar({ ...bloco, rounds: paraInteiro(t) })}
          placeholder="4"
          teclado="numeric"
        />
      </Linha>

      <Secao titulo="Movimentos">
        <MovimentosEditor
          movimentos={bloco.movimentos}
          aoMudar={(movs) => aoMudar({ ...bloco, movimentos: movs })}
          comCarga={false}
        />
      </Secao>
    </View>
  );
}

/** Skill: praticar um movimento. `melhorSequencia` é o que vira recorde. */
function EditorSkill({ bloco, aoMudar }: { bloco: BlocoSkill; aoMudar: (b: BlocoSkill) => void }) {
  return (
    <View>
      <Campo
        rotulo="Movimento"
        valor={bloco.movimento}
        aoMudar={(t) => aoMudar({ ...bloco, movimento: t })}
        placeholder="Double Under, Handstand Walk…"
        autoFocus
      />

      <Secao titulo="Como praticou">
        <Linha>
          <Campo
            rotulo="Duração"
            valor={mmss(bloco.duracaoSec)}
            aoMudar={(t) => aoMudar({ ...bloco, duracaoSec: paraSegundos(t) })}
            placeholder="mm:ss"
          />
          <Campo
            rotulo="Intervalo"
            valor={mmss(bloco.intervaloSec)}
            aoMudar={(t) => aoMudar({ ...bloco, intervaloSec: paraSegundos(t) })}
            placeholder="EMOM = 1:00"
          />
        </Linha>
      </Secao>

      <Secao titulo="Resultado">
        <Linha>
          <Campo
            rotulo="Acertos"
            valor={bloco.acertos != null ? String(bloco.acertos) : ""}
            aoMudar={(t) => aoMudar({ ...bloco, acertos: paraInteiro(t) })}
            placeholder="8"
            teclado="numeric"
          />
          <Campo
            rotulo="De quantos"
            valor={bloco.tentativas != null ? String(bloco.tentativas) : ""}
            aoMudar={(t) => aoMudar({ ...bloco, tentativas: paraInteiro(t) })}
            placeholder="10"
            teclado="numeric"
          />
        </Linha>
        <Campo
          rotulo="Melhor sequência sem quebrar"
          valor={bloco.melhorSequencia != null ? String(bloco.melhorSequencia) : ""}
          aoMudar={(t) => aoMudar({ ...bloco, melhorSequencia: paraInteiro(t) })}
          placeholder="35"
          teclado="numeric"
        />
        <Txt variant="caption" color={colors.text3}>
          Esse número vira recorde — é ele que mostra a evolução do movimento.
        </Txt>
      </Secao>
    </View>
  );
}
