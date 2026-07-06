import React from "react";
import { Modal, View, Text, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import YoutubePlayer from "react-native-youtube-iframe";
import { colors, radius, spacing } from "../theme";
import type { VideoRef } from "../api/exerciseVideos";

interface Props {
  visible: boolean;
  video: VideoRef | null;
  exerciseName: string;
  onClose: () => void;
}

export function ExerciseVideoModal({ visible, video, exerciseName, onClose }: Props) {
  const width = Dimensions.get("window").width - spacing.lg * 2;
  const height = Math.round((width * 9) / 16);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title} numberOfLines={1}>
              {exerciseName}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          {video ? (
            <YoutubePlayer height={height} width={width} play={false} videoId={video.youtubeId} />
          ) : (
            <Text style={styles.empty}>Vídeo indisponível.</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.text, fontWeight: "800", fontSize: 16, flex: 1, marginRight: spacing.md },
  close: { color: colors.textMuted, fontSize: 18, fontWeight: "700" },
  empty: { color: colors.textMuted, paddingVertical: spacing.xl, textAlign: "center" },
});
