import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParams } from "../navigation/types";
import { colors, radius, spacing } from "../theme";
import { resolveExerciseVideos, type VideoRef } from "../api/exerciseVideos";
import { ExerciseVideoThumb } from "../components/ExerciseVideoThumb";
import { useAuth } from "../context/AuthContext";
import { Txt, Card, Button } from "../components/ui";

type Props = NativeStackScreenProps<AppStackParams, "Workout">;

export function WorkoutScreen({ route, navigation }: Props) {
  const { workout } = route.params;
  const { token } = useAuth();
  const [videos, setVideos] = useState<Record<string, VideoRef | null>>({});
  const [loadingVideos, setLoadingVideos] = useState(true);

  useEffect(() => {
    const names = [...new Set(workout.sessions.flatMap((s) => s.exercises.map((e) => e.name)))];
    let alive = true;
    resolveExerciseVideos(names, token)
      .then((v) => alive && setVideos(v))
      .catch(() => alive && setVideos({})) // não bloqueia o treino
      .finally(() => alive && setLoadingVideos(false));
    return () => {
      alive = false;
    };
  }, [workout, token]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Txt variant="titleScreen">{workout.split}</Txt>
        <Txt variant="label" color={colors.text2} style={{ marginTop: 4 }}>
          {workout.daysPerWeek} treinos por semana
        </Txt>
      </View>

      {workout.sessions.map((session, i) => (
        <Card key={i} level={1} style={styles.session}>
          <Txt variant="titleCard">{session.day}</Txt>
          <Txt variant="label" color={colors.text2} style={{ marginTop: 2 }}>
            {session.focus}
          </Txt>

          <View style={styles.exList}>
            {session.exercises.map((ex, j) => (
              <View key={j} style={[styles.exercise, j > 0 && styles.exerciseDivider]}>
                <ExerciseVideoThumb
                  video={videos[ex.name] ?? null}
                  loading={loadingVideos}
                  exerciseName={ex.name}
                />
                <View style={styles.exBody}>
                  <Txt variant="bodyStrong" numberOfLines={2}>
                    {ex.name}
                  </Txt>
                  <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                    Descanso {ex.restSeconds}s
                  </Txt>
                  {ex.notes ? (
                    <Txt variant="caption" color={colors.text3} style={{ marginTop: 2 }}>
                      {ex.notes}
                    </Txt>
                  ) : null}
                </View>
                <Txt variant="metricMd" tabular style={styles.exSets}>
                  {ex.sets}
                  <Txt variant="label" color={colors.text2}>
                    {" "}× {ex.reps}
                  </Txt>
                </Txt>
              </View>
            ))}
          </View>

          <Button
            title="Começar treino"
            size="lg"
            onPress={() => navigation.navigate("CheckIn", { session })}
            style={{ marginTop: spacing.s16 }}
          />
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.gutter, gap: spacing.card },
  head: { marginBottom: spacing.sm },
  session: { borderRadius: radius.card },
  exList: { marginTop: spacing.s16 },
  exercise: { flexDirection: "row", alignItems: "center", gap: spacing.s12, paddingVertical: spacing.s12 },
  exerciseDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  exBody: { flex: 1 },
  exSets: { textAlign: "right" },
});
