import React from "react";
import {
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  View,
  ScrollView,
  type TextProps,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  radius,
  spacing,
  type as typeScale,
  elevation,
  sportColor,
  type TypeVariant,
} from "../theme";

// ---- Tipografia ----

export function Txt({
  variant = "body",
  color,
  tabular,
  style,
  ...rest
}: TextProps & { variant?: TypeVariant; color?: string; tabular?: boolean }) {
  return (
    <Text
      {...rest}
      style={[
        typeScale[variant],
        { color: color ?? colors.text },
        tabular && { fontVariant: ["tabular-nums"] },
        style,
      ]}
    />
  );
}

// ---- Botão ----

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
type BtnSize = "sm" | "md" | "lg";

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  glow,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: BtnVariant;
  size?: BtnSize;
  loading?: boolean;
  disabled?: boolean;
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const pad = size === "lg" ? spacing.md : size === "sm" ? spacing.sm : 12;
  const bg =
    variant === "primary" ? colors.lime : variant === "danger" ? colors.danger : "transparent";
  const fg =
    variant === "primary"
      ? colors.onLime
      : variant === "danger"
        ? colors.text
        : variant === "ghost"
          ? colors.text2
          : colors.text;
  const border = variant === "secondary" ? colors.lineStrong : "transparent";

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={off}
      activeOpacity={0.85}
      style={[
        {
          backgroundColor: bg,
          borderColor: border,
          borderWidth: variant === "secondary" ? 1 : 0,
          borderRadius: radius.chip,
          paddingVertical: pad,
          paddingHorizontal: spacing.md,
          alignItems: "center",
          justifyContent: "center",
        },
        glow && {
          shadowColor: colors.lime,
          shadowOpacity: 0.24,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        },
        off && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[typeScale.bodyStrong, { color: fg }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

/** Compat: telas antigas ainda importam PrimaryButton. */
export function PrimaryButton(props: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return <Button {...props} variant="primary" size="lg" />;
}

// ---- Campo de texto ----

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? (
        <Text style={[typeScale.label, { color: colors.text2, marginBottom: spacing.xs }]}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.text3}
        style={[
          {
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.chip,
            paddingHorizontal: spacing.md,
            paddingVertical: 12,
            color: colors.text,
            fontFamily: typeScale.body.fontFamily,
            fontSize: 16,
          },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

// ---- Superfícies ----

export function Card({
  children,
  level = 1,
  sport,
  style,
}: {
  children: React.ReactNode;
  level?: 1 | 2 | 3;
  sport?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const base = level === 3 ? elevation.e3 : level === 2 ? elevation.e2 : elevation.e1;
  return (
    <View
      style={[
        { borderRadius: radius.card, padding: spacing.md },
        base,
        sport ? { borderLeftWidth: 3, borderLeftColor: sportColor(sport) } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Screen({
  children,
  scroll,
  underHeader,
  style,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  /** Quando a tela tem header nativo do stack, o header já consome o safe-area
   *  top — passe true para não somar insets.top de novo (evita espaço dobrado). */
  underHeader?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const topInset = underHeader ? 0 : insets.top;
  const pad = { paddingTop: topInset, paddingBottom: insets.bottom };
  if (scroll) {
    return (
      <ScrollView
        style={[{ flex: 1, backgroundColor: colors.bg }, style]}
        contentContainerStyle={[
          { paddingHorizontal: spacing.gutter, paddingTop: topInset + spacing.md, paddingBottom: insets.bottom + spacing.xl },
          contentStyle,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[{ flex: 1, backgroundColor: colors.bg }, pad, style]}>{children}</View>;
}

// ---- Estado de erro (load falhou) ----

export function ErrorState({
  message = "Não foi possível carregar.",
  onRetry,
  style,
}: {
  message?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card level={2} style={[{ marginTop: spacing.md }, style]}>
      <Txt variant="titleCard">Deu ruim aqui</Txt>
      <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm, marginBottom: onRetry ? spacing.md : 0 }}>
        {message}
      </Txt>
      {onRetry ? <Button title="Tentar de novo" variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

// ---- Dados ----

export function MetricTile({
  value,
  label,
  delta,
  sport,
  style,
}: {
  value: string;
  label: string;
  delta?: { value: string; positive?: boolean };
  sport?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[{ borderRadius: radius.hero, padding: spacing.md }, elevation.e2, style]}
    >
      <Txt variant="metricMd" tabular color={sport ? sportColor(sport) : colors.text}>
        {value}
      </Txt>
      <Txt variant="label" color={colors.text2} style={{ marginTop: 2 }}>
        {label}
      </Txt>
      {delta ? (
        <Txt variant="caption" color={delta.positive ? colors.lime : colors.text3}>
          {delta.positive ? "▲" : "▼"} {delta.value}
        </Txt>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  sport,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  sport?: string;
}) {
  const dot = sport ? sportColor(sport) : colors.lime;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: radius.chip,
        borderWidth: 1,
        borderColor: active ? colors.lime : colors.line,
        backgroundColor: active ? "rgba(200,250,75,0.12)" : colors.surface,
      }}
    >
      {sport ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      <Text style={[typeScale.label, { color: active ? colors.text : colors.text2 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: spacing.md,
      }}
    >
      <Txt variant="titleSection">{title}</Txt>
      {action ? (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7}>
          <Txt variant="label" color={colors.lime}>
            {action}
          </Txt>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const _styles = StyleSheet.create({ _noop: {} });
export { _styles };
