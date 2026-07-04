import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { createCheckIn, type CheckInEntry } from "../api/checkins";
import { PrimaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

interface Row {
  exerciseName: string;
  weight: string;
  reps: string;
}

export function CheckInScreen() {
  const route = useRoute<RouteProp<AppStackParams, "CheckIn">>();
  const nav = useNavigation();
  const { token } = useAuth();
  const { session } = route.params;

  const [rows, setRows] = useState<Row[]>(
    session.exercises.map((e) => ({ exerciseName: e.name, weight: "", reps: "" }))
  );
  const [notes, setNotes] = useState("");
  const [share, setShare] = useState(true);
  const [shareText, setShareText] = useState(`Concluí o treino: ${session.day} 💪`);
  const [saving, setSaving] = useState(false);

  function updateRow(i: number, field: "weight" | "reps", value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function handleSave() {
    // Considera apenas exercícios com carga OU reps preenchidos.
    const entries: CheckInEntry[] = rows
      .filter((r) => r.weight !== "" || r.reps !== "")
      .map((r) => ({
        exerciseName: r.exerciseName,
        weightKg: Number(r.weight) || 0,
        reps: Number(r.reps) || 0,
      }));

    if (entries.length === 0) {
      Alert.alert("Registre ao menos um exercício", "Preencha carga ou reps de pelo menos um exercício.");
      return;
    }

    setSaving(true);
    try {
      await createCheckIn(token!, {
        sessionDay: session.day,
        entries,
        notes: notes.trim() || undefined,
        shareToFeed: share,
        shareText: share ? shareText.trim() : undefined,
      });
      Alert.alert("Treino registrado! 🎉", share ? "E compartilhado no seu feed." : undefined);
      nav.goBack();
    } catch (err) {
      Alert.alert("Não foi possível registrar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{session.day}</Text>
      <Text style={styles.subtitle}>Registre a carga e as reps que você fez.</Text>

      {rows.map((row, i) => (
        <View key={i} style={styles.exercise}>
          <Text style={styles.exerciseName}>{row.exerciseName}</Text>
          <View style={styles.inputsRow}>
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>Carga (kg)</Text>
              <TextInput
                style={styles.input}
                value={row.weight}
                onChangeText={(v) => updateRow(i, "weight", v)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>Reps</Text>
              <TextInput
                style={styles.input}
                value={row.reps}
                onChangeText={(v) => updateRow(i, "reps", v)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>
        </View>
      ))}

      <Text style={styles.inputLabel}>Observações (opcional)</Text>
      <TextInput
        style={[styles.input, styles.notes]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Como foi o treino?"
        placeholderTextColor={colors.textMuted}
        multiline
      />

      <View style={styles.shareRow}>
        <Text style={styles.shareLabel}>Compartilhar no feed</Text>
        <Switch
          value={share}
          onValueChange={setShare}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.text}
        />
      </View>
      {share && (
        <TextInput
          style={styles.input}
          value={shareText}
          onChangeText={setShareText}
          placeholder="Texto do post"
          placeholderTextColor={colors.textMuted}
        />
      )}

      <View style={{ height: spacing.lg }} />
      <PrimaryButton title="Registrar treino" onPress={handleSave} loading={saving} />
      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  subtitle: { color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  exercise: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  exerciseName: { color: colors.text, fontWeight: "700", marginBottom: spacing.sm },
  inputsRow: { flexDirection: "row", gap: spacing.md },
  inputWrap: { flex: 1 },
  inputLabel: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 16,
  },
  notes: { minHeight: 60, textAlignVertical: "top", marginBottom: spacing.md },
  shareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: spacing.md,
  },
  shareLabel: { color: colors.text, fontWeight: "600" },
});
