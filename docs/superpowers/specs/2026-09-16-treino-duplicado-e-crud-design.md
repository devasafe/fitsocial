# Treino duplicado e CRUD do próprio treino — desenho

**Data:** 16/09/2026
**Problema relatado pelo dono:** "as pessoas estão postando muito dois treino sem querer". Caso
concreto: a pessoa finalizou o treino, bloqueou a tela para ir até o espelho, voltou, viu o
botão de finalizar de novo e clicou — e o treino contou duas vezes.

## O que eu encontrei

**Três rotas criam treino** — `POST /activities` (duas variantes) e `POST /checkins` — e
**nenhuma consegue distinguir uma repetição de um treino novo.** Não existe chave de
idempotência em lugar nenhum do sistema.

O que **não** é a causa: o botão de finalizar já se desabilita durante o envio
(`components/ui.tsx`, `const off = disabled || loading`), e `useConclusaoDeTreino` usa
`nav.replace` justamente para o formulário sair da pilha. Os dois cuidados existem e estão
certos. Eles protegem contra duplo-toque e contra "voltar" dentro da navegação — e **não**
protegem contra o processo ser recarregado ou restaurado, que é o que acontece quando se
bloqueia a tela do celular.

O rascunho do check-in é apagado do `AsyncStorage` ao concluir, o que também está certo. Mas
nada disso alcança o servidor: se um segundo pedido chegar, ele grava.

**Conclusão:** a proteção precisa estar onde o dado nasce, não na tela. Qualquer conserto
apenas de UI deixa as outras portas abertas, e eu não consigo enumerar todas as formas de um
navegador de celular recarregar uma página.

## O que um treino toca (mapeado, e é o que torna "apagar" não-trivial)

`services/activities.ts` → `createActivity`:

1. Cria o `Activity`.
2. Detecta recordes (`detectPRs`), que cria `PersonalRecordEvent` e atualiza `PersonalRecord`.
3. **Denormaliza** o resumo do recorde dentro do próprio `Activity` (para o cartão de
   compartilhar não consultar o banco a cada montagem).
4. Opcionalmente cria um `Post` ligado àquele treino.

Constância, streak, total e os gráficos de evolução são **calculados na leitura** a partir dos
`Activity` — então se corrigem sozinhos quando um treino some. `recomputeUserPRs`
(`services/prEngine.ts:466`) apaga e reconstrói os recordes de uma pessoa do zero; é a peça que
torna apagar e editar seguros.

## Decisões do dono

1. **Apagar treino apaga o post junto**, com curtidas e comentários. Um post que conta um
   treino que não aconteceu é uma mentira no feed dos outros.
2. **Editar alcança tudo, inclusive os números** (peso, repetições, distância). Corrigir um
   peso digitado errado é o caso mais comum. Mexer nos números refaz os recordes.
3. **Chave de idempotência + rede curta no servidor.** A chave protege quem atualizar o app; a
   rede alcança o APK 1.2.0 que já está instalado e não atualiza sozinho.

## Desenho

### 1. Chave de idempotência

O cliente gera um identificador **quando a pessoa começa o treino** — não quando ela salva — e
manda no corpo do envio. Começar é o evento que acontece uma vez; salvar é o que se repete.

- `Activity` ganha `clientKey?: string`, com índice **único e esparso** por `{user, clientKey}`.
  Esparso porque todo treino que já existe não tem chave, e um índice único sobre `null`
  repetido recusaria o segundo.
- Chegando um envio cuja chave já existe para aquele usuário: **devolve o treino existente**,
  com `201`→`200` e um campo em `meta` dizendo que foi reconhecido como repetição. Não é erro:
  do ponto de vista de quem clicou, o treino está salvo — que é a verdade.
- O campo é **opcional**. Cliente que não manda continua funcionando exatamente como hoje.

### 2. Rede curta, para quem não atualizou o app

Antes de criar, o servidor procura um treino do mesmo usuário com:

- o **mesmo `kind` e o mesmo `sportId`**,
- a **mesma impressão digital do conteúdo** (um hash estável do que define o treino: exercícios,
  séries, pesos, repetições, distância, duração),
- criado há **menos de 10 minutos**.

Achando, devolve o existente em vez de criar. Mesma resposta da chave.

**O risco desta regra, e por que eu a aceito:** ela pode engolir um treino legítimo. Para isso
acontecer, a pessoa precisa registrar dois treinos do mesmo esporte com **exatamente** os
mesmos exercícios, pesos e repetições, em menos de dez minutos. Isso não é "treinei duas vezes
hoje" — é o mesmo treino enviado duas vezes.

**A saída, mesmo assim:** o corpo aceita `mesmoAssim: true`, que pula a rede. O app novo manda
isso quando a pessoa confirma "foi outro treino". O APK antigo não manda — e é justamente nele
que a rede precisa valer.

**Fora da rede:** `sportId` cuja natureza é repetir (se houver) e treinos com `startedAt`
informado pela pessoa (registro retroativo de dois dias iguais é plausível). A rede olha só o
que foi criado agora.

### 3. Apagar

`DELETE /activities/:id`, só do dono (404 para o resto, não 403 — 403 confirmaria que o treino
existe).

Em ordem:
1. Apaga o `Post` ligado àquele treino, se houver, com os comentários e curtidas dele.
2. Apaga o `Activity`.
3. `recomputeUserPRs(userId)` — reconstrói os recordes do zero, o que remove recorde que só
   existia por causa daquele treino.

Constância, streak, total, calendário e os gráficos não precisam de nada: são derivados.

**O aluno com profissional:** apagar continua livre. O treino é dele; o profissional acompanha,
não é dono. (Diferente da dieta, onde a trava existe porque o profissional **escreve**.)

### 4. Editar

`PATCH /activities/:id`, só do dono.

Editável: `title`, `startedAt`, `durationSec`, `perceivedEffort`, `feeling`, `notes`,
`visibility`, e o `payload` (os números).

Quando o `payload` muda:
- recalcula `metrics` pelo mesmo caminho do `createActivity` (`computeMetrics`, `preencherSlugs`
  para força, `interpretarBlocos` para WOD) — **reaproveitando as funções existentes**, não
  reescrevendo;
- `recomputeUserPRs(userId)` e regrava o resumo de recorde denormalizado no treino.

**O que NÃO se edita:** `kind` e `sportId`. Trocar um treino de força por uma corrida é outro
treino — apaga e registra. Isso evita um payload incoerente com o tipo.

**O post ligado:** editar o treino não reescreve a legenda que a pessoa escreveu. Se os números
mudam, o card do feed passa a mostrar os novos — é o mesmo treino, corrigido.

### 5. A tela

Na tela de detalhe do treino (`ActivityDetailScreen`), para o dono: "Editar" e "Apagar".
Apagar pede confirmação e **diz o que vai junto** — se existir post com interação, a
confirmação nomeia isso ("o post com 4 comentários também será apagado"), porque é irreversível
e a pessoa precisa saber antes, não depois.

## Fora deste desenho

- Achar **qual** caminho da UI produziu o duplicado do amigo do dono. A idempotência protege
  independente da resposta, e caçar sem instrumentação é palpite. Entra depois, com telemetria:
  contar quantas repetições a chave e a rede barram, por caminho, diz onde o defeito mora.
- Desfazer ("apaguei sem querer"). Apagar é irreversível por decisão; uma lixeira é outro
  desenho.
- Editar treino de outra pessoa, ou o profissional editar o do aluno.
