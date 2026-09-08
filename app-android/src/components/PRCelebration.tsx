// Celebração de recorde (PR) — o único momento animado do app (brief §2.9).
// Banner que desliza do topo sobre a tela ativa, com glow lima, e some sozinho
// em ~3s. Vive num provider no topo da árvore para sobreviver à navegação (as
// telas de registro navegam logo depois de salvar). Usa o Animated nativo do RN
// (funciona no react-native-web) — nada de reanimated (bundling no Metro web).

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Txt } from "./ui";
import { prTypeLabel, prValueLabel } from "../api/prs";
import type { NewPR } from "../api/activities";
import { colors, radius, spacing, motion, sportColor } from "../theme";

type CelebrateFn = (prs: NewPR[]) => void;

const PRCelebrationContext = createContext<CelebrateFn>(() => {});

/** Hook para disparar a celebração: `const celebratePR = usePRCelebration()`. */
export function usePRCelebration(): CelebrateFn {
  return useContext(PRCelebrationContext);
}

const VISIBLE_MS = 3000;
const NAMED = new Set(["carga_max", "rm_estimado", "carga_faixa", "wod_time", "wod_score", "wod_load"]);
const LOAD_TYPES = new Set(["carga_max", "rm_estimado", "carga_faixa", "wod_load"]);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Título + linha principal do banner a partir dos recordes. */
function summarize(prs: NewPR[]): { title: string; line: string; delta: string | null; sportId?: string } {
  const p = prs[0];
  const label = NAMED.has(p.type)
    ? `${capitalize(p.exerciseName)} · ${prTypeLabel(p.type, p.repRange)}`
    : prTypeLabel(p.type, p.repRange);
  const value = p.milestone != null ? `${p.milestone} — marco!` : prValueLabel(p.type, p.value, p.unit);
  // Delta só faz sentido (e é "para cima") em tipos de carga.
  let delta: string | null = null;
  if (p.previousValue != null && LOAD_TYPES.has(p.type)) {
    const diff = Math.round((p.value - p.previousValue) * 10) / 10;
    if (diff > 0) delta = `▲ +${diff} ${p.unit}`.trim();
  }
  const title = prs.length > 1 ? `✦ ${prs.length} novos recordes` : "✦ Novo recorde";
  return { title, line: `${label}: ${value}`, delta };
}

export function PRCelebrationProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [prs, setPrs] = useState<NewPR[] | null>(null);
  const anim = useRef(new Animated.Value(0)).current; // 0 = fora (topo), 1 = visível
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: motion.base,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setPrs(null);
    });
  }, [anim]);

  const celebratePR = useCallback<CelebrateFn>(
    (next) => {
      if (!next || next.length === 0) return;
      if (timer.current) clearTimeout(timer.current);
      setPrs(next);
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: motion.celebration,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }).start();
      timer.current = setTimeout(hide, VISIBLE_MS);
    },
    [anim, hide]
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const info = prs ? summarize(prs) : null;
  const accent = info?.sportId ? sportColor(info.sportId) : colors.lime;

  return (
    <PRCelebrationContext.Provider value={celebratePR}>
      {children}
      {info ? (
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            paddingTop: insets.top + spacing.sm,
            paddingHorizontal: spacing.gutter,
            opacity: anim,
            transform: [
              {
                translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-120, 0] }),
              },
            ],
            // z acima do Leaflet/overlays (que usam ~1000/1100).
            zIndex: 2000,
            elevation: 24,
          }}
        >
          <TouchableOpacity activeOpacity={0.9} onPress={hide}>
            <View
              style={{
                backgroundColor: colors.surface2,
                borderRadius: radius.hero,
                borderWidth: 1,
                borderColor: accent,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.md,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                // Glow lima — o único brilho do app.
                shadowColor: accent,
                shadowOpacity: Platform.OS === "web" ? 0.5 : 0.35,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 0 },
              }}
            >
              <View style={{ flex: 1 }}>
                <Txt variant="label" color={accent}>
                  {info.title}
                </Txt>
                <Txt variant="titleCard" style={{ marginTop: 2 }} numberOfLines={2}>
                  {info.line}
                </Txt>
                {info.delta ? (
                  <Txt variant="label" color={colors.lime} tabular style={{ marginTop: 2 }}>
                    {info.delta}
                  </Txt>
                ) : null}
              </View>
            </View>
          </TouchableOpacity>
        </Animated.View>
      ) : null}
    </PRCelebrationContext.Provider>
  );
}
