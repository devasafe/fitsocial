// Design system do app — ver docs/DESIGN.md.
// Base: verde-tinta terroso + texto osso quente. O verde da marca é só o
// sistema; o conteúdo é colorido pelo esporte. Chaves antigas
// (bg/surface/primary…) foram remapeadas, então todas as telas herdam a paleta.

/**
 * O verde da marca, num lugar só.
 *
 * Existe como constante porque o anterior NÃO existia: `rgba(200,250,75,…)`
 * estava cravado em sete arquivos — chip ativo, linha selecionada, notificação
 * não lida, cursor do gráfico — e nenhum deles acompanhou a troca de cor. O
 * app ficou com a marca verde e os realces ainda em lima.
 */
const VERDE = "#3BCC06";

/** O verde com transparência, derivado do hex acima. */
function comAlfa(hex: string, alfa: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

export const colors = {
  // Superfícies (verde-tinta, passo de matiz além de luminosidade)
  bg: "#0E1310",
  surface: "#161C18",
  surface2: "#1E2620",
  surface3: "#273029",
  surfaceAlt: "#1E2620", // alias legado → surface2
  line: "#2A332C",
  lineStrong: "#3A453C",
  border: "#2A332C", // alias legado → line

  // Texto (osso quente, não cinza frio)
  text: "#EDEBE1",
  text2: "#A8AC9E",
  text3: "#6E7469",
  textMuted: "#A8AC9E", // alias legado → text2
  textDisabled: "#4A5049",

  // Marca
  //
  // Os nomes ainda dizem "lime" porque estão em 140 lugares e renomear é outra
  // mudança. A cor não é mais lima.
  lime: VERDE,
  /** Pressionado. Tem que ser MAIS ESCURO que a marca — o valor anterior
   *  (#9FCC33, 9,97:1) brilhava mais que ela (8,78:1). */
  limeDim: "#2E9E05",
  onLime: "#0E1310",
  primary: VERDE, // alias legado
  primaryText: "#0E1310", // alias legado

  /** Fundo de chip ativo, linha selecionada, realce de linha. */
  limeSoft: comAlfa(VERDE, 0.12),
  /** Mais tênue ainda: notificação não lida, cursor de gráfico. */
  limeFaint: comAlfa(VERDE, 0.06),
  /** Fundo sólido de seleção e de badge, quando alfa não serve. */
  limeDeep: "#1F5C08",
  /**
   * Verde claro, para cima do FUNDO ESCURO — anel de foco, ícone sobre
   * superfície. Não serve como texto sobre o verde da marca: ali dá 1,38:1.
   * Sobre o verde, o texto é `onLime`, que dá 8,78:1.
   */
  limeBright: "#7CE84F",

  // Semântica (o positivo já é o verde da marca)
  warning: "#F5C63C",
  danger: "#F2634B",
  info: "#7FB2E5",
} as const;

// Cor fixa por esporte (ícone, borda esquerda do cartão, ponto do gráfico, chip).
// Nunca como fundo de área grande. Espelha docs/ESPORTES.md §2 / brief §2.5.
export const sportColors: Record<string, string> = {
  musculacao: "#C8FA4B",
  calistenia: "#B4E63F",
  powerlifting: "#8FBF42",
  lpo: "#A8D42E",
  corrida: "#FF8A4C",
  trail: "#E06A2C",
  esteira: "#FFA06B",
  caminhada: "#96A39A",
  ciclismo: "#4C9AFF",
  natacao: "#2FD4D4",
  remo: "#3AA8C4",
  crossfit: "#F5C63C",
  funcional: "#4FD69C",
  jiu_jitsu: "#9B7CF0",
  muay_thai: "#F27299",
  boxe: "#EF5350",
  mma: "#D96FE0",
  judo: "#7C9BF0",
  yoga: "#DCC4A0",
  pilates: "#C9B08A",
  outro: "#7A8079",
};

export function sportColor(id?: string): string {
  return (id && sportColors[id]) || colors.text2;
}

// Rampa térmica: codifica quantidade (volume, consistência, esforço), não decora.
/**
 * Rampa térmica: codifica quantidade, não decora.
 *
 * Reancorada no verde novo. A anterior terminava no lima — que era a marca — e
 * ficou órfã quando a marca mudou. Agora o meio da rampa É a marca.
 *
 * Duas regras, e a segunda é o que quase me fez errar:
 *
 *  - Do "nada" ao "máximo" a LUMINÂNCIA sobe a cada passo (0,03 → 0,15 → 0,44
 *    → 0,54 → 0,60). Sem isso a ordem some para quem não distingue matiz, e um
 *    gráfico de volume deixa de informar. Luminância de verdade, não a
 *    luminosidade do HSL — pelo HSL o passo "forte" parecia caber e era o mais
 *    claro da rampa inteira.
 *  - O "excesso" QUEBRA a subida de propósito (0,32). Ele não é mais
 *    quantidade: é alerta, e fala por matiz. Era assim antes desta mudança e
 *    continua sendo.
 */
export const thermal = ["#2A332C", "#2E7A0C", VERDE, "#9AD41C", "#F5C63C", "#F2734B"] as const;

// Grade de 4. Gutter lateral 20, entre cartões 12, entre seções 32.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  s4: 4,
  s8: 8,
  s12: 12,
  s16: 16,
  s20: 20,
  s24: 24,
  s32: 32,
  s40: 40,
  s56: 56,
  s72: 72,
  gutter: 20,
  card: 12,
  section: 32,
} as const;

// Raio por hierarquia — não use o mesmo em tudo.
export const radius = {
  chip: 10,
  card: 14,
  hero: 20,
  sheet: 24,
  media: 12,
  full: 999,
  sm: 8, // legado
  md: 12, // legado
  lg: 20, // legado
} as const;

// Fontes (Google Fonts). Brief pede Archivo Expanded; usamos o par alternativo
// que ele autoriza: Sora (display/números) + Archivo (interface/corpo).
export const fonts = {
  displayXBold: "Sora_800ExtraBold",
  displayBold: "Sora_700Bold",
  displaySemi: "Sora_600SemiBold",
  bodyRegular: "Archivo_400Regular",
  bodyMedium: "Archivo_500Medium",
  bodySemi: "Archivo_600SemiBold",
  bodyBold: "Archivo_700Bold",
} as const;

// Escala tipográfica (px absolutos; letterSpacing em px ≈ % do brief).
export const type = {
  metricHero: { fontFamily: fonts.displayXBold, fontSize: 56, lineHeight: 56, letterSpacing: -1.1 },
  metricLg: { fontFamily: fonts.displayBold, fontSize: 40, lineHeight: 42, letterSpacing: -0.6 },
  metricMd: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 30, letterSpacing: -0.3 },
  titleScreen: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 30, letterSpacing: -0.24 },
  titleSection: { fontFamily: fonts.bodySemi, fontSize: 18, lineHeight: 24 },
  titleCard: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.bodyRegular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.bodyRegular, fontSize: 12, lineHeight: 16 },
} as const;

export type TypeVariant = keyof typeof type;

// Elevação em fundo escuro: degrau de superfície + borda 1px, sem sombra difusa.
export const elevation = {
  e1: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  e2: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line },
  e3: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

// Durações de movimento (ms). Movimento responde a ação; nada anima só ao carregar.
export const motion = { micro: 120, base: 200, sheet: 320, celebration: 700 } as const;
