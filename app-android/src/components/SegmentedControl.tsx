// Controle segmentado — troca de sub-visões dentro de um hub (Progresso, Comunidade)
// sem virar telas novas. Pílulas de largura igual; o ativo ganha superfície + texto forte.
import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Txt } from "./ui";
import { Badge } from "./Badge";
import { colors, radius, spacing } from "../theme";

export interface Segment<T extends string> {
  key: T;
  label: string;
  /** Quantos itens novos há nessa sub-visão. 0 ou ausente não desenha nada. */
  badge?: number;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  style,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (key: T) => void;
  style?: object;
}) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          backgroundColor: colors.surface,
          borderRadius: radius.full,
          borderWidth: 1,
          borderColor: colors.line,
          padding: 3,
          gap: 3,
        },
        style,
      ]}
    >
      {segments.map((s) => {
        const active = s.key === value;
        return (
          <TouchableOpacity
            key={s.key}
            activeOpacity={0.8}
            onPress={() => onChange(s.key)}
            style={{
              flex: 1,
              flexDirection: "row",
              gap: spacing.xs,
              paddingVertical: 8,
              borderRadius: radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: active ? colors.surface3 : "transparent",
            }}
          >
            <Txt variant={active ? "bodyStrong" : "body"} color={active ? colors.text : colors.text2}>
              {s.label}
            </Txt>
            {/* O badge some do segmento aberto: o que você está olhando não
                precisa chamar sua atenção. */}
            {!active && <Badge valor={s.badge ?? 0} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
