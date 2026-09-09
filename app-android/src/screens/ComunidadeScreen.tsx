// Hub Comunidade — social + competição no mesmo lugar mental (Feed / Desafios / Ranking).
// Não são telas novas: reusa as telas existentes com embedded, sob um header + segmented.
import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Txt } from "../components/ui";
import { SegmentedControl, type Segment } from "../components/SegmentedControl";
import { FeedScreen } from "./FeedScreen";
import { DesafiosScreen } from "./DesafiosScreen";
import { LeaderboardScreen } from "./LeaderboardScreen";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

type Seg = "seguindo" | "explorar" | "desafios" | "ranking";

const SEGMENTS: Segment<Seg>[] = [
  { key: "seguindo", label: "Seguindo" },
  { key: "explorar", label: "Explorar" },
  { key: "desafios", label: "Desafios" },
  { key: "ranking", label: "Ranking" },
];

export function ComunidadeScreen() {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const [seg, setSeg] = useState<Seg>("seguindo");
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.gutter }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Txt variant="titleScreen">Comunidade</Txt>
          <TouchableOpacity onPress={() => nav.navigate("BuscarPessoas")} activeOpacity={0.7} hitSlop={8}>
            <Txt variant="titleCard">🔍</Txt>
          </TouchableOpacity>
        </View>
        <SegmentedControl
          segments={SEGMENTS}
          value={seg}
          onChange={setSeg}
          style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}
        />
      </View>
      <View style={{ flex: 1 }}>
        {seg === "seguindo" && <FeedScreen embedded mode="following" />}
        {seg === "explorar" && <FeedScreen embedded mode="explore" />}
        {seg === "desafios" && <DesafiosScreen embedded />}
        {seg === "ranking" && <LeaderboardScreen embedded />}
      </View>
    </View>
  );
}
