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
 * qual treino foi, e os números. A marca fica discreta: quem posta é a pessoa,
 * não o app.
 */

export type Formato = "story" | "feed";

const TAMANHOS: Record<Formato, { largura: number; altura: number }> = {
  // 9:16 e 4:5 — os formatos que o Instagram aceita sem recortar.
  story: { largura: 1080, altura: 1920 },
  feed: { largura: 1080, altura: 1350 },
};

const CORES = {
  fundo: "#0E1310",
  texto: "#EDEBE1",
  texto2: "#A8AC9E",
  lime: "#C8FA4B",
};

export interface DadosDoCartao {
  /** Foto do post. Sem ela, o cartão vira só os números sobre o verde-tinta. */
  foto?: Buffer | null;
  titulo: string;
  /** Já formatados pelo servidor: ["5,2 km", "27:30", "5:18 /km"]. */
  stats: string[];
  /** Cor do esporte, a mesma que o app usa na borda do card. */
  cor: string;
  /** Traçado do percurso, quando houver GPS. */
  percurso?: { lat: number; lng: number }[] | null;
  /** Quem postou. */
  autor: string;
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
  caixa: { x: number; y: number; largura: number; altura: number }
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

  return `<path d="${d}" fill="none" stroke="${CORES.lime}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;
}

/** Reduz a lista de pontos: um percurso de uma hora tem milhares deles, e o
 *  traçado num cartão de 1080px não ganha nada com mais de umas centenas. */
function afinar<T>(pontos: T[], maximo = 300): T[] {
  if (pontos.length <= maximo) return pontos;
  const passo = pontos.length / maximo;
  const out: T[] = [];
  for (let i = 0; i < maximo; i++) out.push(pontos[Math.floor(i * passo)]);
  out.push(pontos[pontos.length - 1]);
  return out;
}

export async function montarCartao(dados: DadosDoCartao, formato: Formato): Promise<Buffer> {
  const { largura, altura } = TAMANHOS[formato];
  const margem = 72;

  // ---- fundo: a foto cobrindo tudo, ou o verde-tinta ----
  const base = dados.foto
    ? await sharp(dados.foto)
        .resize(largura, altura, { fit: "cover", position: "attention" })
        .toBuffer()
    : await sharp({
        create: { width: largura, height: altura, channels: 3, background: CORES.fundo },
      })
        .png()
        .toBuffer();

  // ---- a faixa escura embaixo ----
  // Sem ela, texto claro sobre foto clara some. O degradê começa na metade da
  // altura para não engolir a foto.
  const alturaDoVeu = Math.round(altura * 0.52);
  const camadas: string[] = [
    `<defs>
      <linearGradient id="veu" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${CORES.fundo}" stop-opacity="0"/>
        <stop offset="55%" stop-color="${CORES.fundo}" stop-opacity="0.72"/>
        <stop offset="100%" stop-color="${CORES.fundo}" stop-opacity="0.96"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${altura - alturaDoVeu}" width="${largura}" height="${alturaDoVeu}" fill="url(#veu)"/>
    <!-- Um véu curto no topo também: a marca é lime, e lime sobre foto clara
         some. Foi o que aconteceu na primeira versão. -->
    <linearGradient id="veuTopo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${CORES.fundo}" stop-opacity="0.62"/>
      <stop offset="100%" stop-color="${CORES.fundo}" stop-opacity="0"/>
    </linearGradient>
    <rect x="0" y="0" width="${largura}" height="${Math.round(altura * 0.14)}" fill="url(#veuTopo)"/>`,
  ];

  // ---- percurso, quando houver ----
  const pontos = dados.percurso?.length ? afinar(dados.percurso) : null;
  const larguraDoTraco = 300;
  if (pontos && pontos.length > 1) {
    camadas.push(
      tracarPercurso(pontos, {
        x: largura - margem - larguraDoTraco,
        y: altura - margem - 420,
        largura: larguraDoTraco,
        altura: 300,
      })
    );
  }

  // ---- os números ----
  // De baixo para cima: os stats na base, o título acima, o autor acima dele.
  let linhaDeBase = altura - margem;

  const tamanhoRotulo = formato === "story" ? 30 : 26;

  if (dados.stats.length) {
    const stats = dados.stats.slice(0, 3);
    const espaco = 48;
    const disponivel = largura - margem * 2;

    // Encolhe até caber em vez de deixar o último número sair pela borda:
    // "5:18 /km" com pace de duas casas já estourava a linha.
    let tamanhoStat = formato === "story" ? 76 : 64;
    const cabe = () =>
      stats.reduce((t, s) => t + larguraDoTexto(s, "displayForte", tamanhoStat), 0) +
        espaco * (stats.length - 1) <=
      disponivel;
    while (tamanhoStat > 34 && !cabe()) tamanhoStat -= 2;

    let x = margem;
    for (const s of stats) {
      camadas.push(
        textoEmVetor(s, {
          x,
          y: linhaDeBase,
          fonte: "displayForte",
          tamanho: tamanhoStat,
          cor: CORES.texto,
        })
      );
      x += larguraDoTexto(s, "displayForte", tamanhoStat) + espaco;
    }
    linhaDeBase -= tamanhoStat + 34;
  }

  const tamanhoTitulo = formato === "story" ? 56 : 48;
  const titulo = encurtar(
    escapar(dados.titulo),
    "display",
    tamanhoTitulo,
    largura - margem * 2 - 40
  );
  camadas.push(
    // O ponto na cor do esporte é a assinatura visual do app — a mesma que
    // marca a borda do card no feed.
    `<circle cx="${margem + 11}" cy="${linhaDeBase - tamanhoTitulo / 3}" r="11" fill="${dados.cor}"/>`,
    textoEmVetor(titulo, {
      x: margem + 40,
      y: linhaDeBase,
      fonte: "display",
      tamanho: tamanhoTitulo,
      cor: CORES.texto,
    })
  );
  linhaDeBase -= tamanhoTitulo + 22;

  camadas.push(
    textoEmVetor(encurtar(escapar(dados.autor), "corpo", tamanhoRotulo, largura - margem * 2), {
      x: margem,
      y: linhaDeBase,
      fonte: "corpo",
      tamanho: tamanhoRotulo,
      cor: CORES.texto2,
    })
  );

  // ---- a marca, discreta, no topo ----
  const tamanhoMarca = formato === "story" ? 34 : 30;
  camadas.push(
    textoEmVetor(escapar(env.appName), {
      x: margem,
      y: margem + tamanhoMarca,
      fonte: "corpoForte",
      tamanho: tamanhoMarca,
      cor: CORES.lime,
      opacidade: 0.92,
    })
  );

  const sobreposicao = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">${camadas.join("")}</svg>`
  );

  return sharp(base).composite([{ input: sobreposicao, top: 0, left: 0 }]).png().toBuffer();
}
