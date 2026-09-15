// Um ícone por esporte — o que torna o set do RUMO um set do RUMO.
//
// `docs/DESIGN.md` §2.8 é explícito: "não use halter genérico para tudo — luva
// de boxe, tênis de corrida, kimono, bicicleta, kettlebell". E §7 exige que cor
// de esporte venha SEMPRE acompanhada de ícone, porque cor sozinha não informa
// quem não distingue matiz. Até aqui o esporte aparecia como uma bolinha
// colorida — as duas regras quebradas no mesmo pixel.
//
// Os 21 ids estão em `api/src/services/sports.ts` e as cores em `theme.ts`. O
// NOME do ícone mora aqui, no app, e não no backend: assim acrescentar ou
// redesenhar um ícone não precisa de deploy de API.
//
// Mesma grade e mesmo traço do `Icon`: 24, 1.75, pontas arredondadas.

import React from "react";
import Svg, { Path } from "react-native-svg";
import type { StyleProp, ViewStyle } from "react-native";
import { sportColor } from "../theme";

const CAMINHOS: Record<string, string> = {
  // ---- força: o que muda entre elas é o implemento, não o boneco
  // Kettlebell: alça e sino.
  musculacao: "M8.6 9.8a3.4 3.4 0 0 1 6.8 0 M12 20.4a5.8 5.8 0 1 0 0-11.6 5.8 5.8 0 0 0 0 11.6Z",
  // Barra fixa com duas pegadas: peso do corpo, sem implemento.
  calistenia: "M3.6 6h16.8 M8.8 6v4.4 M15.2 6v4.4 M8.8 10.4a3.2 3.2 0 0 0 6.4 0",
  // Barra com anilhas grossas.
  powerlifting: "M2.8 12h18.4 M6.4 7.6v8.8 M17.6 7.6v8.8 M4.2 9.6v4.8 M19.8 9.6v4.8",
  // Barra acima da cabeça: o gesto que define o levantamento olímpico.
  lpo: "M3.6 4.8h16.8 M7 2.8v4 M17 2.8v4 M7.8 6.8 10.2 10.6 M16.2 6.8 13.8 10.6 M12 20.8V10.6",

  // ---- endurance
  // Tênis de corrida.
  corrida:
    "M3.2 17.2h14.2a3.4 3.4 0 0 0 3.4-3.4c0-1-.6-1.9-1.5-2.3l-5-2.2-2.4-3-3.3.9.4 2.6-5.8 2.2v5.2Z M3.2 14.4h4.4",
  // Montanha e trilha.
  trail: "M2.6 19.4h18.8 M4.2 19.4 9.6 8.6l3.2 5.8 M12.2 13.2 15 8.6l6.2 10.8",
  // Esteira: a lona e o console.
  esteira: "M3.2 16.8h12.8a3.2 3.2 0 1 0 0-6.4H6.4a3.2 3.2 0 0 0 0 6.4Z M20 5.6v13.6 M20 5.6h-3.2",
  // Figura caminhando.
  caminhada:
    "M13.6 5.2a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z M11.6 21.2l1.6-5.6-2.4-2.4.8-4.4 3.2 2 2.4.8 M10.8 8.8 8 10.8l-1.2 3.2 M13.2 15.6l2.8 5.6",
  // Bicicleta.
  ciclismo:
    "M5.6 19.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z M18.4 19.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z M5.6 16h5.2l4-7.2 M9.2 8.8h4.4 M14.8 8.8l3.6 7.2",
  // Braçada e água.
  natacao:
    "M17.4 6.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z M3.6 13.6l5-2.8 3.6 2.4 4-4.4 M2.6 18.6c1.8 0 1.8 1.6 3.6 1.6s1.8-1.6 3.6-1.6 1.8 1.6 3.6 1.6 1.8-1.6 3.6-1.6 1.8 1.6 3.6 1.6",
  // Ergômetro: a barra de puxada sobre a água.
  remo: "M2.8 19.4c2 0 2 1.6 4 1.6s2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 M4.4 12.4h15.2 M4.4 9.6v5.6 M19.8 9.6v5.6",

  // ---- wod
  // Caixa de salto e a subida.
  crossfit: "M3.6 20.4h16.8 M6.4 20.4v-5.6h11.2v5.6 M12 11.6V3.2 M8.4 6.8 12 3.2l3.6 3.6",
  // Cronômetro: no funcional/HIIT o que manda é o relógio.
  funcional:
    "M12 21.2a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M12 9.6v3.6h3 M9.6 2.4h4.8 M18.6 6.2 20.2 4.6",

  // ---- aulas e luta
  // Kimono: gola cruzada.
  jiu_jitsu:
    "M8.6 3.2 5 5.2l2 5.2v10h10v-10l2-5.2-3.4-2 M8.6 3.2 12 6.4l3.4-3.2 M12 6.4v14",
  // Chute de muay thai: perna erguida.
  muay_thai:
    "M9.2 5.6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M9.2 5.6v5.2 M9.2 8.6l5.6 2.2 4.4-2.4 M9.2 10.8 5.6 14l2 6.6 M11.6 12.2l3 8.4",
  // Luva de boxe.
  boxe: "M16.8 8.4a5.2 5.2 0 0 0-5.2-5.2H9.6A5.2 5.2 0 0 0 4.4 8.4v4.4c0 1.3.5 2.4 1.4 3.2v2.4c0 1 .8 1.8 1.8 1.8h6c1 0 1.8-.8 1.8-1.8V16c.9-.8 1.4-1.9 1.4-3.2V8.4Z M16.8 9.2h1.4a1.8 1.8 0 0 1 0 3.6h-1.4 M5.8 13.2h9.6",
  // Octógono.
  mma: "M8.4 3.2h7.2l5.2 5.2v7.2l-5.2 5.2H8.4l-5.2-5.2V8.4l5.2-5.2Z M8.4 3.2l7.2 17.6 M3.2 15.6l17.6-7.2",
  // Faixa com as pontas — a graduação é o dado do judô.
  judo: "M3.2 10.4h17.6v3.6H3.2Z M9.4 10.4V14 M14.6 10.4V14 M9.4 14 7 20.6 M14.6 14 17 20.6",
  // Postura de lótus.
  yoga:
    "M12 6.8a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z M12 7v5 M12 12 5.6 15.6a1.6 1.6 0 0 0 .8 3h11.2a1.6 1.6 0 0 0 .8-3L12 12Z M3.8 11.6l5.4 1.8 M20.2 11.6l-5.4 1.8",
  // Anel de pilates, com as duas pegadas.
  pilates:
    "M12 20.4a8.4 8.4 0 1 0 0-16.8 8.4 8.4 0 0 0 0 16.8Z M3.6 10h1.8v4H3.6 M20.4 10h-1.8v4h1.8",

  // Sem forma própria: três pontos, que é o que "outro" quer dizer.
  outro: "M6 12h.01 M12 12h.01 M18 12h.01",
};

/** Esporte sem ícone próprio cai aqui em vez de sumir da tela. */
const PADRAO = CAMINHOS.outro!;

export function SportIcon({
  sportId,
  size = 24,
  /** Sem cor, usa a cor do esporte — que é a regra do brief (§2.5). */
  color,
  strokeWidth,
  accessibilityLabel,
  style,
}: {
  sportId: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
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
        d={CAMINHOS[sportId] ?? PADRAO}
        stroke={color ?? sportColor(sportId)}
        strokeWidth={strokeWidth ?? (size < 16 ? 2 : 1.75)}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

