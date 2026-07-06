import React, { useState } from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking, ActivityIndicator } from "react-native";
import { colors, radius } from "../theme";
import type { VideoRef } from "../api/exerciseVideos";
import { ExerciseVideoModal } from "./ExerciseVideoModal";

interface Props {
  video: VideoRef | null;
  loading?: boolean;
  exerciseName: string;
}

const W = 64;
const H = 40;

export function ExerciseVideoThumb({ video, loading, exerciseName }: Props) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <View style={[styles.box, styles.center]}>
        <ActivityIndicator size="small" color={colors.textMuted} />
      </View>
    );
  }

  // Sem vídeo (sem API key ou "miss"): fallback abre a busca no YouTube externo.
  if (!video) {
    const q = encodeURIComponent(`${exerciseName} execução correta`);
    return (
      <TouchableOpacity
        style={[styles.box, styles.center, styles.fallback]}
        onPress={() => Linking.openURL(`https://www.youtube.com/results?search_query=${q}`)}
        accessibilityLabel={`Buscar vídeo de ${exerciseName} no YouTube`}
      >
        <Text style={styles.play}>▶</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={styles.box}
        onPress={() => setOpen(true)}
        accessibilityLabel={`Ver vídeo de ${exerciseName}`}
      >
        <Image source={{ uri: video.thumbnailUrl }} style={styles.thumb} resizeMode="cover" />
        <View style={styles.overlay}>
          <Text style={styles.play}>▶</Text>
        </View>
      </TouchableOpacity>
      <ExerciseVideoModal
        visible={open}
        video={video}
        exerciseName={exerciseName}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  box: { width: W, height: H, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  fallback: { borderWidth: 1, borderColor: colors.border },
  thumb: { width: "100%", height: "100%" },
  overlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  play: { color: "#fff", fontSize: 14, fontWeight: "900" },
});
