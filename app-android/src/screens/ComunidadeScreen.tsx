// Hub Comunidade — social + competição no mesmo lugar mental (Feed / Desafios / Ranking).
// Não são telas novas: reusa as telas existentes com embedded, sob um header + segmented.
import React, { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Txt } from "../components/ui";
import { SegmentedControl, type Segment } from "../components/SegmentedControl";
import { FeedScreen } from "./FeedScreen";
import { DesafiosScreen } from "./DesafiosScreen";
import { LeaderboardScreen } from "./LeaderboardScreen";
import { colors, spacing } from "../theme";

type Seg = "feed" | "desafios" | "ranking";

const SEGMENTS: Segment<Seg>[] = [
  { key: "feed", label: "Feed" },
  { key: "desafios", label: "Desafios" },
  { key: "ranking", label: "Ranking" },
];

export function ComunidadeScreen() {
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<Seg>("feed");
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.gutter }}>
        <Txt variant="titleScreen">Comunidade</Txt>
        <SegmentedControl
          segments={SEGMENTS}
          value={seg}
          onChange={setSeg}
          style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}
        />
      </View>
      <View style={{ flex: 1 }}>
        {seg === "feed" && <FeedScreen embedded />}
        {seg === "desafios" && <DesafiosScreen embedded />}
        {seg === "ranking" && <LeaderboardScreen embedded />}
      </View>
    </View>
  );
}
