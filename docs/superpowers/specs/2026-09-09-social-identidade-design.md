# FitSocial — identidade, social e descoberta

> Desenho de produto e arquitetura. Nada implementado ainda.
> Fonte de verdade de produto: [`VISAO.md`](../../VISAO.md) · arquitetura: [`ARQUITETURA.md`](../../ARQUITETURA.md)

## O problema, em uma frase

Hoje o FitSocial obriga a pessoa a **postar para existir**.

Isso não é uma opinião: está no código. `GET /social/users/:id` devolve
`counts: { posts: posts.length }` (`api/src/routes/social.ts:418`) e o app exibe esse número
com o rótulo **"Treinos"** (`app-android/src/screens/ProfileScreen.tsx:150`). Quem treina
todo dia e não publica tem perfil vazio e contador zerado. Pior: `posts.length` vem de uma
query com `.limit(30)`, então o número mente para quem passa de 30 publicações.

A correção não é um ajuste de rótulo. É separar duas coisas que o produto tratava como uma:

```
Atividade   "eu fiz isso"                    → histórico, sempre registrado
Perfil      "aqui está o que eu faço"        → identidade pública
Post        "quero que vejam isso agora"     → escolha deliberada
```

## O que já existe (e está desligado)

Metade da fundação está pronta e sem uso:

| Peça | Estado |
|---|---|
| `Activity.visibility` (`private`/`followers`/`public`) | Existe no schema. Só é lido em `GET /activities/:id`, e é **ignorado** quando a atividade tem post |
| `shareToFeed` opt-in | **Já funciona**: `services/activities.ts:77` só cria Post se a pessoa pedir |
| Seguindo vs Explorar | **Já existe**, via `SegmentedControl` em `ComunidadeScreen.tsx` |
| `Post.hidden` | Existe, usado só por banimento de conta |
| `SegmentedControl` genérico | Existe e é reutilizável para as abas do perfil |
| `AdminAudit`, `requireAdmin` | Existem, prontos para a moderação |

O que falta é ligar isso e dar cara.

## O que não existe

Editar ou excluir post (nem o próprio), denúncia, menu `(...)` no post, configurações,
troca de senha, `tokenVersion` para invalidar sessão, estado de "visto" por área, push,
agrupamento de notificação, componente de badge, sheet ou menu de contexto.

---

# 1. Modelo de dados

## Post — alterar

```
editedAt   Date | null    // preenchido na primeira edição; o app mostra "(editado)"
deletedAt  Date | null    // exclusão é lógica, ver abaixo
deletedBy  ObjectId | null   // o autor ou um admin
```

**Por que exclusão lógica e não apagar a linha:** um post excluído por denúncia precisa
continuar legível para quem analisa a denúncia, e as curtidas, comentários e notificações
que apontam para ele precisam de um destino que responda "não está mais disponível" em vez
de quebrar. O post some de todas as listas no mesmo instante — para quem usa, é exclusão.
A linha é purgada depois (TTL de 90 dias), junto do que dependia dela.

Índices novos: `{ author: 1, createdAt: -1 }` e `{ deletedAt: 1 }`.
Toda query de leitura ganha `deletedAt: null`.

## Activity — alterar

```
visibility     já existe   // passa a ser REALMENTE aplicado nas leituras
routeVisible   Boolean     // default false
```

**`routeVisible` separado da visibilidade da atividade** porque são riscos diferentes.
"Correu 6 km em 32 min" é resultado. O traçado de GPS é **onde a pessoa mora** — o mapa
começa e termina na porta dela. Deixar os dois no mesmo botão faz alguém publicar o segundo
achando que publicou o primeiro. O `SECURITY.md` já proíbe coordenada em log; expor rota por
padrão seria pior que logar.

## Report — novo

```
reporter     ObjectId ref User
targetKind   "post" | "comment" | "user"
targetId     ObjectId
reason       "spam" | "ofensivo" | "assedio" | "improprio" | "odio" | "enganoso" | "outro"
details      String (500)        // opcional, quando reason = "outro"
status       "pendente" | "analisando" | "resolvida" | "rejeitada"
snapshot     { texto, imageUrl, autorId, autorLabel }   // conteúdo no momento da denúncia
resolvedBy   ObjectId | null
resolvedAt   Date | null
decision     "removido" | "mantido" | null
```

Índice único `{ reporter, targetKind, targetId }`: a mesma pessoa não denuncia o mesmo post
duas vezes. Denúncias de pessoas diferentes sobre o mesmo alvo são agrupadas na leitura do
painel — dez denúncias viram uma fila com contador, não dez itens.

**`snapshot` existe porque o conteúdo pode sumir antes da análise.** Se o autor apagar o post
depois de denunciado, o admin ainda precisa ver o que foi denunciado para decidir.

## ReadState — novo

```
user      ObjectId ref User
area      "feed" | "explore" | "desafios" | "notificacoes"
lastSeenAt Date
índice único { user, area }
```

**O contador é derivado, nunca incrementado.** "Quantos itens novos" é
`count(area, createdAt > lastSeenAt)`, calculado na leitura. Isso elimina de uma vez os
quatro problemas que você listou: não duplica (não há o que somar duas vezes), não trava em
um número (é sempre recalculado), não zera sozinho (só a visita move `lastSeenAt`) e não
repete (cada área tem a sua marca).

## User — alterar

```
settings: {
  activitiesPublic  Boolean | null  default null   // null = ainda não perguntamos
  routesPublic      Boolean         default false  // traçado de GPS
  notifications: { novosPosts, interacoes, desafios, sistema }  // todos default true
}
tokenVersion  Number  default 0    // trocar senha derruba as sessões antigas
```

## Notification — alterar

Novos tipos: `post_novo`, `atividade_nova`, `post_removido`, `denuncia_resolvida`.
Campo `groupKey` (ex.: `post_novo:2026-09-09:14`) para agrupar "5 novas publicações de
pessoas que você segue" em vez de cinco linhas.
Índice `{ user: 1, createdAt: -1 }` (hoje não existe — a listagem varre por `user` e ordena
na memória).

---

# 2. Permissões

| Ação | Autor | Outro | Admin |
|---|---|---|---|
| Ver post público | ✅ | ✅ | ✅ |
| Editar o texto do post | ✅ | ❌ | ❌ |
| Trocar a imagem do post | ❌ | ❌ | ❌ |
| Excluir post | ✅ | ❌ | ✅ |
| Denunciar post | ❌ | ✅ | — |
| Curtir / comentar | ✅ | ✅ | ✅ |
| Ver atividade pública | ✅ | ✅ | ✅ |
| Ver rota de GPS | ✅ | só se `routesPublic` | só com motivo, auditado |
| Editar atividade | ✅ | ❌ | ❌ |
| Mudar privacidade da atividade | ✅ | ❌ | ❌ |
| Ver ficha de saúde | ✅ | ❌ | só com motivo, auditado |
| Alterar senha | ✅ | ❌ | ❌ |
| Banir / suspender | ❌ | ❌ | ✅ |
| Ver e resolver denúncias | ❌ | ❌ | ✅ |

**Editar não troca a imagem, só o texto.** Trocar a foto depois de curtidas e comentários
muda o que as pessoas endossaram — vira outra publicação com o histórico social da anterior.
Quem quer outra imagem publica de novo.

**O admin não edita post de ninguém.** Ele remove ou mantém. Editar o texto alheio permitiria
adulterar o que a pessoa disse, e nenhuma decisão de moderação exige isso.

**Ninguém denuncia o próprio post** — para isso existe excluir.

---

# 3. Mapa do perfil

```
Perfil
├─ Identidade      avatar · nome · @username · bio
├─ Números         treinos (de verdade) · seguidores · seguindo
├─ Consistência    sequência atual · treinos na semana        [só no próprio]
├─ Conquistas      badges                                      [se houver]
├─ Ação            Seguir  |  Editar perfil · ⚙ Configurações
└─ Conteúdo  ─────────────────────────────────────────────────
   [ Treinos ] [ Publicações ] [ Fotos ]
```

## Sobre os nomes das abas

Você sugeriu `Todos | Fotos | Texto | Treinos` e pediu avaliação. Proponho
**`Treinos · Publicações · Fotos`**, e mudo três coisas:

**"Texto" sai.** Ninguém abre um perfil pensando "quero ver os posts sem foto". A aba
existiria por causa de como o dado é guardado, não do que a pessoa procura — é a estrutura
do banco vazando na interface.

**"Todos" sai.** Misturar "treinei 1h12" com "olha essa foto" numa lista só é exatamente a
confusão que estamos desfazendo. Se o produto separa atividade de post, o perfil também deve.

**`Publicações` mostra tudo que virou post**, inclusive treino compartilhado. Se está no
Feed, está aqui — regra simples de prever. Um treino compartilhado aparece em duas abas de
propósito: em `Treinos` porque aconteceu, em `Publicações` porque foi compartilhado.

**"Treinos" vira a primeira aba e a padrão.** É a identidade fitness da pessoa — o que você
descreveu no item 19. Abrir o perfil de alguém e ver a consistência dela é mais forte do que
ver o último post.

## Configurações

Entram por um ⚙ no perfil próprio, agrupadas:

```
Conta          nome · @username · foto · e-mail (só leitura) · alterar senha
Privacidade    treinos públicos · rotas de GPS · quem pode ver o perfil
Notificações   novos posts · interações · desafios · sistema
Sobre          versão · termos · sair da conta
```

`Sair` desce para o fim de tudo e ganha confirmação — hoje ele é um botão solto no perfil,
sem confirmação (`ProfileScreen.tsx:188`), fácil de tocar sem querer.

---

# 4. Fluxo de atividade

```
Registrar treino
      │
      ├─ salva Activity                        (sempre)
      ├─ detecta recordes pessoais             (já existe)
      └─ visibility conforme a escolha da pessoa (ver abaixo)
                │
                ├─ aparece na aba Treinos do perfil       ← a mudança
                ├─ conta no número "treinos"              ← a correção
                └─ NÃO entra no feed de ninguém
                            │
                            └─ tela de conclusão oferece:
                               "Compartilhar no Feed"
                                        │
                                        └─ cria Post vinculado
                                           → entra no feed de quem segue
                                           → notificação para seguidores
```

O `shareToFeed` já faz exatamente isso (`services/activities.ts:77`). O que muda é o
**depois**: hoje a atividade não compartilhada não aparece em lugar nenhum para outras
pessoas. E ganha um caminho novo: `POST /activities/:id/share`, para compartilhar um treino
de ontem — hoje só dá para escolher no instante do registro.

## A pergunta da primeira vez

`activitiesPublic` nasce **`null`**, não `true`. Enquanto ninguém decidiu, a atividade usa o
default atual (`followers`) e **não** aparece publicamente — nenhuma exposição acontece por
omissão.

Na conclusão do **primeiro** treino, depois de salvo:

```
Treino registrado 💪

Quer que seus treinos apareçam no seu perfil?
Outras pessoas poderão ver que você treinou, o esporte, o tempo e o resultado.
A rota de GPS continua privada.

[ Sim, mostrar ]   [ Manter privado ]
                   ajuste isso depois em Configurações
```

Regras que fazem essa pergunta não virar fricção:

- **O treino já está salvo** quando ela aparece. Não é um passo do registro, é uma tela de
  conclusão — fechar sem responder não perde nada e a pergunta volta no próximo treino.
- **Perguntada uma vez.** Respondeu, vira configuração; não pergunta mais.
- **Vale para os próximos**, não muda os treinos anteriores.

---

# 5. Fluxo de denúncia

```
Post de outra pessoa → (...) → Denunciar
        │
        └─ sheet com os motivos → Enviar
                 │
                 ├─ cria Report (status: pendente)
                 ├─ guarda snapshot do conteúdo
                 └─ "Denúncia enviada. Vamos analisar."
                          │
                          ▼
        Painel admin → Denúncias
                 │
                 ├─ agrupadas por alvo (10 denúncias = 1 item com contador)
                 ├─ mostra: conteúdo, autor, quem denunciou, motivos, datas
                 └─ decisão:
                      ├─ Remover post  → deletedAt, some de tudo, autor é avisado
                      └─ Manter post   → status resolvida, decision "mantido"
                                │
                                └─ tudo registrado em AdminAudit
```

**Quem denunciou não é avisado da decisão.** Dizer "sua denúncia foi rejeitada" convida a
discussão e expõe que aquela pessoa denunciou. O autor do post removido **é** avisado — ele
precisa saber o que aconteceu com o conteúdo dele.

---

# 6. Fluxo de notificação

```
Evento  →  regra de relevância  →  destino
```

| Evento | In-app | Badge | Push (fase futura) |
|---|---|---|---|
| Curtiram seu post | ✅ | ✅ | ❌ |
| Comentaram seu post | ✅ | ✅ | ✅ |
| Alguém te seguiu | ✅ | ✅ | ❌ |
| Quem você segue publicou | ❌ | ✅ Feed | ✅ agrupado |
| Entraram no seu desafio | ✅ | ✅ | ❌ |
| Novo desafio disponível | ❌ | ✅ Desafios | ❌ |
| Seu post foi removido | ✅ | ✅ | ❌ |

**Curtida não vira push.** É o evento mais frequente e o menos acionável — é o caminho mais
curto para a pessoa desligar as notificações e nunca mais voltar. Comentário vira, porque
tem alguém esperando resposta do outro lado.

**"Fulano publicou" não vira notificação in-app, só badge.** Quem segue 50 pessoas teria a
lista de notificações inutilizada por publicações. O badge no Feed comunica a mesma coisa
sem ocupar espaço.

## Contra o spam

Três travas, em ordem de importância:

1. **Agrupar por `groupKey`**: "5 novas publicações de quem você segue", nunca 5 linhas.
2. **Janela de silêncio por tipo e por ator**: curtiram seu post 3 vezes em 10 minutos → uma
   notificação atualizada, não três.
3. **Respeitar `settings.notifications`** antes de gravar, não só antes de exibir.

Toda notificação carrega `targetKind` + `targetId` (já existem) e abre direto no destino.

---

# 7. Fluxo de conteúdo novo

```
Conteúdo criado
      │
      └─ nada é incrementado em lugar nenhum
                │
   Usuário abre o app
      │
      └─ GET /read-state  →  para cada área, conta o que veio depois de lastSeenAt
                │
                └─ badge na aba certa:  Feed [3]   Desafios [1]
                          │
                          └─ usuário entra na área e rola até o fim do que é novo
                                    │
                                    └─ POST /read-state/feed  →  lastSeenAt = agora
                                              │
                                              └─ badge some, e só daquela área
```

**Nada é incrementado.** O contador é uma consulta, não um saldo — é isso que garante que ele
nunca fique preso num número errado nem zere sozinho.

**Entrar na aba não marca como visto.** Marcar na abertura zeraria o badge de quem só passou
o olho. A marca acontece quando a pessoa **chega ao conteúdo** que era novo.

---

# 8. Backend: o que reusar e o que criar

## Reusar sem tocar

`requireAuth`, `requireAdmin`, `recordAudit`, `HttpError`, `asyncHandler`,
`utils/cursor.ts` (as duas variantes), `SegmentedControl`, o `AdminAudit` inteiro,
`services/moderation.ts` (inclusive `filtroAutorVisivel()`, que hoje é código morto e passa
a ter uso), e todo o `shareToFeed`.

## Endpoints novos

```
PATCH  /social/posts/:id            editar texto (autor)
DELETE /social/posts/:id            excluir (autor ou admin)
POST   /social/posts/:id/report     denunciar
POST   /activities/:id/share        compartilhar treino de ontem no feed
GET    /social/users/:id/activities atividades públicas de alguém (cursor)
GET    /read-state                  contadores de todas as áreas
POST   /read-state/:area            marcar área como vista
PATCH  /auth/password               trocar senha
GET    /auth/settings               ler configurações
PATCH  /auth/settings               alterar configurações
GET    /admin/reports               fila de denúncias (cursor, filtro por status)
POST   /admin/reports/:id/resolve   remover ou manter
```

## Endpoints que precisam mudar

- **`GET /social/users/:id`** — `counts.posts` vira `countDocuments` de verdade e ganha
  `counts.activities`; o app passa a exibir o número certo sob o rótulo certo.
- **`GET /social/feed`** — hoje não tem paginação por cursor, só `limit` (`social.ts`).
  Precisa de cursor para o badge e o "rolou até o fim" funcionarem.
- **Toda leitura de post** — ganha `deletedAt: null`.
- **`GET /activities/:id`** — passa a respeitar `visibility` mesmo quando há post.

---

# 9. Migração

Três migrações, todas reversíveis, nenhuma destrutiva.

**1. Campos novos com default seguro.** `editedAt`, `deletedAt`, `settings`, `tokenVersion`,
`routeVisible` entram como `null`/default. Post antigo sem `editedAt` não mostra "(editado)",
que é o correto — ele não foi editado.

**2. Visibilidade das atividades antigas.** As atividades existentes têm
`visibility: "followers"` (o default atual). Com `activitiesPublic` ligado por padrão, elas
passariam a aparecer no perfil de quem as registrou **sem que a pessoa tenha decidido isso**.

> **Decisão:** as atividades **anteriores** à mudança ficam como estão. Só as novas nascem
> públicas. Ninguém tem conteúdo exposto retroativamente por causa de uma mudança de default
> — e o perfil oferece "tornar treinos antigos públicos" como ação explícita.

**3. `tokenVersion` sem quebrar sessões.** Tokens já emitidos não têm o campo. A verificação
usa `(payload.v ?? 0) !== user.tokenVersion`, e o default é `0` — nenhuma sessão viva cai no
deploy. Sem isso, subir essa fase desloga a base inteira.

---

# 10. Fases

A ordem segue a dependência real, não a lista de pedidos.

| # | Fase | Entrega |
|---|---|---|
| **1** | **Atividade pública e perfil com abas** | O treino aparece no perfil sem virar post. Contador correto. `Treinos · Publicações · Fotos`. Compartilhar depois. Pergunta de privacidade no primeiro treino. |
| 2 | Controle do próprio post + denúncia | Menu `(...)`, editar, excluir, denunciar, painel de denúncias. |
| 3 | Configurações, senha e privacidade | Área de conta, trocar senha com invalidação de sessão, privacidade de treinos e rotas. |
| 4 | Descoberta e badges | `ReadState`, badge por aba, componente único de badge. |
| 5 | Notificações | Novos tipos, agrupamento, janela de silêncio, preferências ligadas. |
| 6 | Push | Web push, registro de dispositivo, entrega agrupada. |
| 7 | Vídeo: YouTube ou TikTok | Sheet de escolha antes da busca. Pequena e independente — pode entrar a qualquer momento. |

A Fase 1 é a que muda o produto. As outras melhoram o que ela cria.

---

# 11. Componentes que faltam no app

Nenhum destes existe, e quase toda fase precisa deles:

| Componente | Para quê | Quem usa |
|---|---|---|
| `Sheet` | Bottom sheet reutilizável | menu do post, denúncia, escolha de plataforma |
| `MenuSheet` | Lista de ações do `(...)` | post próprio, de terceiro, de admin |
| `Badge` | Contador na aba | Feed, Desafios, Notificações |
| `Toast` | Confirmação não bloqueante | "post excluído", "denúncia enviada" |

Hoje o app tem só `Alert` nativo (`lib/notify.ts`), que é bloqueante e trava a leitura para
dizer "pronto". Cada tela que precisou de sheet reimplementou o seu (`CoachSheet`,
`ExerciseVideoModal`).

**O `(...)` mostra só o que a pessoa pode fazer.** Post próprio: editar, excluir. De outro:
denunciar. Admin em post alheio: denunciar, remover. Ação sem permissão não aparece
desabilitada — não aparece.

---

# 12. Vídeo: YouTube ou TikTok

Hoje, quando não há vídeo em cache, o app já abre a busca do YouTube por fora
(`ExerciseVideoThumb.tsx`, via `Linking.openURL`). A mudança é pequena: antes de abrir,
um sheet com duas opções.

```
YouTube  →  https://www.youtube.com/results?search_query=<exercício>+execução+correta
TikTok   →  https://www.tiktok.com/search?q=<exercício>+execução
```

Sem integração, sem chave de API, sem player embutido para o TikTok. A escolha fica lembrada
para a próxima vez.

---

# 13. Critério de sucesso

O ciclo que precisa fechar depois da Fase 1:

```
registra treino → aparece no perfil → alguém abre o perfil → vê o histórico
   → segue → recebe as próximas → interage → o autor recebe retorno → volta
```

Verificações concretas:

- Registrar um treino **sem publicar** e ver o número de treinos subir e o treino aparecer na
  aba Treinos.
- Abrir o perfil de outra pessoa e ver os treinos dela, com o formato certo por esporte
  (corrida em km e ritmo, musculação em volume).
- Desligar "treinos públicos" e confirmar que somem do perfil, continuam no histórico e
  continuam contando nas estatísticas pessoais.
- Confirmar que a rota de GPS **não** aparece para terceiros com `routesPublic` desligado.
- Confirmar que treinos **anteriores** à mudança não ficaram públicos sozinhos.
