import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParams } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<AppStackParams, "Diet">;

function Macro({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.macro}>
      <Text style={styles.macroValue}>{value}g</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

export function DietScreen({ route }: Props) {
  const { diet } = route.params;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.calBadge}>
        <Text style={styles.calValue}>{diet.dailyCalories}</Text>
        <Text style={styles.calLabel}>kcal / dia</Text>
      </View>

      <View style={styles.macros}>
        <Macro label="Proteína" value={diet.macros.proteinG} />
        <Macro label="Carbo" value={diet.macros.carbsG} />
        <Macro label="Gordura" value={diet.macros.fatG} />
      </View>

      {diet.meals.map((meal, i) => (
        <View key={i} style={styles.meal}>
          <View style={styles.mealHeader}>
            <Text style={styles.mealName}>{meal.name}</Text>
            {meal.timeHint ? <Text style={styles.mealTime}>{meal.timeHint}</Text> : null}
          </View>
          {meal.items.map((item, j) => (
            <View key={j} style={styles.item}>
              <Text style={styles.itemFood}>{item.food}</Text>
              <Text style={styles.itemQty}>{item.quantity}</Text>
            </View>
          ))}
        </View>
      ))}

      {diet.notes ? <Text style={styles.notes}>{diet.notes}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  calBadge: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  calValue: { color: colors.primaryText, fontSize: 32, fontWeight: "800" },
  calLabel: { color: colors.primaryText, opacity: 0.8 },
  macros: { flexDirection: "row", gap: spacing.sm },
  macro: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  macroValue: { color: colors.text, fontSize: 18, fontWeight: "800" },
  macroLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  meal: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mealHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.sm },
  mealName: { color: colors.text, fontWeight: "800", fontSize: 16 },
  mealTime: { color: colors.primary, fontWeight: "600" },
  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  itemFood: { color: colors.text, flex: 1 },
  itemQty: { color: colors.textMuted },
  notes: { color: colors.textMuted, fontStyle: "italic", lineHeight: 20 },
});
