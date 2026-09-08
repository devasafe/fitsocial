import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { View, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import { notify } from "../lib/notify";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button } from "../components/ui";
import { RouteMap } from "../components/RouteMap";
import { createActivity } from "../api/activities";
import { usePRCelebration } from "../components/PRCelebration";
import { totalDistanceM, paceLabel, clock, type GeoPoint } from "../lib/geo";
import { colors, spacing, radius, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "LiveTrack">;
type Status = "idle" | "recording" | "paused";

export function LiveTrackScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const celebratePR = usePRCelebration();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [status, setStatus] = useState<Status>("idle");
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const subRef = useRef<Location.LocationSubscription | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTsRef = useRef(0);
  const elapsedBaseRef = useRef(0);
  const resumeMsRef = useRef(0);

  // Em tela cheia, esconde o header nativo para o mapa ocupar tudo.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: !fullscreen });
  }, [fullscreen, navigation]);

  const pushLoc = useCallback((loc: Location.LocationObject) => {
    setAccuracyM(loc.coords.accuracy ?? null);
    setPoints((prev) => [
      ...prev,
      {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        t: (loc.timestamp - startTsRef.current) / 1000,
        ele: loc.coords.altitude ?? undefined,
      },
    ]);
  }, []);

  const stopTracking = useCallback(() => {
    subRef.current?.remove();
    subRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  useEffect(() => stopTracking, [stopTracking]);

  async function beginTracking() {
    resumeMsRef.current = Date.now();
    tickRef.current = setInterval(() => {
      setElapsedSec(elapsedBaseRef.current + (Date.now() - resumeMsRef.current) / 1000);
    }, 500);
    subRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
      pushLoc
    );
  }

  async function start() {
    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== "granted") {
      notify("Localização necessária", "Libere o acesso à localização para gravar o percurso.");
      return;
    }
    startTsRef.current = Date.now();
    elapsedBaseRef.current = 0;
    setPoints([]);
    setElapsedSec(0);
    setStatus("recording");
    try {
      const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      pushLoc(first);
    } catch {
      notify("Sem sinal de GPS ainda", "Em área aberta funciona melhor — vou continuar tentando.");
    }
    await beginTracking();
  }

  function pause() {
    elapsedBaseRef.current += (Date.now() - resumeMsRef.current) / 1000;
    stopTracking();
    setStatus("paused");
  }

  async function resume() {
    await beginTracking();
    setStatus("recording");
  }

  async function finish() {
    if (status === "recording") pause();
    if (points.length < 2) {
      notify("Percurso muito curto", "Ainda não deu para captar o trajeto. Continue ou tente de novo.");
      return;
    }
    setSaving(true);
    try {
      const res = await createActivity(token!, {
        sportId,
        kind: "endurance",
        payload: { distanceM: 0, points: points.map((p) => ({ lat: p.lat, lng: p.lng, t: p.t, ele: p.ele })) },
      });
      celebratePR(res.meta.newPRs ?? []);
      navigation.navigate("Tabs");
    } catch (err) {
      notify("Não deu para salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const distanceM = totalDistanceM(points);
  const statusLine =
    status === "idle"
      ? "Toque em iniciar para gravar"
      : `${points.length} ponto(s)${accuracyM != null ? ` · precisão ~${Math.round(accuracyM)} m` : ""}`;

  function controls() {
    if (status === "idle") return <Button title="Iniciar" onPress={start} size="lg" glow />;
    return (
      <>
        {status === "recording" ? (
          <Button title="Pausar" variant="secondary" onPress={pause} />
        ) : (
          <Button title="Retomar" onPress={resume} size="lg" glow />
        )}
        <Button title="Finalizar e salvar" onPress={finish} loading={saving} size="lg" glow />
      </>
    );
  }

  function stats(compact?: boolean) {
    return (
      <>
        <Txt variant="label" color={colors.text2}>
          Distância
        </Txt>
        <Txt variant={compact ? "metricLg" : "metricHero"} tabular color={sportColor(sportId)}>
          {(distanceM / 1000).toFixed(2)}
          <Txt variant="titleSection" color={colors.text2}>
            {" "}
            km
          </Txt>
        </Txt>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm }}>
          <View>
            <Txt variant="label" color={colors.text2}>
              Tempo
            </Txt>
            <Txt variant="metricMd" tabular>
              {clock(elapsedSec)}
            </Txt>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Txt variant="label" color={colors.text2}>
              Ritmo /km
            </Txt>
            <Txt variant="metricMd" tabular>
              {paceLabel(distanceM, elapsedSec)}
            </Txt>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.sm }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: sportColor(sportId) }} />
          <Txt variant="titleScreen">{sportLabel(sportId)}</Txt>
        </View>

        {!fullscreen ? (
          <TouchableOpacity activeOpacity={0.9} onPress={() => setFullscreen(true)}>
            <View pointerEvents="none">
              <RouteMap points={points} sportId={sportId} interactive={false} height={220} />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={{ height: 220, borderRadius: radius.card, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" }}>
            <Txt variant="label" color={colors.text3}>
              Mapa em tela cheia
            </Txt>
          </View>
        )}
        <Txt variant="caption" color={colors.text3} style={{ textAlign: "center" }}>
          {statusLine}
          {status !== "idle" ? " · toque no mapa para ampliar" : ""}
        </Txt>

        <Card level={2}>{stats()}</Card>

        {controls()}
      </Screen>

      {fullscreen ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
          <RouteMap key="full" points={points} sportId={sportId} interactive height={winH} />

          <TouchableOpacity
            onPress={() => setFullscreen(false)}
            activeOpacity={0.85}
            style={[styles.pill, { top: insets.top + 8, left: spacing.gutter }]}
          >
            <Txt variant="label" color={colors.text}>
              ▾ Minimizar
            </Txt>
          </TouchableOpacity>

          <View style={{ position: "absolute", left: spacing.gutter, right: spacing.gutter, bottom: insets.bottom + spacing.md, gap: spacing.sm, zIndex: 1100, elevation: 12 }}>
            <Card level={3}>{stats(true)}</Card>
            {controls()}
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: 14,
    zIndex: 1100,
    elevation: 12,
  },
});
