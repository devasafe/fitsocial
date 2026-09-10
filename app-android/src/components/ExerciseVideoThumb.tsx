import React, { useState } from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking, ActivityIndicator } from "react-native";
import { colors, radius } from "../theme";
import type { VideoRef } from "../api/exerciseVideos";
import { ExerciseVideoModal } from "./ExerciseVideoModal";
import { EscolherPlataformaSheet } from "./EscolherPlataformaSheet";
import {
  getPlataforma,
  setPlataforma,
  urlDeBusca,
  type PlataformaDeVideo,
} from "../lib/plataformaDeVideo";

interface Props {
  video: VideoRef | null;
  loading?: boolean;
  exerciseName: string;
}

const W = 64;
const H = 40;

export function ExerciseVideoThumb({ video, loading, exerciseName }: Props) {
  const [open, setOpen] = useState(false);
  const [escolhendo, setEscolhendo] = useState(false);

  function abrirBusca(plataforma: PlataformaDeVideo) {
    void Linking.openURL(urlDeBusca(plataforma, exerciseName));
  }

  // Só pergunta quem ainda não respondeu. Respondeu uma vez, virou preferência
  // — e preferência não se pergunta de novo no meio do treino.
  async function verExecucao() {
    const guardada = await getPlataforma();
    if (guardada) {
      abrirBusca(guardada);
      return;
    }
    setEscolhendo(true);
  }

  async function escolher(plataforma: PlataformaDeVideo) {
    await setPlataforma(plataforma);
    abrirBusca(plataforma);
  }

  if (loading) {
    return (
      <View style={[styles.box, styles.center]}>
        <ActivityIndicator size="small" color={colors.textMuted} />
      </View>
    );
  }

  // Sem vídeo em cache (sem chave de API ou "miss"): a busca vai para fora, na
  // plataforma que a pessoa escolheu.
  if (!video) {
    return (
      <>
        <TouchableOpacity
          style={[styles.box, styles.center, styles.fallback]}
          onPress={() => void verExecucao()}
          accessibilityLabel={`Buscar vídeo de ${exerciseName}`}
        >
          <Text style={styles.play}>▶</Text>
        </TouchableOpacity>
        <EscolherPlataformaSheet
          visivel={escolhendo}
          aoFechar={() => setEscolhendo(false)}
          aoEscolher={(p) => void escolher(p)}
        />
      </>
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
