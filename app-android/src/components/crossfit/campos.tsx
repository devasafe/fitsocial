// Peças compartilhadas pelos editores de bloco.
//
// Registrar treino acontece no box, cansado, de celular na mão. Então: teclado
// numérico onde é número, campos curtos lado a lado em vez de empilhados, e
// nada obrigatório além do que define o bloco.
//
// "Lado a lado" vale enquanto couber. Abaixo de uma largura mínima a Linha
// quebra sozinha e os campos passam a empilhar — o que antes acontecia era o
// contrário: cada campo era espremido até o texto não caber, e no navegador a
// linha estourava para fora da tela, porque campo de texto não encolhe abaixo
// da largura que o conteúdo pede.

import React from "react";
import { View, TextInput, TouchableOpacity, type KeyboardTypeOptions } from "react-native";
import { Txt } from "../ui";
import { colors, radius, spacing } from "../../theme";
import { sugerir, type TipoDeSugestao } from "../../lib/sugestoes";

export const entradaBase = {
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.chip,
  paddingHorizontal: spacing.md,
  paddingVertical: 12,
  color: colors.text,
  fontSize: 16,
} as const;

/** Largura abaixo da qual não vale a pena espremer: a Linha quebra antes. */
const LARGURA_MINIMA = 128;

/** Campo com rótulo curto em cima. `flex` deixa colocar vários numa linha. */
export function Campo({
  rotulo,
  valor,
  aoMudar,
  placeholder,
  teclado = "default",
  flex = 1,
  autoFocus,
}: {
  rotulo?: string;
  valor: string;
  aoMudar: (t: string) => void;
  placeholder?: string;
  teclado?: KeyboardTypeOptions;
  flex?: number;
  autoFocus?: boolean;
}) {
  return (
    // flexGrow/Shrink/Basis explícitos em vez do atalho `flex`: o atalho já
    // define a base como 0, e depender da ordem em que as duas coisas são
    // aplicadas dá resultado diferente no nativo e no navegador.
    <View
      style={{
        flexGrow: flex,
        flexShrink: 1,
        flexBasis: LARGURA_MINIMA,
        minWidth: LARGURA_MINIMA,
      }}
    >
      {rotulo ? (
        <Txt variant="label" color={colors.text2} style={{ marginBottom: 4 }}>
          {rotulo}
        </Txt>
      ) : null}
      <TextInput
        value={valor}
        onChangeText={aoMudar}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType={teclado}
        autoFocus={autoFocus}
        style={entradaBase}
      />
    </View>
  );
}

/**
 * Campo que oferece de volta o que você já digitou.
 *
 * As sugestões só aparecem com o campo FOCADO e com algo digitado — uma lista
 * que abre sozinha ao tocar empurra o formulário inteiro para baixo e some com
 * o botão de salvar, que é onde a pessoa estava indo.
 *
 * Tocar numa sugestão preenche e fecha. Continuar digitando filtra.
 */
export function CampoComSugestoes({
  rotulo,
  valor,
  aoMudar,
  placeholder,
  tipo,
  flex = 1,
  autoFocus,
  aoSairDoCampo,
}: {
  rotulo?: string;
  valor: string;
  aoMudar: (t: string) => void;
  placeholder?: string;
  tipo: TipoDeSugestao;
  flex?: number;
  autoFocus?: boolean;
  /** Chamado quando o campo perde o foco. É o momento de agir sobre o valor
   *  inteiro — a cada tecla seria uma vez por letra digitada. */
  aoSairDoCampo?: () => void;
}) {
  const [focado, setFocado] = React.useState(false);
  const [lista, setLista] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!focado) return;
    let vivo = true;
    void sugerir(tipo, valor).then((s) => {
      if (vivo) setLista(s);
    });
    return () => {
      vivo = false;
    };
  }, [focado, valor, tipo]);

  const mostrar = focado && lista.length > 0;

  return (
    <View
      style={{
        flexGrow: flex,
        flexShrink: 1,
        flexBasis: LARGURA_MINIMA,
        minWidth: LARGURA_MINIMA,
      }}
    >
      {rotulo ? (
        <Txt variant="label" color={colors.text2} style={{ marginBottom: 4 }}>
          {rotulo}
        </Txt>
      ) : null}
      <TextInput
        value={valor}
        onChangeText={aoMudar}
        onFocus={() => setFocado(true)}
        // O atraso deixa o toque na sugestão acontecer antes de a lista sumir.
        onBlur={() => {
          setTimeout(() => setFocado(false), 150);
          aoSairDoCampo?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        autoFocus={autoFocus}
        style={entradaBase}
      />

      {mostrar ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: 6 }}>
          {lista.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => {
                aoMudar(s);
                setFocado(false);
                // A sugestão escolhida é um valor final: vale o mesmo que sair
                // do campo.
                aoSairDoCampo?.();
              }}
              activeOpacity={0.8}
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 6,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.surface,
              }}
            >
              <Txt variant="label" color={colors.text2}>
                {s}
              </Txt>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function Linha({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{children}</View>
  );
}

/** Botão de escolha única. Usado para formato, escala, tipo de resultado. */
export function Opcoes<T extends string>({
  valor,
  opcoes,
  aoEscolher,
}: {
  valor: T;
  opcoes: { id: T; label: string }[];
  aoEscolher: (id: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
      {opcoes.map((o) => {
        const ativo = o.id === valor;
        return (
          <TouchableOpacity
            key={o.id}
            onPress={() => aoEscolher(o.id)}
            activeOpacity={0.8}
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: 8,
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: ativo ? colors.lime : colors.line,
              backgroundColor: ativo ? "rgba(200,250,75,0.12)" : "transparent",
            }}
          >
            <Txt variant={ativo ? "bodyStrong" : "body"} color={ativo ? colors.lime : colors.text2}>
              {o.label}
            </Txt>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
      <Txt variant="label" color={colors.text2}>
        {titulo}
      </Txt>
      {children}
    </View>
  );
}

// ---- Conversões ----
//
// Tudo que a pessoa digita é texto; o modelo quer número ou nulo. Vazio vira
// nulo, nunca zero — "não preenchi" e "fiz zero" são coisas diferentes.

export function paraNumero(t: string): number | null {
  const v = t.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function paraInteiro(t: string): number | null {
  const n = paraNumero(t);
  return n == null ? null : Math.round(n);
}

/** Aceita "mm:ss" ou segundos puros. */
export function paraSegundos(t: string): number | null {
  const v = t.trim();
  if (!v) return null;
  if (v.includes(":")) {
    const [m, s] = v.split(":");
    const total = (Number(m) || 0) * 60 + (Number(s) || 0);
    return total > 0 ? total : null;
  }
  return paraInteiro(v);
}

export function mmss(sec?: number | null): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "21-15-9" → [21, 15, 9]. Também aceita vírgula e espaço. */
export function paraRepScheme(t: string): number[] | null {
  const nums = t
    .split(/[^0-9]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length > 1 ? nums : null;
}

export function repSchemeParaTexto(scheme?: number[] | null): string {
  return scheme?.length ? scheme.join("-") : "";
}
