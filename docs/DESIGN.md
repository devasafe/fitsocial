# FitSocial — Brief de Design Mobile

> Prompt e especificação visual completa para o **Claude Design**.
>
> **Como usar:** cole a seção [PROMPT MESTRE](#prompt-mestre) na primeira mensagem. O Claude Design deve entregar primeiro o **design system** (uma tela só), você aprova, e só então ele desenha os fluxos em lotes. Não peça as 45 telas de uma vez — sai inconsistente.
>
> Companheiro de `ARQUITETURA-FITSOCIAL.md`. Toda funcionalidade citada aqui tem endpoint definido lá.

---

# 1. O QUE ESTAMOS DESENHANDO

**Produto:** FitSocial — rede social de atletas em português. A pessoa registra treino de qualquer esporte, acompanha sua evolução num dashboard, e tem no mesmo app um coach de IA, acompanhamento nutricional, desafios em grupo e GPS de corrida/bike.

**Plataforma:** app mobile (React Native / Expo), Android primeiro. Tema escuro único — não existe tema claro.

**Público:** dois perfis que precisam conviver na mesma interface.

| Perfil | O que precisa | O que o afasta |
|---|---|---|
| **Iniciante** (foco principal) | Saber o que fazer hoje. Não se sentir julgado. Ver progresso rápido | Densidade de dados, jargão, ranking onde ele é último, estética de "academia de fisiculturista" |
| **Atleta sério** | Números precisos, histórico, PRs, controle | Interface infantilizada, dados escondidos, excesso de motivação genérica |

**A tensão central do projeto — resolva ela e o design está certo:** o app precisa parecer *sério* para quem treina há 10 anos e *acolhedor* para quem vai treinar pela primeira vez amanhã. A saída não é o meio-termo morno. É **hierarquia**: a superfície é calma e diz uma coisa por tela; a profundidade tem todo o dado que o atleta quer, a um toque de distância.

**Trabalho primário da interface:** fazer a pessoa registrar o treino de hoje em menos de 30 segundos, mesmo com a mão suada, no subsolo, sem sinal.

---

# 2. DIREÇÃO DE ARTE

## 2.1 Princípios

1. **O número é o herói.** Carga, tempo, distância, sequência de dias. Esses são os protagonistas de cada tela — grandes, largos, legíveis de longe, com o rótulo pequeno. Todo o resto se organiza em volta deles.

2. **A cor vem do esporte, não da marca.** O lima é a cor do sistema (ação primária, chrome, marca). O conteúdo é colorido pelo esporte que a pessoa praticou. Um perfil de quem faz jiu-jitsu, corrida e musculação é visivelmente policromático — e é exatamente esse o diferencial do produto ficando visível na tela.

3. **A cor também carrega intensidade.** Volume, esforço e consistência usam uma rampa térmica (§2.4), então gráficos e calendários informam antes de serem lidos.

4. **Escuro terroso, não preto tecnológico.** A base é um verde-tinta profundo com o texto em osso quente, não cinza frio. A diferença é sutil e é o que separa este app dos outros vinte de fitness escuros.

5. **Ousadia num único lugar: o PR.** Bater um recorde é o momento mais alto do produto. É a única tela com animação orquestrada, a única com celebração. Todo o resto é disciplinado e silencioso.

6. **Densidade sob demanda.** Cartão de treino no feed mostra 3 números. Toca e abre com 30. Nunca mostre os 30 primeiro.

7. **Feito para o polegar sujo.** Alvos grandes, ações primárias na metade inferior, nada crítico no topo da tela, funciona de uma mão só.

## 2.2 Anti-referências — não faça

Esta lista existe porque "escuro com verde neon" é o caminho mais rápido para um app de fitness genérico. O cliente escolheu essa direção; a nossa obrigação é executá-la de um jeito que não pareça template.

**Proibido:**
- Fundo inundado de lima. O lima aparece em menos de 10% de qualquer tela.
- Preto puro (#000) ou "preto levemente tingido" tipo #0B0B0B / #111. Use os valores da §2.3.
- Cinza frio azulado no texto. O texto é osso quente.
- Gradiente roxo-para-azul, ou qualquer gradiente de "produto de IA". O coach é um treinador, não um chatbot espacial.
- Glassmorphism, blur atrás de cartão, vidro fosco.
- Todos os blocos como cartões idênticos, mesmo raio, mesma sombra. Raio varia por hierarquia (§2.6); em fundo escuro, separação vem de degrau de superfície e borda de 1px, não de sombra.
- Rótulo em CAIXA ALTA espaçada acima de cada título.
- Fonte monoespaçada para rótulos de dado. Números precisos vêm de numeral tabular na própria fonte, não de mono.
- Sequências de metadado juntadas por ponto médio ("Corrida · 5,2 km · há 2h"). Use espaço e hierarquia de peso.
- Uma palavra do título colorida ou em itálico para dar destaque.
- Marcadores numerados 01 / 02 / 03 onde o conteúdo não é sequência.
- Flecha "→" no fim de texto de botão.
- Ilustração 3D genérica, foto de banco de imagem com gente musculosa sorrindo, silhueta de halter como ícone decorativo.
- Entrada com fade-and-slide-up em cada seção da tela ao carregar.

## 2.3 Paleta base

**Superfícies — verde-tinta, com passo de matiz além do passo de luminosidade:**

| Token | Hex | Uso |
|---|---|---|
| `bg` | `#0E1310` | Fundo do app |
| `surface` | `#161C18` | Cartão, lista, barra inferior |
| `surface-2` | `#1E2620` | Cartão sobre cartão, campo de entrada, folha inferior |
| `surface-3` | `#273029` | Estado pressionado, cabeçalho de tabela |
| `line` | `#2A332C` | Borda padrão, divisor |
| `line-strong` | `#3A453C` | Borda de elemento focado, grade de gráfico |

**Texto — osso quente, não cinza frio. Este é o detalhe que muda o caráter do app:**

| Token | Hex | Uso |
|---|---|---|
| `text` | `#EDEBE1` | Título, número, conteúdo principal |
| `text-2` | `#A8AC9E` | Rótulo, metadado, texto secundário |
| `text-3` | `#6E7469` | Placeholder, timestamp, texto terciário |
| `text-disabled` | `#4A5049` | Desabilitado |

**Marca:**

| Token | Hex | Uso |
|---|---|---|
| `lime` | `#C8FA4B` | Ação primária, marca, estado ativo, indicador de aba |
| `lime-dim` | `#9FCC33` | Pressionado, hover |
| `lime-soft` | `#C8FA4B` a 12% | Fundo de chip ativo, realce de linha |
| `on-lime` | `#0E1310` | Texto e ícone sobre lima |

**Semântica:** o positivo do app já é o lima — não crie um verde de sucesso separado.

| Token | Hex | Uso |
|---|---|---|
| `warning` | `#F5C63C` | Atenção, quota perto do limite, salto de carga |
| `danger` | `#F2634B` | Erro, destrutivo, lesão |
| `info` | `#7FB2E5` | Informativo, dica |

## 2.4 Rampa térmica

Usada em gráfico de volume, calendário de consistência, medidor de esforço e zona de intensidade. Codifica quantidade, não decora.

| Nível | Hex |
|---|---|
| Nada | `#2A332C` |
| Leve | `#5C7A3E` |
| Moderado | `#8FBF42` |
| Forte | `#C8FA4B` |
| Máximo | `#F5C63C` |
| Excesso (alerta de ACWR alto) | `#F2734B` |

## 2.5 Cores de esporte

Cada esporte tem cor fixa. Aparece no ícone, na borda esquerda do cartão de atividade, no ponto do gráfico e no chip de filtro. Nunca como fundo de área grande.

| Esporte | Hex | Esporte | Hex |
|---|---|---|---|
| Musculação | `#C8FA4B` | MMA | `#D96FE0` |
| Corrida | `#FF8A4C` | Funcional | `#4FD69C` |
| Ciclismo | `#4C9AFF` | Caminhada | `#96A39A` |
| Natação | `#2FD4D4` | Escalada | `#C98A3C` |
| CrossFit | `#F5C63C` | Yoga | `#DCC4A0` |
| Jiu-jitsu | `#9B7CF0` | Outro | `#7A8079` |
| Muay thai | `#F27299` | | |
| Boxe | `#EF5350` | | |

## 2.6 Tipografia

**Duas larguras da mesma superfamília.** O contraste é de largura, não de serifa — mais atlético e menos batido que o par display-serifa/corpo-sans.

- **Archivo Expanded** — 700 e 800. Número herói, título de tela, placar. A largura dá a fisicalidade que o produto pede.
- **Archivo** — 400, 500, 600. Interface, corpo, rótulo, botão.

*Alternativa se o Expanded pesar no bundle:* **Sora** 600/700 no display + **Archivo** no corpo.

**Números sempre com numeral tabular** (`font-variant-numeric: tabular-nums`). Sem isso o placar dança durante o cronômetro.

**Escala** (tamanho / entrelinha / tracking):

| Papel | Fonte | Valor |
|---|---|---|
| `metric-hero` | Archivo Expanded 800 | 56 / 56 / −2% |
| `metric-lg` | Archivo Expanded 700 | 40 / 42 / −1.5% |
| `metric-md` | Archivo Expanded 700 | 28 / 30 / −1% |
| `title-screen` | Archivo Expanded 700 | 24 / 30 / −1% |
| `title-section` | Archivo 600 | 18 / 24 / 0 |
| `title-card` | Archivo 600 | 16 / 22 / 0 |
| `body` | Archivo 400 | 15 / 22 / 0 |
| `body-strong` | Archivo 500 | 15 / 22 / 0 |
| `label` | Archivo 500 | 13 / 18 / 0 |
| `caption` | Archivo 400 | 12 / 16 / 0 |

Rótulos em **caixa de frase**, nunca caixa alta. Linha de texto corrido abaixo de 70 caracteres.

## 2.7 Espaçamento, raio, elevação

**Grade de 4.** Valores: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72. Gutter lateral da tela: **20**. Espaço entre cartões: **12**. Respiro entre seções: **32**.

**Raio por hierarquia** — não use o mesmo em tudo:

| Elemento | Raio |
|---|---|
| Chip, tag, campo de entrada | 10 |
| Cartão de lista, cartão de atividade | 14 |
| Bloco herói, tile de métrica | 20 |
| Folha inferior, modal | 24 (só topo) |
| Mídia dentro de cartão | 12 |
| Avatar, pílula, botão redondo | completo |

**Elevação em fundo escuro** — três níveis, por degrau de superfície + borda de 1px. Sem sombra difusa cinza.

| Nível | Composição |
|---|---|
| 0 | `bg` |
| 1 | `surface` + borda `line` |
| 2 | `surface-2` + borda `line` |
| 3 | `surface-2` + borda `line-strong` + sombra `rgba(0,0,0,.5)` 0 8 24 — **só** para folha inferior, modal e o botão de registrar |

O botão de registrar é o único elemento com brilho: sombra `rgba(200,250,75,.24)` 0 6 20.

## 2.8 Ícones

Traço de 1.75px, cantos levemente arredondados, grade de 24. Biblioteca base: Lucide, com um conjunto customizado para os esportes (não use halter genérico para tudo — luva de boxe, tênis de corrida, kimono, bicicleta, kettlebell). Ícone de esporte sempre na cor do esporte.

## 2.9 Movimento

**Durações:** 120ms micro (toque, chip) · 200ms padrão (transição, expansão) · 320ms folha inferior · 700ms celebração de PR.
**Easing:** `cubic-bezier(0.2, 0, 0, 1)` para entrada, `cubic-bezier(0.4, 0, 1, 1)` para saída.

**Regra:** movimento responde a ação da pessoa — abrir, confirmar, expandir, arrastar. Nada se anima só porque a tela carregou.

**A exceção, e o único momento orquestrado do app — a celebração de PR:**
1. O número anterior sobe e sai de cena (140ms).
2. O número novo entra por baixo com escala 0.9 → 1 (240ms).
3. A rampa térmica varre a barra da esquerda para a direita (400ms).
4. Háptica de impacto médio no ponto exato em que o número assenta.
5. Doze partículas curtas na cor do esporte, subindo 40px e sumindo. **Não é confete de tela cheia.**
6. O cartão compartilhável desliza por baixo (200ms de atraso).

Respeite "Reduzir movimento": nesse caso, corte a etapa 3 e 5, mantenha a troca de número em corte seco e a háptica.

---

# 3. VOZ E TEXTO

O texto é conteúdo de design. Escreva em português do Brasil, caixa de frase, voz ativa, verbo direto.

**Regras:**
- O botão diz o que acontece. "Salvar treino", não "Confirmar". A ação mantém o mesmo nome do começo ao fim: o botão "Publicar" gera o aviso "Publicado".
- Tela vazia é convite, não decoração. Diz o que fazer e tem o botão para fazer.
- Erro diz o que aconteceu e como resolver. Não pede desculpa, não é vago.
- Zero motivação genérica. O app não é seu personal animado.

| Não escreva | Escreva |
|---|---|
| "Vamos lá, campeão! 💪" | "Treino de hoje: superiores A" |
| "Ops! Algo deu errado" | "Não deu para salvar. Seu treino está guardado no aparelho e sobe quando a internet voltar." |
| "Sem dor, sem ganho" | (nada — corte) |
| "Você falhou a dieta hoje" | "Você registrou 2 das 4 refeições" |
| "Nenhum resultado encontrado" | "Ninguém com esse nome ainda. Buscar por @usuário?" |
| "Parabéns pelo seu esforço incrível!" | "Recorde novo: supino 92,5 kg" |
| "Você está fora de forma" | (nunca. Ver §7) |

---

# 4. NAVEGAÇÃO

**Barra inferior com 4 abas + botão de registrar no centro:**

```
┌─────────────────────────────────────────────┐
│                                             │
│                CONTEÚDO                     │
│                                             │
├─────────────────────────────────────────────┤
│  Hoje    Feed    ( + )    Coach    Perfil   │
└─────────────────────────────────────────────┘
```

O `( + )` não é aba — é um botão redondo lima, elevado, 56px, que abre a folha de registrar atividade.

**Por que assim:** registrar treino é a ação mais frequente do produto e ganha o centro do alcance do polegar. O Coach é o diferencial competitivo e merece permanência. Desafios é bursty — só importa quando existe um desafio rodando — então vive como bloco no topo de **Hoje**, não como chrome permanente.

*Se em algum momento os desafios virarem o principal motor de retenção, troque a aba Coach por Desafios e mova o Coach para um botão fixo no Hoje. Não mexa nas outras.*

**Notificações:** ícone com contador no cabeçalho de Hoje e de Feed.

---

# 5. INVENTÁRIO DE COMPONENTES

Desenhe cada um com **todos** os estados: padrão, pressionado, desabilitado, carregando, erro, foco de teclado.

**Base**
`Button` (primário lima · secundário contorno · fantasma · destrutivo · tamanhos sm/md/lg · com ícone · só ícone) · `Input` (texto, senha com olho, área de texto, com prefixo/sufixo, contador de caracteres) · `NumberStepper` (para carga e reps — botões grandes, digitação direta ao toque no número) · `Select` / `Picker` · `Switch` · `Checkbox` · `RadioGroup` · `Slider` (para porção de comida e RPE) · `SegmentedControl` (Seguindo / Descobrir) · `Chip` (filtro, selecionável, com cor de esporte) · `Badge` (contador, "Novo", "Rx", "PR") · `Avatar` (4 tamanhos, com anel de esporte principal, com indicador de sequência ativa) · `Divider`

**Estrutura**
`Card` (3 elevações, com borda esquerda de cor de esporte) · `ListItem` (com avatar, com métrica à direita, arrastável) · `BottomSheet` (com alça, 3 alturas de encaixe) · `Modal` · `Toast` (sucesso, erro, ação com desfazer) · `Header` (título grande que encolhe ao rolar, com ação) · `TabBar` · `FAB` · `PullToRefresh` · `SectionHeader` (título + ação à direita, sem eyebrow)

**Dados**
`MetricTile` (número herói + rótulo + delta com sinal) · `StatRow` (rótulo à esquerda, valor tabular à direita) · `ProgressRing` (macros, adesão) · `LineChart` (evolução de carga, peso, pace) · `BarChart` (volume semanal) · `HeatCalendar` (grade de consistência com rampa térmica) · `StreakCounter` (com estado congelado) · `PRCard` (esporte, métrica, valor, delta do anterior, data) · `MacroBar` (proteína/carbo/gordura empilhada) · `PaceSplitList` (splits por km com barra proporcional) · `LeaderboardRow` (posição, avatar, nome, pontos, delta de posição, destaque para "você") · `ComparisonBar` ("você hoje vs você há 3 meses")

**Domínio**
`SportIcon` · `SportPicker` (grade de esportes, mais usados primeiro) · `ActivityCard` (o cartão do feed — variante por payload: musculação, distância, WOD, luta, genérico, nota) · `SetRow` (linha de série no treino ao vivo: série, carga, reps, checkbox grande) · `ExerciseBlock` (exercício expansível com séries dentro) · `RestTimer` (circular, com pular e +15s) · `LiveWorkoutHeader` (cronômetro, exercício atual, progresso da sessão) · `MapCard` (traçado do percurso, estático no feed, interativo no detalhe) · `LiveTrackingPanel` (distância grande, pace, tempo, botões pausar/finalizar) · `FoodItemRow` (nome, porção ajustável, kcal, badge de confiança) · `PhotoAnalysisResult` (itens detectados, faixa de kcal, sliders de porção) · `CheckinCard` (foto, esporte, pontos, autor) · `ChallengeCard` (capa, período, participantes, sua posição) · `CoachMessage` (bolha do coach vs da pessoa; bolha com plano anexado) · `QuotaBanner` (uso restante do dia) · `SafetyNote` (aviso de não substituir profissional — discreto, persistente, não descartável) · `PrivacyLock` (cadeado indicando bloco privado no perfil) · `OfflineBanner` · `SyncIndicator` (n itens aguardando envio)

**Estados de tela** — obrigatórios em toda tela com dado remoto:
`Skeleton` (na forma do conteúdo real, sem shimmer exagerado) · `EmptyState` (ícone, uma frase, um botão) · `ErrorState` (o que falhou + botão tentar de novo) · `NoPermission` (para localização, câmera, notificação — com o motivo e o botão de abrir ajustes)

---

# 6. TELAS

45 telas em 11 fluxos. Para cada uma: objetivo, blocos, estados, interações.

## 6.1 Entrada

**1. Splash** — logotipo centralizado sobre `bg`, sem animação de carregamento longa. Decide entre autenticado / não.

**2. Boas-vindas** — 3 painéis deslizáveis mostrando o produto real (dashboard, feed, desafio), não ilustração abstrata. Botões "Criar conta" e "Entrar".

**3. Entrar** — e-mail, senha com olho, "Esqueci a senha", botão "Entrar". Erro inline no campo, nunca modal.

**4. Criar conta** — e-mail, senha com medidor de força, @usuário com verificação de disponibilidade ao vivo, aceite dos Termos e **checkbox separado e destacado** para tratamento de dados de saúde (exigência de LGPD — não enterre).

**5. Recuperar senha** — e-mail → confirmação com instrução clara do que chega na caixa.

## 6.2 Onboarding

**6. Conversa com o coach** — tela de chat. O coach pergunta objetivo, esportes, nível, dias por semana, tempo por sessão, restrições e lesões. Respostas por chip sugerido **ou** texto livre. Barra de progresso discreta no topo mostrando quanto falta. Nunca pareça formulário.

**7. Escolher esportes** — grade de 14 cartões com ícone e cor do esporte. Multi-seleção. Um marcado como principal (define o anel do avatar).

**8. Ficha pronta** — resumo estruturado do que a conversa capturou, tudo editável por toque. Botão "Gerar meu plano". `SafetyNote` visível.

**9. Gerando plano** — tela de espera com o que está sendo feito em linguagem real ("montando a semana", "ajustando pelas suas lesões"), não barra falsa. 15–40s.

**10. Permissões** — três cartões, cada um explicando o ganho concreto antes de pedir: notificação, câmera/galeria, localização. Cada um recusável sem travar o app.

## 6.3 Hoje

**11. Hoje** — a tela mais importante. Ordem vertical:
1. Cabeçalho: saudação com primeiro nome, avatar, ícone de notificação.
2. **Treino de hoje** — cartão herói: nome da sessão, esporte, duração estimada, número de exercícios, botão grande "Começar treino". Se já treinou hoje: resumo do que fez + "Registrar outro". Se é dia de descanso: cartão calmo dizendo isso, sem culpa.
3. **Desafio ativo** (se houver) — capa, sua posição, pontos para o próximo, dias restantes, botão de check-in.
4. **Sequência** — contador + últimos 7 dias em `HeatCalendar` compacto.
5. **Comparação** — "você vs você": um `ComparisonBar` rotativo, gerado do dado real.
6. **Nutrição de hoje** — anel de macros + kcal restantes, ou, no modo sem números, refeições registradas de 4.
7. **Atalho para o Coach** — uma linha, com a última mensagem dele.

Estados: sem plano (convida a gerar) · offline (banner + tudo do cache) · primeiro dia (só treino de hoje e o convite para seguir pessoas).

**12. Notificações** — lista agrupada por dia, tipos com ícone distinto, não lidas com marca lima à esquerda. Toque leva ao alvo. Vazio: "Nada novo. Quando alguém curtir ou comentar seu treino, aparece aqui."

## 6.4 Treino

**13. Plano da semana** — 7 colunas de dia, sessão de cada dia, dias concluídos com marca. Toque abre a sessão. Botão de ajustar plano (quota).

**14. Detalhe da sessão** — lista de `ExerciseBlock` com séries prescritas, carga sugerida, descanso, vídeo de execução. Botão fixo no rodapé: "Começar treino".

**15. Treino ao vivo** — a tela mais exercitada do app. Cronômetro total no topo, exercício atual grande, `SetRow` para cada série com `NumberStepper` de carga e reps e um checkbox de 44px. Ao marcar a série, o `RestTimer` sobe automaticamente. Navegação entre exercícios por deslize. Autossalvamento contínuo com `SyncIndicator`. Funciona 100% offline. Botão de finalizar sempre alcançável.

**16. Descanso** — sobreposição parcial (não tela cheia): anel de contagem, próximo exercício e série já visíveis, "+15s" e "Pular".

**17. Resumo pós-treino** — duração, volume total, séries, esporte. **PRs detectados em destaque.** Campos de esforço percebido (1–10), sensação, legenda e foto. Seletor de visibilidade em três estados com ícone: privado / seguidores / público. Botão "Salvar treino".

**18. Celebração de PR** — a tela orquestrada da §2.9. Valor novo enorme, valor anterior riscado acima, delta, data do recorde antigo. Cartão compartilhável já montado com "Compartilhar" e "Publicar no feed".

**19. Histórico** — lista cronológica com filtro por esporte e período. Cabeçalho por mês com totais.

**20. Evolução por exercício** — seletor de exercício, `LineChart` de carga e de 1RM estimado, tabela de melhores por faixa de repetição.

## 6.5 Registrar

**21. Folha de registrar** — abre do `( + )`. Grade de esportes com os mais usados primeiro. Abaixo: "Importar do Health Connect", "Importar arquivo GPX", "Só uma foto" (post sem treino).

**22. Registro de musculação** — adicionar exercício por busca, séries com carga e reps, duplicar série, marcar aquecimento e falha.

**23. Corrida/bike ao vivo** — mapa ocupando o topo, `LiveTrackingPanel` fixo embaixo com distância em `metric-hero`, pace, tempo e elevação. Pausar / retomar / finalizar (finalizar exige deslizar, para não parar sem querer). Sinal de GPS visível. **Primeira gravação:** cartão explicando a otimização de bateria do fabricante, com botão que abre o ajuste do sistema.

**24. Registro de WOD** — nome ou seleção de benchmark, tipo de score (tempo / AMRAP / EMOM / carga / reps), campo de resultado adaptado ao tipo, alternador Rx, descrição.

**25. Registro de luta** — modalidade, tipo de sessão (técnica / drill / sparring / competição / condicionamento), rounds, duração, parceiros marcáveis.

**26. Registro genérico** — esporte, duração, esforço, descrição, foto.

**27. Importar** — Health Connect: lista de atividades encontradas com checkbox e prévia. GPX: seletor de arquivo + resumo do que será importado.

## 6.6 Feed

**28. Feed** — `SegmentedControl` "Seguindo | Descobrir" no cabeçalho. Lista de `ActivityCard`. Cada cartão: avatar com anel de esporte, nome, @usuário, tempo relativo, borda esquerda na cor do esporte, título, **três métricas em destaque** (variam por esporte), foto ou traçado do mapa se houver, legenda, marcações, ações. Badge "PR" quando a atividade tem recorde.
Estados: Seguindo vazio → "Você ainda não segue ninguém" + botão que leva para Descobrir · Descobrir vazio (base pequena) → mostra pessoas da mesma cidade e esporte.

**29. Detalhe da atividade** — todo o dado do treino. Musculação: todas as séries. Corrida: mapa interativo, splits, gráfico de pace e elevação. WOD: descrição e score. Curtidas, comentários, marcados.

**30. Comentários** — lista com respostas aninhadas em um nível, campo fixo no rodapé, deslizar para apagar o próprio.

**31. Criar post** — foto ou galeria, legenda, esporte opcional, marcar pessoas, visibilidade.

**32. Buscar** — campo único, resultados em abas: Pessoas, Clubes, Desafios. Sugestões antes de digitar: mesma cidade, mesmo esporte.

## 6.7 Perfil

**33. Meu perfil** — capa, avatar com anel, nome, @usuário, bio, cidade, esportes como chips coloridos, contadores (seguidores / seguindo / atividades). Abaixo, o **dashboard**:
1. `HeatCalendar` de 12 semanas + sequência.
2. `MetricTile` em grade: treinos no mês, minutos, volume, distância.
3. **PRs fixados** — carrossel de `PRCard`.
4. Volume semanal em `BarChart` com rampa térmica.
5. Corpo — peso, medidas, fotos. Com `PrivacyLock` se privado.
6. Nutrição — adesão da semana. Com `PrivacyLock` se privado.
7. Conquistas — badges, provas, graduações.
8. Atividades recentes.

**34. Perfil de outra pessoa** — mesma estrutura, respeitando cada regra de privacidade bloco a bloco. Botão Seguir / Seguindo. Menu com Denunciar e Bloquear.

**35. Editar perfil** — nome, @usuário, bio, cidade, avatar, capa, esportes, esporte principal, graduações.

**36. Privacidade** — um controle por bloco: perfil, peso, nutrição, visibilidade padrão de atividade. Zonas de privacidade do GPS com mapa e raio ajustável. Texto explicando o efeito de cada escolha em uma frase.

**37. Configurações** — conta, notificações por tipo, unidades, idioma, modo sem números na nutrição, plano e uso, exportar meus dados, apagar conta, sobre, sair.

**38. Meus PRs** — todos os recordes agrupados por esporte, fixar/desfixar, adicionar recorde antigo manualmente.

**39. Medidas corporais** — registrar peso e medidas, `LineChart` de peso, fotos de progresso em comparação lado a lado por data.

## 6.8 Coach e nutrição

**40. Chat do coach** — conversa contínua. Bolha do coach com o esporte contextualizado. Chips de ação rápida ("ajustar meu plano", "trocar exercício", "estou com dor no ombro"). `QuotaBanner` discreto. `SafetyNote` no primeiro acesso do dia. Anexo de plano vem como cartão navegável, não como parede de texto.

**41. Diário alimentar** — data navegável, anel de kcal e `MacroBar`, quatro seções de refeição, cada item como `FoodItemRow`. Botão de adicionar com quatro caminhos: foto, código de barras, buscar, manual. Água como contador de toque. **No modo sem números:** o anel vira "refeições registradas" e nenhum kcal aparece.

**42. Foto da comida** — câmera com guia de enquadramento. Resultado: itens detectados, cada um com porção ajustável por slider e badge de confiança. Total sempre como **faixa** ("≈ 600–750 kcal"), nunca número exato. Botões "Confirmar" e "Adicionar item".

**43. Buscar alimento** — busca, resultados com kcal por 100g, badge de fonte (tabela oficial / código de barras / da comunidade), seletor de porção.

**44. Metas nutricionais** — kcal e macros, com explicação de como saíram. Se a pessoa tentar meta abaixo do piso: **recusa gentil** explicando por que e sugerindo procurar profissional. Não é modal de erro — é uma tela com cuidado.

## 6.9 Desafios

**45. Desafios** — abas "Meus" e "Descobrir". `ChallengeCard` com capa, período, participantes e sua posição. Botão de criar e campo de entrar por código.

**46. Criar desafio** — nome, capa, período, prazo de inscrição, visibilidade, e o bloco de regras: modo de pontuação (check-ins / minutos / distância / pontos), máximo por dia, foto obrigatória, esportes permitidos, equipes, handicap para iniciante. Cada regra com uma linha explicando o efeito. Prévia de como o ranking vai ficar.

**47. Detalhe do desafio** — cabeçalho com contagem regressiva e sua posição. Três abas: Ranking, Mural, Conversa. Botão de check-in fixo.

**48. Ranking** — `LeaderboardRow` com sua linha destacada e fixada quando sai da área visível. Alternador individual / equipes. Delta de posição em relação a ontem.

**49. Check-in** — foto (se obrigatória), esporte, vínculo com atividade já registrada ou registro na hora, pontos que serão somados visíveis antes de confirmar.

**50. Resultado final** — pódio, seus números, total do grupo ("juntos vocês treinaram 412 horas"), cartão compartilhável.

## 6.10 Clubes e comunidade

**51. Clubes** — busca por cidade, cartão de clube com logo, tipo, membros. Meu clube em destaque.

**52. Perfil do clube** — capa, logo, tipo, endereço com mapa, bio, membros, ranking interno, atividades do clube, desafios da casa. Botão de entrar.

**53. Buscar parceiro de treino** — filtro por esporte, cidade e faixa de horário. Resultado em cartões com o horário habitual da pessoa. Botão de seguir.

**54. Seguidores / Seguindo** — lista com busca e botão de seguir em cada linha.

## 6.11 Sistema

**55. Plano e uso** — plano atual (na fase inicial: "Fundador — acesso completo", com badge). Lista de recursos com uso do dia e limite. Sem tela de venda enquanto o Premium não existir.

**56. Limite atingido** — quando a quota estoura: o que atingiu, quando renova, e uma alternativa útil naquele momento. Não é parede de pagamento na fase inicial.

**57. Denunciar** — motivo por rádio, descrição opcional, confirmação dizendo o que acontece depois.

**58. Exportar / apagar dados** — exportação gera arquivo e avisa quando fica pronto. Apagar conta pede confirmação por digitação e explica o que é apagado e o que é irreversível.

---

# 7. ACESSIBILIDADE E CUIDADO COM A PESSOA

**Não é sessão opcional. É requisito de aceitação.**

**Acessibilidade**
- Contraste mínimo 4.5:1 em texto corrido, 3:1 em texto grande e ícone. Verifique especialmente `text-2` sobre `surface-2`.
- Alvo de toque nunca menor que 44×44, mesmo em ícone pequeno.
- Nunca use só cor para informar. Cor de esporte sempre acompanhada de ícone; delta de PR sempre com sinal + ou −.
- Suporte a fonte grande do sistema até 200% sem quebrar layout — teste principalmente o treino ao vivo e o ranking.
- Rótulo de acessibilidade em todo ícone-botão.
- "Reduzir movimento" respeitado (§2.9).
- Foco de teclado visível (o app roda também na web).

**Cuidado com a saúde — regras de interface**
- `SafetyNote` fixo e não descartável nas telas de plano de treino, metas nutricionais e diário alimentar.
- Modo sem números na nutrição, alcançável em 2 toques a partir do diário.
- Nenhuma notificação push com número de caloria ou de peso.
- Peso, medidas e nutrição privados por padrão, com `PrivacyLock` visível para a própria pessoa saber disso.
- Sequência de dias tolerante: descanso planejado conta como cumprido, e existe "congelar" para doença ou viagem. Nenhuma tela chama a pessoa de faltosa.
- Ranking padrão por consistência, não por carga ou pace — o iniciante não pode abrir o app e se ver em último.
- Nenhum texto compara o corpo da pessoa com o de outra.
- Se a pessoa pedir meta abaixo do piso seguro, a tela recusa com cuidado e oferece caminho para profissional (tela 44).
- Zonas de privacidade do GPS apresentadas na primeira gravação, não escondidas nos ajustes.

---

# 8. PROMPT MESTRE

*(cole daqui até o fim)*

---

Você é o designer líder deste projeto. Vamos desenhar o **FitSocial**, um app mobile de rede social de atletas em português, tema escuro, Android primeiro.

Toda a especificação está no documento `BRIEF-DESIGN-MOBILE.md` que estou anexando. Leia inteiro antes de desenhar qualquer coisa. Ele define paleta com hex, tipografia com escala, espaçamento, raio por hierarquia, movimento, 58 telas, inventário de componentes, voz do texto e requisitos de acessibilidade.

**Contexto que você precisa carregar antes de tudo:**
- Público duplo: iniciante que nunca treinou e atleta que treina há dez anos. A interface é calma na superfície e densa na profundidade.
- Trabalho primário: registrar o treino de hoje em menos de 30 segundos, com a mão suada, no subsolo, sem sinal.
- O cliente escolheu escuro com verde-limão. **Atenção:** escuro com um único verde ácido é hoje o resultado mais previsível que existe em design gerado. A direção é essa e vamos honrá-la, então sua obrigação é executar a versão específica dela, não a genérica. As seções 2.2 (anti-referências), 2.3 (verde-tinta e texto em osso quente, não cinza frio) e 2.5 (cor vem do esporte, lima é só o sistema) existem exatamente para isso. Siga-as ao pé da letra.

**Trabalhe em duas passadas, como manda o ofício:**

**Passada 1 — plano.** Antes de desenhar tela, me entregue:
- o sistema de tokens montado a partir da §2 (cor, tipo, espaço, raio, elevação, movimento);
- o conceito de layout em uma frase por arquétipo de tela, com wireframe em ASCII para comparar opções — pelo menos para Hoje, Feed, Treino ao vivo e Perfil;
- os princípios que fazem este app diferente dos outros escuros de fitness.

Depois revise seu próprio plano contra o brief e me diga: que parte disso eu produziria para qualquer app de fitness escuro? Refaça essa parte e explique o que mudou e por quê. Não comece a desenhar antes de fechar isso comigo.

**Passada 2 — construção, em lotes.** Nesta ordem, um lote por vez, esperando meu ok entre eles:

| Lote | Conteúdo |
|---|---|
| A | Tela de design system: paleta, tipografia, espaçamento, e todos os componentes base com todos os estados |
| B | Componentes de dado e de domínio (§5) |
| C | Hoje, Notificações, Registrar (telas 11, 12, 21) |
| D | Treino: plano, sessão, treino ao vivo, descanso, resumo, celebração de PR (13–18) |
| E | Registro por esporte: musculação, corrida ao vivo, WOD, luta, genérico, importar (22–27) |
| F | Feed, detalhe, comentários, criar post, buscar (28–32) |
| G | Perfil, dashboard, perfil alheio, editar, privacidade, configurações, PRs, medidas (33–39) |
| H | Coach e nutrição (40–44) |
| I | Desafios (45–50) |
| J | Clubes, comunidade, sistema (51–58) |
| K | Todos os estados vazios, de erro, offline e de permissão |
| L | Entrada e onboarding (1–10) |

Onboarding vem no fim de propósito: só se desenha a porta de entrada depois de saber exatamente o que tem dentro da casa.

**Regras de execução:**
1. Use conteúdo real, nunca lorem ipsum. Nomes brasileiros, exercícios reais ("supino reto", "agachamento livre", "terra"), cargas plausíveis (70 kg no supino, não 500), paces reais (5:30/km), pratos reais (arroz, feijão, frango grelhado), nomes de desafio como alguém escreveria de verdade.
2. Escreva todo o texto de interface seguindo a §3. Texto é seu trabalho tanto quanto o espaçamento.
3. Todo componente com todos os estados. Toda tela com carregando, vazio, erro e offline.
4. Nada de sombra difusa cinza em fundo escuro. Separação vem de degrau de superfície e borda de 1px.
5. Raio varia por hierarquia. Não use 16px em tudo.
6. Movimento só responde a ação. A única exceção é a celebração de PR (§2.9), e ela é o momento mais bonito do app.
7. Se algo no brief estiver errado, impossível ou contraditório, **me diga** em vez de contornar em silêncio.
8. Ao fim de cada lote, critique seu próprio trabalho: o que ficou genérico, o que você cortaria, onde a acessibilidade está no limite.

Comece pela Passada 1. Não desenhe tela nenhuma ainda.
