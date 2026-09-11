"""Limpa o trace do vetorizador: o fundo preto vira FURO, e não sumiço.

O arquivo veio de um trace do JPEG inteiro, então o preto do fundo virou
centenas de polígonos por cima e por baixo das letras — inclusive os miolos do
"O" e do "R". Apagar esses polígonos deixava as letras sólidas ("RUM●").

Aqui eles viram máscara: claro pinta, escuro fura. A ordem original é
preservada, que é o que faz um miolo desenhado DEPOIS da letra abrir o buraco
em vez de sumir.

O resultado tem fundo transparente e duas cores, e as duas vêm de fora:
`currentColor` nas letras e `--rumo-acento` na seta.
"""

import io
import re

ORIGEM = "C:/Users/00asa/Downloads/logo-stugaming-vetorizada.svg"
DESTINO = "C:/Users/00asa/.claude/jobs/4af5bd50/tmp/rumo-amigo-limpo.svg"

s = io.open(ORIGEM, encoding="utf-8").read()

abertura = re.search(r"<svg\b[^>]*>", s).group(0)
view = re.search(r'viewBox="([^"]+)"', abertura)
caixa = view.group(1) if view else "0 0 1600 533"


def canais(hexcor):
    h = hexcor.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def luminancia(hexcor):
    r, g, b = (c / 255 for c in canais(hexcor))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def verde(hexcor):
    r, g, b = canais(hexcor)
    # Verde de verdade: o canal G domina os outros com folga.
    return g > 90 and g > r + 40 and g > b + 40


CAMINHO = re.compile(r"<path\b[^>]*?/>|<path\b[^>]*?>.*?</path>", re.S)
FILL = re.compile(r'fill="(#[0-9A-Fa-f]{3,6})"')

mascara, setas = [], []
claros = escuros = 0

for bloco in CAMINHO.findall(s):
    cor = FILL.search(bloco)
    if not cor:
        continue
    hexcor = cor.group(1)

    if verde(hexcor):
        setas.append(FILL.sub('fill="var(--rumo-acento, #3BCC06)"', bloco, count=1))
    elif luminancia(hexcor) > 0.5:
        claros += 1
        mascara.append(FILL.sub('fill="#fff"', bloco, count=1))
    else:
        escuros += 1
        mascara.append(FILL.sub('fill="#000"', bloco, count=1))

saida = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{caixa}">
  <!--
    RUMO — a assinatura.

    Limpeza do trace que veio do vetorizador. O que mudou:
      - o fundo preto virou máscara em vez de forma, então o arquivo tem fundo
        transparente e os miolos das letras são furo de verdade;
      - as cores saíram de dentro: `currentColor` nas letras, a variavel de acento na
        seta. Quem pinta é quem usa.

    Desenho original de um amigo do Asafe; vetorizado por IA e limpo aqui.
  -->
  <defs>
    <mask id="rumo-letras" maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="641">
      {chr(10).join("      " + m for m in mascara)}
    </mask>
  </defs>

  <g mask="url(#rumo-letras)">
    <rect x="-9999" y="-9999" width="19999" height="19999" fill="currentColor"/>
  </g>

{chr(10).join("  " + a for a in setas)}
</svg>
"""

io.open(DESTINO, "w", encoding="utf-8", newline="\n").write(saida)
print(f"caminhos na máscara: {claros} claros + {escuros} escuros = {len(mascara)}")
print(f"caminhos da seta: {len(setas)}")
print("gravou", DESTINO)
