import sharp from "sharp";
import { env } from "../../config/env.js";
import { textoEmVetor, encurtar, larguraDoTexto } from "./tipografia.js";

/* O cartão que a pessoa manda para o Instagram.
 *
 * Montado no servidor, e não no app, por dois motivos: o mesmo desenho vale
 * para Android e navegador, e mudar o layout depois não obriga ninguém a
 * atualizar o aplicativo.
 *
 * A foto é dela; o cartão só acrescenta o que o app sabe e o Instagram não —
 * qual treino foi, quais movimentos, e os números. A marca fica discreta: quem
 * posta é a pessoa, não o app.
 *
 * Quatro layouts, porque são quatro situações diferentes, não quatro enfeites:
 * foto boa pede a foto inteira; foto poluída pede o texto fora dela; treino
 * sem foto pede tipografia. Ver LAYOUTS.
 */

export type Formato = "story" | "feed";

export const LAYOUTS = [
  /** A foto ocupa tudo, o texto vive sobre ela. Para foto bonita. */
  "foto",
  /** Foto em cima, ficha do treino embaixo. Para foto poluída e treino longo. */
  "ficha",
  /** Um cartão flutua sobre a foto. Meio-termo: a foto respira, o texto agrupa. */
  "cartao",
  /** Só tipografia. Para quando o treino é o assunto, e não a foto. */
  "numeros",
] as const;
export type Layout = (typeof LAYOUTS)[number];

const TAMANHOS: Record<Formato, { largura: number; altura: number }> = {
  // 9:16 e 4:5 — os formatos que o Instagram aceita sem recortar.
  story: { largura: 1080, altura: 1920 },
  feed: { largura: 1080, altura: 1350 },
};

const CORES = {
  fundo: "#0E1310",
  superficie: "#1E2620",
  linha: "#3A453C",
  texto: "#EDEBE1",
  texto2: "#A8AC9E",
  texto3: "#6E7469",
  lime: "#3BCC06",
};

export interface DadosDoCartao {
  /** Foto do post. Sem ela, o cartão cai para o layout tipográfico. */
  foto?: Buffer | null;
  titulo: string;
  /**
   * Já formatados pelo servidor: ["5,2 km", "27:30", "5:18 /km"].
   * O primeiro é o resultado — é ele que vira o número grande.
   */
  stats: string[];
  /** Os exercícios: ["21-15-9 Thruster 43 kg", "Pull Up"]. */
  movimentos?: string[];
  /** Cor do esporte, a mesma que o app usa na borda do card. */
  cor: string;
  /** Traçado do percurso, quando houver GPS. */
  percurso?: { lat: number; lng: number }[] | null;
  autor: string;
  /**
   * "NOVO RECORDE · SUPINO RETO", quando o treino bateu um.
   *
   * Vem pronto do servidor, como os stats: o cartão desenha, não decide. É a
   * única coisa aqui que não descreve o treino e sim o que ele significou —
   * por isso ganha destaque proprio, acima do titulo.
   */
  selo?: string | null;
}

/** Escapa o que vai para dentro do SVG. O título vem do usuário. */
function escapar(t: string): string {
  return t.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Projeta o percurso numa caixa, achatado por latitude.
 *
 * Sem o cosseno da latitude, um percurso reto no mapa sai torto no desenho:
 * um grau de longitude vale menos quilômetros conforme se afasta do equador.
 */
function tracarPercurso(
  pontos: { lat: number; lng: number }[],
  caixa: { x: number; y: number; largura: number; altura: number },
  cor = CORES.lime,
  espessura = 7
): string {
  if (pontos.length < 2) return "";

  const latMedia = (pontos.reduce((s, p) => s + p.lat, 0) / pontos.length) * (Math.PI / 180);
  const escalaX = Math.cos(latMedia);

  const xs = pontos.map((p) => p.lng * escalaX);
  const ys = pontos.map((p) => -p.lat); // norte para cima

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const larguraReal = maxX - minX || 1e-9;
  const alturaReal = maxY - minY || 1e-9;
  // Uma escala só nos dois eixos: esticar deformaria o traçado.
  const escala = Math.min(caixa.largura / larguraReal, caixa.altura / alturaReal);

  const sobraX = (caixa.largura - larguraReal * escala) / 2;
  const sobraY = (caixa.altura - alturaReal * escala) / 2;

  const d = pontos
    .map((_, i) => {
      const x = caixa.x + sobraX + (xs[i] - minX) * escala;
      const y = caixa.y + sobraY + (ys[i] - minY) * escala;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return `<path d="${d}" fill="none" stroke="${cor}" stroke-width="${espessura}" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;
}

/** Um percurso de uma hora tem milhares de pontos; o traço não ganha nada
 *  com mais de umas centenas. */
function afinar<T>(pontos: T[], maximo = 300): T[] {
  if (pontos.length <= maximo) return pontos;
  const passo = pontos.length / maximo;
  const out: T[] = [];
  for (let i = 0; i < maximo; i++) out.push(pontos[Math.floor(i * passo)]);
  out.push(pontos[pontos.length - 1]);
  return out;
}

/** Encolhe o texto até caber na largura pedida. */
function tamanhoQueCabe(
  texto: string,
  fonte: Parameters<typeof larguraDoTexto>[1],
  inicial: number,
  limite: number,
  minimo = 28
): number {
  let t = inicial;
  while (t > minimo && larguraDoTexto(texto, fonte, t) > limite) t -= 2;
  return t;
}

/* ---------------------------------------------------------------------------
 * Pilha de conteúdo
 *
 * A primeira versão calculava cada posição na mão, somando constantes
 * escolhidas no olho. O resultado: a linha divisória cortava o "7 + 1" ao meio
 * e sobravam 300px de vazio embaixo. Espaçamento arbitrário sempre colide em
 * ALGUM conteúdo — e o conteúdo aqui varia: título curto ou longo, dois
 * movimentos ou dez.
 *
 * Aqui cada peça declara a própria altura. A pilha mede o conjunto ANTES de
 * desenhar, então dá para ancorar em cima, embaixo ou no meio sem adivinhar, e
 * colisão deixa de ser possível por construção.
 * ------------------------------------------------------------------------- */

interface Peca {
  /** Altura que a peça ocupa, incluindo o respiro depois dela. */
  altura: number;
  /** `topo` é onde a peça começa; quem desenha decide a linha de base. */
  desenhar(topo: number): string;
}

function medir(pecas: Peca[]): number {
  return pecas.reduce((t, p) => t + p.altura, 0);
}

function empilhar(pecas: Peca[], inicio: number): string {
  let y = inicio;
  const out: string[] = [];
  for (const p of pecas) {
    out.push(p.desenhar(y));
    y += p.altura;
  }
  return out.join("");
}

type Fonte = Parameters<typeof larguraDoTexto>[1];

/** Uma linha de texto. `gap` é o respiro DEPOIS dela. */
function linha(opts: {
  texto: string;
  fonte: Fonte;
  tamanho: number;
  cor: string;
  x: number;
  gap: number;
  /** Bolinha na cor do esporte, à esquerda. */
  ponto?: string;
  /** Barra vertical na cor do esporte, à esquerda. */
  barra?: string;
}): Peca {
  const recuo = opts.ponto ? 42 : opts.barra ? 34 : 0;
  return {
    // A linha de base fica a ~0,78 da altura da caixa: é onde a maiúscula
    // assenta nestas fontes.
    altura: opts.tamanho * 1.02 + opts.gap,
    desenhar(topo) {
      const base = topo + opts.tamanho * 0.78;
      const enfeite = opts.ponto
        ? `<circle cx="${opts.x + 11}" cy="${base - opts.tamanho * 0.26}" r="11" fill="${opts.ponto}"/>`
        : opts.barra
          ? `<rect x="${opts.x}" y="${topo}" width="7" height="${opts.tamanho}" rx="3.5" fill="${opts.barra}"/>`
          : "";
      return (
        enfeite +
        textoEmVetor(opts.texto, {
          x: opts.x + recuo,
          y: base,
          fonte: opts.fonte,
          tamanho: opts.tamanho,
          cor: opts.cor,
        })
      );
    },
  };
}

/** O número grande, com os secundários deitados ao lado, na mesma base. */
function resultado(opts: {
  principal: string;
  secundarios: string[];
  x: number;
  largura: number;
  tamanho: number;
  cor: string;
  gap: number;
}): Peca {
  const t = tamanhoQueCabe(opts.principal, "displayForte", opts.tamanho, opts.largura * 0.62, 56);
  const tSec = Math.max(28, Math.round(t * 0.33));
  const secundarios = opts.secundarios.slice(0, 2);

  const respiro = Math.max(30, Math.round(t * 0.16));
  const entreSec = Math.round(respiro * 0.8);
  const larguraDosSec = secundarios.reduce(
    (soma, sec, i) => soma + larguraDoTexto(sec, "display", tSec) + (i ? entreSec : 0),
    0
  );
  // Ou todos na mesma linha do número, ou todos na linha de baixo. Cortar "no
  // que couber" some com o pace sem avisar — e o pace é metade do post.
  const naMesmaLinha =
    larguraDoTexto(opts.principal, "displayForte", t) + respiro + larguraDosSec <= opts.largura;
  const alturaDaSegundaLinha = naMesmaLinha || !secundarios.length ? 0 : Math.round(tSec * 1.45);

  return {
    altura: t * 1.02 + alturaDaSegundaLinha + opts.gap,
    desenhar(topo) {
      const base = topo + t * 0.78;
      const out = [
        textoEmVetor(opts.principal, {
          x: opts.x,
          y: base,
          fonte: "displayForte",
          tamanho: t,
          cor: opts.cor,
        }),
      ];

      let x = naMesmaLinha
        ? opts.x + larguraDoTexto(opts.principal, "displayForte", t) + respiro
        : opts.x;
      const baseSec = naMesmaLinha ? base : base + alturaDaSegundaLinha;
      for (const sec of secundarios) {
        out.push(
          textoEmVetor(sec, { x, y: baseSec, fonte: "display", tamanho: tSec, cor: CORES.texto2 })
        );
        x += larguraDoTexto(sec, "display", tSec) + entreSec;
      }
      return out.join("");
    },
  };
}

/** O percurso como peça da pilha.
 *
 *  Posicionado à mão ele atravessava o "5:18 /km" na ficha e simplesmente não
 *  existia no cartão. Como peça, ele reserva o próprio espaço. */
function tracado(opts: {
  pontos: { lat: number; lng: number }[];
  x: number;
  largura: number;
  altura: number;
  cor: string;
  espessura?: number;
  gap: number;
}): Peca {
  return {
    altura: opts.altura + opts.gap,
    desenhar: (topo) =>
      tracarPercurso(
        afinar(opts.pontos),
        { x: opts.x, y: topo, largura: opts.largura, altura: opts.altura },
        opts.cor,
        opts.espessura ?? 7
      ),
  };
}

/** Os exercícios, um por linha. É o que faltava no cartão. */
function movimentos(opts: {
  itens: string[];
  x: number;
  largura: number;
  tamanho: number;
  cor: string;
  maximo: number;
  gap: number;
}): Peca {
  const mostrados = opts.itens.slice(0, opts.maximo);
  const sobra = opts.itens.length - mostrados.length;
  const linhas = mostrados.length + (sobra > 0 ? 1 : 0);
  const passo = Math.round(opts.tamanho * 1.5);

  return {
    altura: linhas * passo + opts.gap,
    desenhar(topo) {
      const out = mostrados.map((m, i) =>
        textoEmVetor(encurtar(escapar(m), "corpo", opts.tamanho, opts.largura), {
          x: opts.x,
          y: topo + opts.tamanho * 0.78 + i * passo,
          fonte: "corpo",
          tamanho: opts.tamanho,
          cor: opts.cor,
        })
      );
      if (sobra > 0) {
        out.push(
          textoEmVetor(`e mais ${sobra}`, {
            x: opts.x,
            y: topo + opts.tamanho * 0.78 + mostrados.length * passo,
            fonte: "corpo",
            tamanho: opts.tamanho,
            cor: CORES.texto3,
          })
        );
      }
      return out.join("");
    },
  };
}

/** Um fio horizontal separando seções. */
function fio(x: number, largura: number, gap: number): Peca {
  return {
    altura: 1 + gap,
    desenhar: (topo) =>
      `<rect x="${x}" y="${topo}" width="${largura}" height="1" fill="${CORES.linha}"/>`,
  };
}

/** A marca, sempre do mesmo jeito e sempre discreta. */
/**
 * A pílula de recorde. Fundo cheio na cor da marca, texto escuro em cima.
 *
 * Sólida, e não contornada, de propósito: é o único elemento do cartão que
 * anuncia uma conquista, e ele precisa ganhar da foto por baixo em qualquer
 * foto. O texto escuro sobre o verde dá 8,78:1 — o verde sobre escuro daria
 * 1,38:1 e sumiria (`app-android/src/theme.ts`).
 */
function selo(opts: { texto: string; x: number; gap: number; tamanho: number }): Peca {
  const altura = opts.tamanho * 2.1;
  const respiro = opts.tamanho * 0.9;
  const largura = larguraDoTexto(opts.texto, "corpoForte", opts.tamanho) + respiro * 2;
  return {
    altura: altura + opts.gap,
    desenhar(topo) {
      return (
        `<rect x="${opts.x}" y="${topo}" width="${largura}" height="${altura}" rx="${altura / 2}" fill="${CORES.lime}"/>` +
        textoEmVetor(opts.texto, {
          x: opts.x + respiro,
          y: topo + altura * 0.68,
          fonte: "corpoForte",
          tamanho: opts.tamanho,
          cor: CORES.fundo,
        })
      );
    },
  };
}

function marca(x: number, base: number, tamanho: number, cor = CORES.lime): string {
  return textoEmVetor(escapar(env.appName), {
    x,
    y: base,
    fonte: "corpoForte",
    tamanho,
    cor,
    opacidade: 0.92,
  });
}

async function fundoComFoto(foto: Buffer, largura: number, altura: number): Promise<Buffer> {
  // `attention` recorta pela região mais interessante em vez do centro cego —
  // numa foto de corpo inteiro, o centro geométrico costuma ser o umbigo.
  return sharp(foto).resize(largura, altura, { fit: "cover", position: "attention" }).toBuffer();
}

async function fundoLiso(largura: number, altura: number): Promise<Buffer> {
  return sharp({ create: { width: largura, height: altura, channels: 3, background: CORES.fundo } })
    .png()
    .toBuffer();
}

/** Foto em cima, painel liso embaixo. */
async function fundoDividido(foto: Buffer, largura: number, altura: number, corte: number) {
  const recortada = await sharp(foto)
    .resize(largura, corte, { fit: "cover", position: "attention" })
    .toBuffer();

  return sharp({ create: { width: largura, height: altura, channels: 3, background: CORES.fundo } })
    .composite([{ input: recortada, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

const CORTE_DA_FICHA = 0.54;

/**
 * O layout que de fato vai ser desenhado.
 *
 * Sem foto não há o que sobrepor, então qualquer escolha vira o tipográfico.
 * Exposto porque quem chama precisa dizer ao app o que ele recebeu — senão a
 * prévia mostra "cartão" selecionado e entrega outra coisa.
 */
export function layoutEfetivo(layout: Layout, temFoto: boolean): Layout {
  return temFoto ? layout : "numeros";
}

export async function montarCartao(
  dados: DadosDoCartao,
  formato: Formato,
  layout: Layout = "foto"
): Promise<Buffer> {
  const { largura, altura } = TAMANHOS[formato];
  const usado = layoutEfetivo(layout, !!dados.foto);
  const corte = Math.round(altura * CORTE_DA_FICHA);

  const base =
    usado === "numeros"
      ? await fundoLiso(largura, altura)
      : usado === "ficha"
        ? await fundoDividido(dados.foto!, largura, altura, corte)
        : await fundoComFoto(dados.foto!, largura, altura);

  const desenho =
    usado === "ficha"
      ? ficha(dados, largura, altura, corte)
      : usado === "cartao"
        ? cartao(dados, largura, altura)
        : usado === "numeros"
          ? numeros(dados, largura, altura)
          : sobreAFoto(dados, largura, altura);

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">${desenho}</svg>`
  );

  return sharp(base).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
}

// ---------------------------------------------------------------------------
// 1 — sobre a foto: a foto ocupa tudo, o texto se apoia na base
// ---------------------------------------------------------------------------

function sobreAFoto(dados: DadosDoCartao, largura: number, altura: number): string {
  const margem = 72;
  const util = largura - margem * 2;
  const [principal, ...secundarios] = dados.stats;
  const tTitulo = tamanhoQueCabe(dados.titulo, "display", 60, util - 42, 34);

  const pecas: Peca[] = [
    // O recorde vem antes do titulo: e a noticia do cartao.
    ...(dados.selo ? [selo({ texto: escapar(dados.selo), x: margem, gap: 22, tamanho: 28 })] : []),
    linha({
      texto: encurtar(escapar(dados.autor), "corpo", 30, util),
      fonte: "corpo",
      tamanho: 30,
      cor: CORES.texto2,
      x: margem,
      gap: 18,
    }),
    linha({
      texto: encurtar(escapar(dados.titulo), "display", tTitulo, util - 42),
      fonte: "display",
      tamanho: tTitulo,
      cor: CORES.texto,
      x: margem,
      gap: 32,
      ponto: dados.cor,
    }),
  ];

  const temPercurso = !!dados.percurso?.length;
  if (principal) {
    pecas.push(
      resultado({
        principal,
        secundarios,
        x: margem,
        largura: util,
        tamanho: 132,
        cor: CORES.lime,
        gap: dados.movimentos?.length || temPercurso ? 44 : 0,
      })
    );
  }
  if (dados.movimentos?.length) {
    pecas.push(
      movimentos({
        itens: dados.movimentos,
        x: margem,
        largura: util,
        tamanho: 34,
        cor: CORES.texto2,
        maximo: 5,
        gap: temPercurso ? 40 : 0,
      })
    );
  }
  if (dados.percurso?.length) {
    pecas.push(
      tracado({ pontos: dados.percurso, x: margem, largura: util, altura: 230, cor: CORES.lime, gap: 0 })
    );
  }

  const inicio = altura - margem - medir(pecas);
  // O véu cobre o texto com folga e começa bem acima dele, para não virar uma
  // faixa com borda visível.
  const veu = Math.round(altura - inicio + 280);

  return [
    `<defs>
      <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${CORES.fundo}" stop-opacity="0"/>
        <stop offset="48%" stop-color="${CORES.fundo}" stop-opacity="0.80"/>
        <stop offset="100%" stop-color="${CORES.fundo}" stop-opacity="0.97"/>
      </linearGradient>
      <linearGradient id="vt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${CORES.fundo}" stop-opacity="0.6"/>
        <stop offset="100%" stop-color="${CORES.fundo}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${altura - veu}" width="${largura}" height="${veu}" fill="url(#v)"/>
    <rect x="0" y="0" width="${largura}" height="${Math.round(altura * 0.14)}" fill="url(#vt)"/>`,
    marca(margem, margem + 34, 34),
    empilhar(pecas, inicio),
  ].join("");
}

// ---------------------------------------------------------------------------
// 2 — ficha: foto em cima, dados embaixo
// ---------------------------------------------------------------------------

function ficha(dados: DadosDoCartao, largura: number, altura: number, corte: number): string {
  const margem = 72;
  const util = largura - margem * 2;
  const [principal, ...secundarios] = dados.stats;
  const tTitulo = tamanhoQueCabe(dados.titulo, "display", 58, util, 34);

  const pecas: Peca[] = [
    // O recorde vem antes do titulo: e a noticia do cartao.
    ...(dados.selo ? [selo({ texto: escapar(dados.selo), x: margem, gap: 20, tamanho: 26 })] : []),
    linha({
      texto: encurtar(escapar(dados.autor), "corpo", 30, util),
      fonte: "corpo",
      tamanho: 30,
      cor: CORES.texto3,
      x: margem,
      gap: 16,
    }),
    linha({
      texto: encurtar(escapar(dados.titulo), "display", tTitulo, util),
      fonte: "display",
      tamanho: tTitulo,
      cor: CORES.texto,
      x: margem,
      gap: 36,
    }),
    fio(margem, util, 48),
  ];

  if (principal) {
    pecas.push(
      resultado({ principal, secundarios, x: margem, largura: util, tamanho: 124, cor: CORES.lime, gap: 48 })
    );
  }
  if (dados.movimentos?.length) {
    pecas.push(
      movimentos({ itens: dados.movimentos, x: margem, largura: util, tamanho: 34, cor: CORES.texto2, maximo: 6, gap: dados.percurso?.length ? 44 : 0 })
    );
  }
  if (dados.percurso?.length) {
    pecas.push(
      tracado({ pontos: dados.percurso, x: margem, largura: util, altura: 240, cor: dados.cor, espessura: 6, gap: 0 })
    );
  }

  // Centrado no painel, entre o corte e a linha da marca: encostado no topo
  // sobrava um vão morto embaixo, que lia como conteúdo faltando.
  const teto = corte + 76;
  const chao = altura - margem - 70;
  const inicio = Math.max(teto, Math.round(teto + (chao - teto - medir(pecas)) / 2));

  return [
    `<rect x="0" y="${corte - 6}" width="${largura}" height="6" fill="${dados.cor}"/>`,
    empilhar(pecas, inicio),
    marca(margem, altura - margem, 32),
  ].join("");
}

// ---------------------------------------------------------------------------
// 3 — cartão flutuando sobre a foto
// ---------------------------------------------------------------------------

function cartao(dados: DadosDoCartao, largura: number, altura: number): string {
  const margem = 56;
  // pad maior que a margem: o texto respira depois da barra do esporte.
  const pad = 72;
  const larguraDoCartao = largura - margem * 2;
  const util = larguraDoCartao - pad * 2;
  const [principal, ...secundarios] = dados.stats;
  const tTitulo = tamanhoQueCabe(dados.titulo, "display", 52, util, 32);

  const pecas: Peca[] = [
    // O recorde vem antes do titulo: e a noticia do cartao.
    ...(dados.selo ? [selo({ texto: escapar(dados.selo), x: margem + pad, gap: 18, tamanho: 24 })] : []),
    linha({
      texto: encurtar(escapar(dados.autor), "corpo", 28, util),
      fonte: "corpo",
      tamanho: 28,
      cor: CORES.texto3,
      x: margem + pad,
      gap: 16,
    }),
    linha({
      texto: encurtar(escapar(dados.titulo), "display", tTitulo, util),
      fonte: "display",
      tamanho: tTitulo,
      cor: CORES.texto,
      x: margem + pad,
      gap: 36,
    }),
  ];

  if (principal) {
    pecas.push(
      resultado({
        principal,
        secundarios,
        x: margem + pad,
        largura: util,
        tamanho: 96,
        cor: CORES.lime,
        gap: dados.movimentos?.length || dados.percurso?.length ? 36 : 0,
      })
    );
  }
  if (dados.movimentos?.length) {
    pecas.push(
      movimentos({ itens: dados.movimentos, x: margem + pad, largura: util, tamanho: 32, cor: CORES.texto2, maximo: 5, gap: dados.percurso?.length ? 36 : 0 })
    );
  }
  if (dados.percurso?.length) {
    pecas.push(
      tracado({ pontos: dados.percurso, x: margem + pad, largura: util, altura: 200, cor: dados.cor, gap: 0 })
    );
  }

  // O cartão cresce com o conteúdo, em vez de o conteúdo ser espremido nele.
  const alturaDoCartao = medir(pecas) + pad * 2;
  const topo = altura - margem - alturaDoCartao;

  return [
    `<defs>
      <linearGradient id="vt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${CORES.fundo}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${CORES.fundo}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${largura}" height="${Math.round(altura * 0.16)}" fill="url(#vt)"/>`,
    marca(margem + 16, margem + 40, 34),
    // Quase opaco: texto sobre foto translúcida é bonito no mockup e ilegível
    // na foto de alguém.
    `<rect x="${margem}" y="${topo}" width="${larguraDoCartao}" height="${alturaDoCartao}" rx="36" fill="${CORES.superficie}" fill-opacity="0.95"/>
     <rect x="${margem + 26}" y="${topo + 34}" width="8" height="${alturaDoCartao - 68}" rx="4" fill="${dados.cor}"/>`,
    empilhar(pecas, topo + pad),
  ].join("");
}

// ---------------------------------------------------------------------------
// 4 — só os números
// ---------------------------------------------------------------------------

function numeros(dados: DadosDoCartao, largura: number, altura: number): string {
  const margem = 88;
  const util = largura - margem * 2;
  const [principal, ...secundarios] = dados.stats;
  const tTitulo = tamanhoQueCabe(dados.titulo, "display", 68, util - 34, 38);

  const pecas: Peca[] = [
    // O recorde vem antes do titulo: e a noticia do cartao.
    ...(dados.selo ? [selo({ texto: escapar(dados.selo), x: margem, gap: 24, tamanho: 30 })] : []),
    linha({
      texto: encurtar(escapar(dados.autor), "corpo", 32, util),
      fonte: "corpo",
      tamanho: 32,
      cor: CORES.texto3,
      x: margem,
      gap: 24,
    }),
    linha({
      texto: encurtar(escapar(dados.titulo), "display", tTitulo, util - 34),
      fonte: "display",
      tamanho: tTitulo,
      cor: CORES.texto,
      x: margem,
      gap: 60,
      barra: dados.cor,
    }),
  ];

  if (principal) {
    pecas.push(
      resultado({ principal, secundarios, x: margem, largura: util, tamanho: 190, cor: CORES.lime, gap: 60 })
    );
  }
  if (dados.movimentos?.length) {
    pecas.push(fio(margem, util, 42));
    pecas.push(
      movimentos({ itens: dados.movimentos, x: margem, largura: util, tamanho: 38, cor: CORES.texto2, maximo: 8, gap: dados.percurso?.length ? 56 : 0 })
    );
  }
  if (dados.percurso?.length) {
    pecas.push(
      tracado({ pontos: dados.percurso, x: margem, largura: util, altura: 300, cor: dados.cor, espessura: 8, gap: 0 })
    );
  }

  // Centro ÓPTICO, não geométrico: no meio exato o bloco lia como caído, e
  // sobrava um terço de tela vazia em cima.
  const inicio = Math.max(margem + 120, Math.round((altura - medir(pecas)) * 0.4));

  return [
    marca(margem, margem + 36, 36),
    empilhar(pecas, inicio),
  ].join("");
}
