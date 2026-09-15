// O set de ícones do RUMO.
//
// Até aqui o app não tinha ícone nenhum: nenhuma biblioteca instalada, e o que
// fazia as vezes de ícone era emoji e glifo Unicode dentro de <Text>. Isso tem
// três custos que só aparecem juntos: o emoji é desenhado pelo SISTEMA (então o
// app tem uma cara em cada aparelho e nenhuma delas é a nossa), não aceita a cor
// do esporte nem do tema, e não tem rótulo de acessibilidade.
//
// `docs/DESIGN.md` §2.8 já especificava o alvo e nunca tinha sido feito: traço
// de 1.75, cantos levemente arredondados, grade de 24, com um conjunto próprio
// para os esportes. Está aqui.
//
// Desenhado à mão em SVG em vez de instalar uma biblioteca: `react-native-svg`
// já está no bundle (os gráficos usam), então isto não acrescenta dependência
// nativa nenhuma — e um set próprio é a única forma de o app não ter os mesmos
// ícones dos outros vinte aplicativos de treino.
//
// Como acrescentar: um `d` na grade de 24, traçado (sem preenchimento), com as
// pontas onde o traço termina. Vários subcaminhos cabem no mesmo `d`.

import React from "react";
import Svg, { Path } from "react-native-svg";
import type { StyleProp, ViewStyle } from "react-native";
import { colors } from "../theme";

/**
 * Os caminhos, na grade de 24.
 *
 * Nomes em português, como o resto do código do app.
 */
const CAMINHOS = {
  // ---- navegação e estrutura
  casa: "M3.5 10.8 12 3.6l8.5 7.2 M5.9 9.3V19a1.4 1.4 0 0 0 1.4 1.4h9.4a1.4 1.4 0 0 0 1.4-1.4V9.3 M9.9 20.4v-5.1a2.1 2.1 0 0 1 4.2 0v5.1",
  grafico: "M4 3.6v15.2a1.6 1.6 0 0 0 1.6 1.6H20 M7.6 15.4l3.6-4.2 3 2.6 5-6.2",
  pessoas:
    "M15.6 20.4v-1.7a4 4 0 0 0-4-4H6.6a4 4 0 0 0-4 4v1.7 M12.2 7.3a3.1 3.1 0 1 1-6.2 0 3.1 3.1 0 0 1 6.2 0 M21.4 20.4v-1.7a4 4 0 0 0-3-3.9 M16.6 4.3a3.1 3.1 0 0 1 0 6",
  pessoa:
    "M19 20.4v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M15.6 6.4a3.6 3.6 0 1 1-7.2 0 3.6 3.6 0 0 1 7.2 0",
  mais: "M12 5v14 M5 12h14",
  menos: "M5 12h14",

  // ---- setas e direção
  chevronDireita: "m9.5 5.5 6.5 6.5-6.5 6.5",
  chevronEsquerda: "m14.5 5.5-6.5 6.5 6.5 6.5",
  chevronBaixo: "m5.5 9.5 6.5 6.5 6.5-6.5",
  chevronCima: "m5.5 14.5 6.5-6.5 6.5 6.5",
  setaCima: "M12 19.5V5 M5.5 11.5 12 5l6.5 6.5",
  setaBaixo: "M12 4.5V19 M18.5 12.5 12 19l-6.5-6.5",
  subindo: "m4.5 16.5 5.5-5.5 3.5 3.5 6-6 M19.5 8.5h-4 M19.5 8.5v4",
  descendo: "m4.5 7.5 5.5 5.5 3.5-3.5 6 6 M19.5 15.5h-4 M19.5 15.5v-4",

  // ---- ações
  fechar: "M6 6l12 12 M18 6 6 18",
  check: "m4.5 12.5 5 5 10-11",
  play: "M8 5.4v13.2l11-6.6z",
  lupa: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M20.6 20.6l-3.9-3.9",
  coracao:
    "M12 20.4S3.6 15.6 3.6 9.7a4.6 4.6 0 0 1 8.4-2.6 4.6 4.6 0 0 1 8.4 2.6c0 5.9-8.4 10.7-8.4 10.7Z",
  balao: "M20.4 11.6a7.4 7.4 0 0 1-8 7.4L4.6 20.4l1.4-3.2a7.4 7.4 0 1 1 14.4-5.6Z",
  camera:
    "M20.4 17.6a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V9.2a1.8 1.8 0 0 1 1.8-1.8h2.8l1.4-2.2h4.8l1.4 2.2h2.8a1.8 1.8 0 0 1 1.8 1.8v8.4Z M12 16a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z",

  // ---- estado e sistema
  sino: "M18 8.6a6 6 0 1 0-12 0c0 6-2.4 7.7-2.4 7.7h16.8S18 14.6 18 8.6 M13.7 19.6a2 2 0 0 1-3.4 0",
  cadeado:
    "M6.4 10.6h11.2a1.6 1.6 0 0 1 1.6 1.6v7a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6v-7a1.6 1.6 0 0 1 1.6-1.6Z M8.2 10.6V7.2a3.8 3.8 0 0 1 7.6 0v3.4",
  // Engrenagem de oito raios: geométrica de propósito, para não virar a roda
  // dentada genérica que todo mundo usa.
  engrenagem:
    "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M12 2.8v2.6 M12 18.6v2.6 M21.2 12h-2.6 M5.4 12H2.8 M18.5 5.5l-1.8 1.8 M7.3 16.7l-1.8 1.8 M18.5 18.5l-1.8-1.8 M7.3 7.3 5.5 5.5",
  escudo: "M12 20.8s7.2-3.2 7.2-8.8V6.4L12 3.6 4.8 6.4V12c0 5.6 7.2 8.8 7.2 8.8Z",
  gota: "M12 3.2 6.9 9.4a7 7 0 1 0 10.2 0L12 3.2Z",

  // ---- conquista e intensidade
  // A marca do coach e do recorde — era "✦" em seis lugares.
  faisca: "M12 5.2c1 4.8 2 5.8 6.8 6.8-4.8 1-5.8 2-6.8 6.8-1-4.8-2-5.8-6.8-6.8 4.8-1 5.8-2 6.8-6.8Z",
  chama:
    "M12 21.2c3.6 0 6.4-2.7 6.4-6.2 0-4.4-4.4-6.5-4.4-10.6-2 1.2-3.2 3.1-3.2 5.2 0 1.1-.9 1.9-1.9 1.4-.8-.4-1.2-1.3-1.2-2.2C6 10.2 5.6 12 5.6 15c0 3.5 2.8 6.2 6.4 6.2Z",
  raio: "M13.6 2.8 4.8 13.6h6.2l-.6 7.6 8.8-10.8h-6.2l.6-7.6Z",
  trofeu:
    "M7.6 4.4h8.8v5.2a4.4 4.4 0 0 1-8.8 0V4.4Z M7.6 6h-2a2 2 0 0 0 2 3.6 M16.4 6h2a2 2 0 0 1-2 3.6 M12 14v3.4 M8.6 20.4h6.8",
  alvo:
    "M12 20.8a8.8 8.8 0 1 0 0-17.6 8.8 8.8 0 0 0 0 17.6Z M12 16.4a4.4 4.4 0 1 0 0-8.8 4.4 4.4 0 0 0 0 8.8Z M12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z",
  bandeira: "M5.2 21V3.6 M5.2 4.4h9.6l-1.6 3.2 1.6 3.2H5.2",
  estrela: "m12 3.4 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6-4.4-4.3 6.1-.9L12 3.4Z",
  haltere: "M6.4 9.2v5.6 M3.6 10.4v3.2 M17.6 9.2v5.6 M20.4 10.4v3.2 M6.4 12h11.2",
} as const;

export type NomeDeIcone = keyof typeof CAMINHOS;

/** Desenhado quando o nome não existe — melhor que um buraco silencioso. */
const PADRAO = CAMINHOS.alvo;

/** Guarda para nome vindo da rede, que o TypeScript não valida sozinho. */
export function ehNomeDeIcone(nome: string): nome is NomeDeIcone {
  return Object.prototype.hasOwnProperty.call(CAMINHOS, nome);
}

export function Icon({
  name,
  size = 24,
  color = colors.text,
  /**
   * §2.8 pede 1.75 — mas 1.75 na grade de 24 vira 0,95px num ícone de 13, e
   * traço sub-pixel borra em tela 1x. Abaixo de 16 o piso sobe para 2, que a
   * essa altura ainda lê como o mesmo peso.
   */
  strokeWidth,
  /** Preenche em vez de traçar — para o coração curtido e o play. */
  preenchido,
  /**
   * O que um leitor de tela anuncia.
   *
   * Obrigatório em ícone que É o botão (§7 do brief: "rótulo de acessibilidade
   * em todo ícone-botão"). Ícone ao lado de um texto que já diz a mesma coisa
   * deve ficar SEM rótulo, senão o leitor fala tudo duas vezes.
   */
  accessibilityLabel,
  style,
}: {
  name: NomeDeIcone;
  size?: number;
  color?: string;
  strokeWidth?: number;
  preenchido?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      accessibilityRole={accessibilityLabel ? "image" : "none"}
      accessibilityLabel={accessibilityLabel}
    >
      <Path
        d={CAMINHOS[name] ?? PADRAO}
        stroke={color}
        strokeWidth={strokeWidth ?? (size < 16 ? 2 : 1.75)}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={preenchido ? color : "none"}
      />
    </Svg>
  );
}
