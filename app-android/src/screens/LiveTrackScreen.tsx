import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Alert } from "react-native";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card, Button } from "../components/ui";
import { RouteMap } from "../components/RouteMap";
import { createActivity } from "../api/activities";
import { newPRMessage } from "../api/prs";
import { totalDistanceM, paceLabel, clock, type GeoPoint } from "../lib/geo";
import { colors, spacing, sportColor } from "../theme";
import { sportLabel } from "../lib/sportLabel";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "LiveTrack">;
type Status = "idle" | "recording" | "paused";

export function LiveTrackScreen({ route, navigation }: Props) {
  const { sportId } = route.params;
  const { token } = useAuth();
  const [status, setStatus] = useState<Status>("idle");
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [saving, setSaving] = useState(false);

  const subRef = useRef<Location.LocationSubscription | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTsRef = useRef(0);
  const elapsedBaseRef = useRef(0);
  const resumeMsRef = useRef(0);

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
      { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 },
      (loc) => {
        setPoints((prev) => [
          ...prev,
          {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            t: (loc.timestamp - startTsRef.current) / 1000,
            ele: loc.coords.altitude ?? undefined,
          },
        ]);
      }
    );
  }

  async function start() {
    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== "granted") {
      Alert.alert("Localização necessária", "Libere o acesso à localização para gravar o percurso.");
      return;
    }
    startTsRef.current = Date.now();
    elapsedBaseRef.current = 0;
    setPoints([]);
    setElapsedSec(0);
    await beginTracking();
    setStatus("recording");
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
      Alert.alert("Percurso muito curto", "Ainda não deu para captar o trajeto. Continue ou tente de novo.");
      return;
    }
    setSaving(true);
    try {
      const res = await createActivity(token!, {
        sportId,
        kind: "endurance",
        payload: { distanceM: 0, points: points.map((p) => ({ lat: p.lat, lng: p.lng, t: p.t, ele: p.ele })) },
      });
      const msg = newPRMessage(res.meta.newPRs ?? []);
      if (msg) Alert.alert(msg.title, msg.body, [{ text: "Boa!", onPress: () => navigation.navigate("Tabs") }]);
      else navigation.navigate("Tabs");
    } catch (err) {
      Alert.alert("Não deu para salvar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const distanceM = totalDistanceM(points);

  return (
    <Screen scroll contentStyle={{ gap: spacing.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.sm }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: sportColor(sportId) }} />
        <Txt variant="titleScreen">{sportLabel(sportId)}</Txt>
      </View>

      <RouteMap points={points} sportId={sportId} height={220} />

      <Card level={2}>
        <Txt variant="label" color={colors.text2}>
          Distância
        </Txt>
        <Txt variant="metricHero" tabular color={sportColor(sportId)}>
          {(distanceM / 1000).toFixed(2)}
          <Txt variant="titleSection" color={colors.text2}>
            {" "}
            km
          </Txt>
        </Txt>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md }}>
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
      </Card>

      {status === "idle" ? (
        <Button title="Iniciar" onPress={start} size="lg" glow />
      ) : (
        <>
          {status === "recording" ? (
            <Button title="Pausar" variant="secondary" onPress={pause} />
          ) : (
            <Button title="Retomar" onPress={resume} size="lg" glow />
          )}
          <Button title="Finalizar e salvar" onPress={finish} loading={saving} size="lg" glow />
        </>
      )}
    </Screen>
  );
}
