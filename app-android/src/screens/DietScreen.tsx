import React from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParams } from "../navigation/types";
import { colors, radius, spacing, elevation } from "../theme";
import { Txt, Card, MetricTile } from "../components/ui";

type Props = NativeStackScreenProps<AppStackParams, "Diet">;

// Aviso de cuidado persistente e discreto (brief §7): plano não substitui profissional.
function SafetyNote() {
  return (
    <View style={styles.safety}>
      <Txt variant="caption" color={colors.text2}>
        Este plano é uma sugestão gerada por IA. Ele não substitui a orientação de um
        nutricionista ou médico.
      </Txt>
    </View>
  );
}

export function DietScreen({ route }: Props) {
  const { diet } = route.params;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Txt variant="metricLg" tabular>
          {diet.dailyCalories}
        </Txt>
        <Txt variant="label" color={colors.text2} style={{ marginTop: 4 }}>
          kcal por dia
        </Txt>
      </View>

      <View style={styles.macros}>
        <MetricTile value={`${diet.macros.proteinG}g`} label="Proteína" style={styles.macro} />
        <MetricTile value={`${diet.macros.carbsG}g`} label="Carbo" style={styles.macro} />
        <MetricTile value={`${diet.macros.fatG}g`} label="Gordura" style={styles.macro} />
      </View>

      {diet.meals.map((meal, i) => (
        <Card key={i} level={1}>
          <View style={styles.mealHeader}>
            <Txt variant="titleCard">{meal.name}</Txt>
            {meal.timeHint ? (
              <Txt variant="label" color={colors.text2}>
                {meal.timeHint}
              </Txt>
            ) : null}
          </View>
          <View style={styles.items}>
            {meal.items.map((item, j) => (
              <View key={j} style={[styles.item, j > 0 && styles.itemDivider]}>
                <Txt variant="body" style={{ flex: 1 }}>
                  {item.food}
                </Txt>
                <Txt variant="body" color={colors.text2} tabular>
                  {item.quantity}
                </Txt>
              </View>
            ))}
          </View>
        </Card>
      ))}

      {diet.notes ? (
        <Txt variant="body" color={colors.text2} style={styles.notes}>
          {diet.notes}
        </Txt>
      ) : null}

      <SafetyNote />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.gutter, gap: spacing.card },
  hero: {
    ...elevation.e2,
    borderRadius: radius.hero,
    padding: spacing.s20,
    alignItems: "center",
  },
  macros: { flexDirection: "row", gap: spacing.card },
  macro: { flex: 1 },
  mealHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  items: { marginTop: spacing.s12 },
  item: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.s8 },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  notes: { lineHeight: 22, marginTop: spacing.xs },
  safety: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
    padding: spacing.s12,
    marginTop: spacing.xs,
  },
});
