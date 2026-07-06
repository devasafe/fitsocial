import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParams } from "../navigation/types";
import { colors, radius, spacing } from "../theme";
import { resolveExerciseVideos, type VideoRef } from "../api/exerciseVideos";
import { ExerciseVideoThumb } from "../components/ExerciseVideoThumb";
import { useAuth } from "../context/AuthContext";

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
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{workout.split}</Text>
        <Text style={styles.badgeSub}>{workout.daysPerWeek}x por semana</Text>
      </View>

      {workout.sessions.map((session, i) => (
        <View key={i} style={styles.session}>
          <Text style={styles.sessionDay}>{session.day}</Text>
          <Text style={styles.sessionFocus}>{session.focus}</Text>

          {session.exercises.map((ex, j) => (
            <View key={j} style={styles.exercise}>
              <View style={styles.exerciseHeader}>
                <ExerciseVideoThumb
                  video={videos[ex.name] ?? null}
                  loading={loadingVideos}
                  exerciseName={ex.name}
                />
                <Text style={styles.exerciseName}>{ex.name}</Text>
                <Text style={styles.exerciseSets}>
                  {ex.sets} × {ex.reps}
                </Text>
              </View>
              <Text style={styles.exerciseMeta}>Descanso: {ex.restSeconds}s</Text>
              {ex.notes ? <Text style={styles.exerciseNotes}>{ex.notes}</Text> : null}
            </View>
          ))}

          <TouchableOpacity
            style={styles.checkinBtn}
            onPress={() => navigation.navigate("CheckIn", { session })}
          >
            <Text style={styles.checkinText}>▶ Iniciar este treino</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  badgeText: { color: colors.primaryText, fontWeight: "800", fontSize: 18 },
  badgeSub: { color: colors.primaryText, opacity: 0.8, marginTop: 2 },
  session: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sessionDay: { color: colors.text, fontWeight: "800", fontSize: 16 },
  sessionFocus: { color: colors.textMuted, marginBottom: spacing.sm },
  exercise: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  exerciseHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  exerciseName: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1, marginHorizontal: spacing.sm },
  exerciseSets: { color: colors.primary, fontWeight: "700" },
  exerciseMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  exerciseNotes: { color: colors.textMuted, fontSize: 12, fontStyle: "italic", marginTop: 2 },
  checkinBtn: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  checkinText: { color: colors.primary, fontWeight: "700" },
});
