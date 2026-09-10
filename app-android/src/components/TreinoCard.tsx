import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Txt } from "./ui";
import { colors, radius, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { TreinoPublico } from "../api/social";

// Como um treino se apresenta no perfil. O formato muda por esporte: corrida
// fala em quilômetros e ritmo, musculação em volume. Mostrar "3.240 kg" numa
// corrida ou "5:01/km" numa série de supino não diz nada a ninguém.

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
function destaques(t: TreinoPublico): { valor: string; rotulo: string }[] {
  const m = t.metrics ?? {};

  if (t.kind === "endurance" && (m.distanceKm ?? 0) > 0) {
    const out = [{ valor: `${numero(m.distanceKm!, 2)} km`, rotulo: "distância" }];
    if (t.durationSec > 0) out.push({ valor: duracao(t.durationSec), rotulo: "tempo" });
    if ((m.paceSecPerKm ?? 0) > 0) out.push({ valor: ritmo(m.paceSecPerKm!), rotulo: "ritmo" });
    return out;
  }

  if (t.kind === "strength") {
    const out: { valor: string; rotulo: string }[] = [];
    if ((m.volumeKg ?? 0) > 0) out.push({ valor: `${numero(m.volumeKg!)} kg`, rotulo: "volume" });
    if ((m.workingSets ?? 0) > 0) out.push({ valor: String(m.workingSets), rotulo: "séries" });
    if (t.durationSec > 0) out.push({ valor: duracao(t.durationSec), rotulo: "tempo" });
    return out;
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

export function TreinoCard({ treino, onPress }: { treino: TreinoPublico; onPress?: () => void }) {
  const cor = sportColor(treino.sportId);
  const stats = destaques(treino);

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

      {!!treino.title && (
        <Txt variant="titleCard" style={{ marginTop: 2 }}>
          {treino.title}
        </Txt>
      )}

      {stats.length > 0 && (
        <View style={{ flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm }}>
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
