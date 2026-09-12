import React, { useEffect, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator } from "react-native";
import { notify } from "../lib/notify";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Button } from "../components/ui";
import { listSports, type Sport } from "../api/sports";
import { listActivities, type Activity } from "../api/activities";
import { sportLabel } from "../lib/sportLabel";
import { colors, spacing, radius, sportColor } from "../theme";
import { SkeletonGrade } from "../components/Skeleton";
import type { AppStackParams } from "../navigation/types";
import type { MuscleGroup } from "../api/library";

interface RecentSport {
  sportId: string;
  kind: string;
  label: string;
  activity: Activity; // a mais recente do esporte — fonte do "Repetir"
}

// Converte o payload de força salvo no formato do formulário (para pré-preencher).
type Prefill = NonNullable<AppStackParams["RegisterActivity"]["prefill"]>;

function strengthPrefill(payload: unknown): Prefill | undefined {
  const p = payload as
    | {
        exercises?: {
          name?: string;
          sets?: { weightKg?: number; reps?: number | null }[];
          exerciseId?: string | null;
          muscle?: MuscleGroup | null;
        }[];
      }
    | undefined;
  if (!p?.exercises?.length) return undefined;
  return p.exercises
    .filter((e) => e.name)
    .map((e) => {
      const sets = (e.sets ?? []).map((s) => ({
        weightKg: s.weightKg != null ? String(s.weightKg) : "",
        reps: s.reps != null ? String(s.reps) : "",
      }));
      return {
        name: e.name as string,
        sets: sets.length ? sets : [{ weightKg: "", reps: "" }],
        // O treino salvo já guarda os dois. Deixá-los para trás desfazia, a
        // cada "repetir", o vínculo que a pessoa criou ao escolher da lista.
        exerciseId: e.exerciseId ?? null,
        muscle: e.muscle ?? null,
      };
    });
}

export function RegistrarScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [sports, setSports] = useState<Sport[]>([]);
  const [recent, setRecent] = useState<RecentSport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSports(token!)
      .then(setSports)
      .catch(() => {})
      .finally(() => setLoading(false));
    // Esportes recentes (distintos, mais novo primeiro) — atalho de 1 toque.
    listActivities(token!)
      .then((res) => {
        const seen = new Set<string>();
        const out: RecentSport[] = [];
        for (const a of res.data) {
          if (seen.has(a.sportId)) continue;
          seen.add(a.sportId);
          out.push({ sportId: a.sportId, kind: a.kind, label: sportLabel(a.sportId), activity: a });
          if (out.length >= 4) break;
        }
        setRecent(out);
      })
      .catch(() => {});
  }, [token]);

  function route(kind: string, sportId: string, label: string, activity?: Activity) {
    switch (kind) {
      case "strength": {
        const prefill = activity ? strengthPrefill(activity.payload) : undefined;
        nav.navigate("RegisterActivity", prefill ? { sportId, prefill } : { sportId });
        break;
      }
      case "endurance":
        nav.navigate("RegisterEndurance", { sportId });
        break;
      case "class":
        nav.navigate("RegisterClass", { sportId });
        break;
      case "generic":
        nav.navigate("RegisterGeneric", { sportId });
        break;
      case "wod":
        // Uma tela só para todo kind "wod".
        //
        // Funcional e HIIT tinham formulário próprio porque o de CrossFit
        // exigia escolher tipo de bloco antes de escrever qualquer coisa. No v3
        // não exige: escreve-se o modo ("FOR TIME") e os movimentos, que é
        // exatamente o que um WOD de funcional é.
        nav.navigate("RegisterCrossfit", { sportId });
        break;
      default:
        notify("Em breve", `O registro de ${label} chega numa próxima atualização.`);
    }
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
        <Txt variant="titleScreen">Registrar</Txt>
        <TouchableOpacity onPress={() => nav.goBack()} hitSlop={10} activeOpacity={0.7}>
          <Txt variant="label" color={colors.text2}>
            Fechar
          </Txt>
        </TouchableOpacity>
      </View>

      {/* Atalho: continuar no esporte que você já treina */}
      {recent.length > 0 && (
        <View style={{ marginBottom: spacing.section }}>
          <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.sm }}>
            Recentes
          </Txt>
          <Button
            title={`${recent[0].kind === "strength" ? "Repetir" : "Registrar"} ${recent[0].label}`}
            onPress={() => route(recent[0].kind, recent[0].sportId, recent[0].label, recent[0].activity)}
            size="lg"
            glow
          />
          {recent.length > 1 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
              {recent.slice(1).map((r) => (
                <TouchableOpacity
                  key={r.sportId}
                  onPress={() => route(r.kind, r.sportId, r.label, r.activity)}
                  activeOpacity={0.8}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: radius.chip,
                    borderWidth: 1,
                    borderColor: colors.line,
                    backgroundColor: colors.surface,
                  }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sportColor(r.sportId) }} />
                  <Txt variant="label">{r.label}</Txt>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.md }}>
        {recent.length > 0 ? "Todos os esportes" : "Escolha o esporte que você treinou"}
      </Txt>

      {loading ? (
        <SkeletonGrade itens={6} altura={92} />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.card }}>
          {sports.map((s) => (
            <TouchableOpacity
              key={s.id}
              onPress={() => route(s.kind, s.id, s.label)}
              activeOpacity={0.85}
              style={{
                width: "31%",
                aspectRatio: 1,
                borderRadius: radius.card,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                alignItems: "center",
                justifyContent: "center",
                padding: spacing.sm,
                gap: 8,
              }}
            >
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: sportColor(s.id) }} />
              <Txt variant="label" color={colors.text} style={{ textAlign: "center" }}>
                {s.label}
              </Txt>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        onPress={() => nav.navigate("CreatePost")}
        activeOpacity={0.8}
        style={{
          marginTop: spacing.section,
          paddingVertical: spacing.md,
          alignItems: "center",
          borderRadius: radius.chip,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Txt variant="bodyStrong" color={colors.text2}>
          Só uma foto (post sem treino)
        </Txt>
      </TouchableOpacity>
    </Screen>
  );
}
