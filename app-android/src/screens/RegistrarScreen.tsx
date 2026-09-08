import React, { useEffect, useState } from "react";
import { View, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen } from "../components/ui";
import { listSports, type Sport } from "../api/sports";
import { colors, spacing, radius, sportColor } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function RegistrarScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSports(token!)
      .then(setSports)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  function pick(s: Sport) {
    switch (s.kind) {
      case "strength":
        nav.navigate("RegisterActivity", { sportId: s.id });
        break;
      case "endurance":
        nav.navigate("RegisterEndurance", { sportId: s.id });
        break;
      case "class":
        nav.navigate("RegisterClass", { sportId: s.id });
        break;
      case "generic":
        nav.navigate("RegisterGeneric", { sportId: s.id });
        break;
      case "wod":
        nav.navigate("RegisterWod", { sportId: s.id });
        break;
      default:
        Alert.alert("Em breve", `O registro de ${s.label} chega numa próxima atualização.`);
    }
  }

  return (
    <Screen scroll>
      <Txt variant="titleScreen" style={{ marginBottom: spacing.xs }}>
        Registrar
      </Txt>
      <Txt variant="body" color={colors.text2} style={{ marginBottom: spacing.section }}>
        Escolha o esporte que você treinou.
      </Txt>

      {loading ? (
        <ActivityIndicator color={colors.lime} />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.card }}>
          {sports.map((s) => (
            <TouchableOpacity
              key={s.id}
              onPress={() => pick(s)}
              activeOpacity={0.85}
              style={{
                width: "31%",
                aspectRatio: 1,
                borderRadius: radius.card,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                alignItems: "center",
                justifyContent: "center",
                padding: spacing.sm,
                gap: 8,
              }}
            >
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: sportColor(s.id) }} />
              <Txt variant="label" color={colors.text} style={{ textAlign: "center" }}>
                {s.label}
              </Txt>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        onPress={() => nav.navigate("CreatePost")}
        activeOpacity={0.8}
        style={{
          marginTop: spacing.section,
          paddingVertical: spacing.md,
          alignItems: "center",
          borderRadius: radius.chip,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Txt variant="bodyStrong" color={colors.text2}>
          Só uma foto (post sem treino)
        </Txt>
      </TouchableOpacity>
    </Screen>
  );
}
