import React, { useEffect, useState } from "react";
import { View, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { Txt } from "./ui";
import { colors, radius, spacing, type as typeScale } from "../theme";

export interface Suggestion {
  id: string;
  label: string;
  sub?: string;
  data?: unknown;
}

/** Campo de texto com sugestões (autocomplete) buscadas de forma assíncrona. */
export function SuggestField({
  label,
  value,
  onChangeText,
  placeholder,
  fetchSuggestions,
  onPick,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  fetchSuggestions: (q: string) => Promise<Suggestion[]>;
  onPick: (s: Suggestion) => void;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  // Sem isto, esperar a busca é indistinguível de "não achou nada" — e a
  // pessoa desiste de digitar achando que o termo não existe.
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        setItems(await fetchSuggestions(value));
      } catch {
        setItems([]);
      } finally {
        setBuscando(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [value, open, fetchSuggestions]);

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? (
        <Txt variant="label" color={colors.text2} style={{ marginBottom: spacing.xs }}>
          {label}
        </Txt>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: open ? colors.lineStrong : colors.line,
          borderRadius: radius.chip,
          paddingHorizontal: spacing.md,
          paddingVertical: 12,
          color: colors.text,
          fontFamily: typeScale.body.fontFamily,
          fontSize: 16,
        }}
      />
      {open && buscando && items.length === 0 ? (
        <View
          style={{
            marginTop: 4,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}
        >
          <ActivityIndicator color={colors.text3} size="small" />
          <Txt variant="caption" color={colors.text3}>
            Procurando…
          </Txt>
        </View>
      ) : null}
      {open && items.length > 0 ? (
        <View
          style={{
            marginTop: 4,
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.chip,
            overflow: "hidden",
          }}
        >
          {items.slice(0, 8).map((s) => (
            <TouchableOpacity
              key={s.id}
              activeOpacity={0.7}
              onPress={() => {
                onPick(s);
                setOpen(false);
              }}
              style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.line }}
            >
              <Txt variant="bodyStrong">{s.label}</Txt>
              {s.sub ? (
                <Txt variant="caption" color={colors.text3}>
                  {s.sub}
                </Txt>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}
