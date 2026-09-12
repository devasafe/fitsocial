import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Txt } from "./ui";
import { colors, radius, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import { linhasDoCard } from "../lib/crossfitResumo";
import { tituloPorMusculos, musculosDe } from "../lib/musculos";
import type { PayloadDeCrossfit } from "../api/crossfit";
import type { ActivityMetrics } from "../api/activities";

/**
 * O que o cartão precisa saber — e nada além.
 *
 * Era `TreinoPublico`, o contrato de `/social/users/:id/activities`, e isso
 * prendia o cartão ao perfil de outra pessoa. A aba Atividades mostra os
 * treinos do próprio dono, que vêm de `/activities` com uma forma parecida mas
 * não idêntica. Pedir só os campos que ele lê deixa os dois servirem o mesmo
 * cartão — que é o ponto: o mesmo treino tem que se apresentar igual, venha de
 * onde vier.
 */
export interface TreinoNoCard {
  sportId: string;
  kind: string;
  title?: string;
  startedAt: string;
  durationSec: number;
  metrics?: ActivityMetrics | null;
  /** O payload cru — daqui sai o nome de uma atividade "Outro". */
  payload?: unknown;
  crossfit?: PayloadDeCrossfit | null;
  /** Os exercícios já escritos pelo servidor: "4×10  Supino reto  80 kg". */
  movimentos?: string[] | null;
  /** Quantos exercícios o treino tem de verdade — `movimentos` vem cortado. */
  movimentosTotal?: number;
  /** true quando esse treino também virou publicação no feed. */
  compartilhado?: boolean;
}

// Como um treino se apresenta no perfil. O formato muda por esporte: corrida
// fala em quilômetros e ritmo, musculação em volume. Mostrar "3.240 kg" numa
// corrida ou "5:01/km" numa série de supino não diz nada a ninguém.

/** O cartão resume; o detalhe abre. Seis é onde a lista deixa de ser um
 *  resumo — o mesmo teto que o cartão do feed usa. */
const MAXIMO_DE_MOVIMENTOS = 6;

function duracao(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.round((seg % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function numero(n: number, casas = 0): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function ritmo(segPorKm: number): string {
  const m = Math.floor(segPorKm / 60);
  const s = Math.round(segPorKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/** Os três números que definem aquele treino, na ordem em que importam. */
function destaques(t: TreinoNoCard): { valor: string; rotulo: string }[] {
  const m = t.metrics ?? {};

  if (t.kind === "endurance" && (m.distanceKm ?? 0) > 0) {
    const out = [{ valor: `${numero(m.distanceKm!, 2)} km`, rotulo: "distância" }];
    if (t.durationSec > 0) out.push({ valor: duracao(t.durationSec), rotulo: "tempo" });
    // `avgPaceSecPerKm` é o nome que o servidor grava (`activityMetrics.ts`).
    // Aqui liamos `paceSecPerKm`, que ninguém escreve — e o ritmo, que é o
    // número que uma corrida tem de mostrar, nunca aparecia em cartão nenhum.
    if ((m.avgPaceSecPerKm ?? 0) > 0) {
      out.push({ valor: ritmo(m.avgPaceSecPerKm!), rotulo: "ritmo" });
    }
    return out;
  }

  if (t.kind === "strength") {
    // Só o tempo, igual ao feed. Volume total e contagem de séries são métrica
    // de acompanhamento e vivem no detalhe do treino — o assunto do cartão é o
    // que foi treinado, que está no título e na lista de exercícios.
    return t.durationSec > 0 ? [{ valor: duracao(t.durationSec), rotulo: "tempo" }] : [];
  }

  // Demais esportes: o tempo é o que sempre existe.
  return t.durationSec > 0 ? [{ valor: duracao(t.durationSec), rotulo: "tempo" }] : [];
}

function quando(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const ontem = new Date(hoje.getTime() - 86400000).toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (mesmoDia) return `Hoje · ${hora}`;
  if (ontem) return `Ontem · ${hora}`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function TreinoCard({ treino, onPress }: { treino: TreinoNoCard; onPress?: () => void }) {
  const cor = sportColor(treino.sportId);
  const stats = destaques(treino);
  const linhasCrossfit = treino.crossfit ? linhasDoCard(treino.crossfit) : [];
  // CrossFit tem as linhas dele, montadas no app a partir dos blocos. O resto
  // usa o que o servidor escreveu.
  const movimentos = linhasCrossfit.length ? [] : (treino.movimentos ?? []);
  // Quantos ficaram de fora. Conta sobre o TOTAL do servidor, e não sobre a
  // lista que ele já cortou em oito: sem isso, todo treino de oito ou mais
  // dizia "+2", e quem fez quinze exercícios lia que faltavam dois.
  const total = treino.movimentosTotal ?? movimentos.length;
  const restantes = Math.max(total - MAXIMO_DE_MOVIMENTOS, 0);

  // O nome que a pessoa deu ganha; sem ele, o assunto é o que foi treinado.
  // O esporte já está dito na linha colorida acima e na borda do cartão.
  //
  // Numa atividade "Outro" não há músculo nem exercício para resumir: o assunto
  // é o nome que ela escreveu. Sem isto, todo registro de "Outro" virava a
  // linha "Outro · 45min" — a mesma queixa do histórico de musculação, um
  // esporte adiante.
  const nomeLivre =
    treino.kind === "generic"
      ? ((treino.payload as { activityName?: string } | null)?.activityName ?? "").trim()
      : "";
  const assunto =
    treino.title?.trim() || nomeLivre || tituloPorMusculos(musculosDe(treino.metrics));

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.75 : 1}
      onPress={onPress}
      disabled={!onPress}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderLeftWidth: 3,
        borderLeftColor: cor,
        padding: spacing.md,
        marginBottom: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Txt variant="label" color={cor}>
          {sportLabel(treino.sportId)}
        </Txt>
        {treino.compartilhado && (
          <Txt variant="caption" color={colors.text3}>
            · compartilhado
          </Txt>
        )}
      </View>

      {!!assunto && (
        <Txt variant="titleCard" style={{ marginTop: 2 }}>
          {assunto}
        </Txt>
      )}

      {/* CrossFit não cabe em três números: o que define o treino é o WOD e o
          resultado. Aquecimento e mobilidade ficam para o detalhe. */}
      {linhasCrossfit.map((linha, i) => (
        <Txt
          key={i}
          variant={i === 0 ? "titleCard" : "body"}
          color={i === 0 ? colors.text : colors.text2}
          style={{ marginTop: i === 0 ? 2 : 0 }}
        >
          {linha}
        </Txt>
      ))}

      {movimentos.slice(0, MAXIMO_DE_MOVIMENTOS).map((linha, i) => (
        <Txt key={i} variant="caption" color={colors.text2} style={{ marginTop: i === 0 ? 6 : 2 }}>
          {linha}
        </Txt>
      ))}
      {restantes > 0 && (
        <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
          +{restantes} exercício{restantes > 1 ? "s" : ""}
        </Txt>
      )}

      {stats.length > 0 && (
        // Com o ritmo de volta, a corrida passou a ter TRÊS números, e três em
        // `metricMd` não cabem em 284dp úteis: o terceiro — justamente o ritmo,
        // que é o que se abre a tela para ver — saía pela borda. Com wrap ele
        // desce inteiro em vez de ficar cortado.
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, marginTop: spacing.sm }}
        >
          {stats.map((s) => (
            <View key={s.rotulo}>
              <Txt variant="metricMd" tabular>
                {s.valor}
              </Txt>
              <Txt variant="caption" color={colors.text3}>
                {s.rotulo}
              </Txt>
            </View>
          ))}
        </View>
      )}

      <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.sm }}>
        {quando(treino.startedAt)}
      </Txt>
    </TouchableOpacity>
  );
}
