# Editar a ficha — relatório

## Status

Concluído. Backend (GET/PATCH da ficha) e tela do app implementados, testados e verificados.

## Decisão: onde as rotas moram

Criei `api/src/routes/ficha.ts`, registrado em `/ficha` (`app.ts`), separado de
`onboarding.ts`. Onboarding é o EVENTO de preenchimento inicial (e continua
sendo — `POST /onboarding/profile` não mudou); ficha é o DADO, que agora pode
ser lido e editado depois desse evento. Misturar os dois num arquivo só ia
confundir "criar pela primeira vez" com "atualizar o que já existe", que têm
regras diferentes (o PATCH nunca faz upsert — ver abaixo).

Nomeei a rota `ficha`, e não `profile`, porque `Profile` (o model) já convive
com outro conceito chamado "perfil" no app — identidade (nome, foto, bio),
editada por `PATCH /auth/me` via `EditProfileScreen`. Usar "profile" para os
dois ia gerar confusão entre "perfil = quem você é" e "perfil = ficha de
treino". "Ficha" é como o próprio pedido do dono chamou a coisa.

## O que foi feito

**Backend** (`api/src/routes/ficha.ts`):
- `GET /ficha` — devolve `{ data: <ficha> | null, meta: {} }`. `null` quando a
  pessoa não preencheu (não é erro — mesmo padrão que `GET /billing` usa para
  assinatura ausente).
- `PATCH /ficha` — edição parcial. Valida com `profileDataSchema.partial()`
  (zero duplicação de regra: mesmas faixas de idade/altura/peso/dias que o
  onboarding já usa). Escreve com `$set` só dos campos mandados — os que não
  vieram no corpo simplesmente não são tocados no Mongo, então sobrevivem.
- **Sem upsert no PATCH.** Se a pessoa não tem ficha, o PATCH responde `404`
  em vez de criar uma ficha pela metade. Um documento sem `goal` (porque só
  esse campo nunca foi mandado) ia quebrar o `planGenerator`, que espera a
  ficha inteira.
- As duas rotas filtram por `req.user._id` — não existe caminho para ler ou
  editar a ficha de outra pessoa.
- Nada da ficha loga: sem `console.log`/similar tocando o corpo da requisição
  ou o documento (é dado de saúde — peso, altura, lesões).

**Não fiz o gatilho de regeneração automática de plano.** `PATCH /ficha` só
atualiza o dado. `POST /plans/generate` já existia e já recusa sozinho quando
o treino/dieta é de profissional (mensagem "quem escreve o seu treino é o seu
treinador..." — `plans.ts`); não toquei nessa trava, só reaproveitei o
endpoint.

**Frontend** (`app-android/`):
- `src/api/ficha.ts` — client fino (`getFicha`, `updateFicha`), reaproveitando
  o tipo `ProfileForm` que o onboarding já definia.
- `src/screens/EditarFichaScreen.tsx` — formulário nos mesmos moldes do
  `OnboardingForm` (chips para objetivo/sexo/experiência/dias/minutos, campos
  numéricos para idade/altura/peso, texto livre para restrições/lesões/notas),
  mas: carrega a ficha atual no `GET` ao focar a tela, salva com `PATCH`, e
  **depois de salvar oferece** — via `confirmDialog`, nunca automático —
  gerar um plano novo com `generatePlan` (o mesmo client que a Home já usa).
  Recusa de profissional ou de limite de plano (402 → Assinatura) chegam pela
  mesma mensagem/fluxo que a Home já trata.
- **Onde a tela fica:** entrada em `ConfiguracoesScreen`, seção "Treino",
  linha "Sua ficha" (`nav.navigate("Ficha")`), antes de "Como você treina".
  Escolhi Configurações porque é onde "as coisas minhas" já vivem — é a
  mesma tela que tem "Editar perfil", "Alterar senha", privacidade e
  notificações — em vez de enterrar a ficha dentro do perfil público
  (`ProfileScreen`) ou duplicar entrada em outro lugar.
- Rótulos são descritivos, não avaliativos ("Peso em kg", "Altura em cm") —
  nenhum "acima do peso" ou "ideal", conforme `docs/VISAO.md`.
- `Ficha: undefined` adicionado a `AppStackParams`
  (`navigation/types.ts`) e a tela registrada em `RootNavigator.tsx`.

## TDD — RED antes do GREEN

Escrevi `api/src/routes/ficha.test.ts` (9 casos) antes de criar `ficha.ts`.
Rodando contra a rota inexistente, o RED foi:

```
AssertionError: expected 404 to be 200  // GET sem ficha esperava 200+null, rota não existia
AssertionError: expected 404 to be 401  // PATCH sem token esperava 401, rota não existia
... (7 de 9 falhando, todos por 404 — a rota simplesmente não existia)
```

Depois de implementar `ficha.ts` e registrar em `app.ts`, sobrou 1 falha —
mas era um bug do MEU teste, não do código: eu fazia `Profile.findOne({})`
sem filtrar por usuário, e como o Mongo em memória é compartilhado entre os
testes do arquivo, pegava qualquer ficha do banco, não necessariamente a do
teste em questão. Corrigi para `Profile.findOne({ user: userId })` (usando o
`id` que `POST /auth/register` já devolve) e todos os 9 passaram.

## Testes mínimos pedidos — cobertos

- Ler a ficha de quem tem ✓
- Ler de quem não tem (`data: null`) ✓
- Editar um campo só e os outros sobreviverem ✓ (é o teste que mais importa
  aqui, dado o histórico do projeto com esse tipo de bug)
- Recusar valor fora da faixa com 400 (testei `daysPerWeek: 9`) — e confirmei
  que nada foi alterado no banco nesse caso ✓
- Não ler nem editar a ficha de outra pessoa ✓ (2 testes: GET devolve `null`
  para quem não é dono, PATCH devolve `404` para quem não tem ficha própria)

Tela: **não escrevi teste** — `app-android/` não tem runner de teste de tela,
confirmei isso antes de começar em vez de fingir que rodei algo.

## Verificação

- `cd api && npx vitest run` → **95 arquivos, 1205 testes, saida=0** (suíte
  inteira, incluindo os 9 novos de `ficha.test.ts` e os 3 de
  `onboarding.test.ts`, intactos).
- `cd api && npx tsc --noEmit` → **saida=0**
- `cd app-android && npx tsc --noEmit` → **saida=0**
- `cd app-android && npm run checar-cores` (Node 22.21.1 confirmado antes de
  rodar) → **PALETA OK, saida=0**

## Preocupações

1. **Frontend manda o formulário inteiro no PATCH**, não um diff dos campos
   alterados — porque a tela pré-carrega a ficha inteira via GET antes de
   editar, então "campo não tocado" já chega preenchido com o valor atual, e
   não há como um campo sumir por esquecimento de envio. O backend, por outro
   lado, aceita e testa PATCH de verdade parcial (útil para qualquer cliente
   futuro — admin, outra tela, etc.) — é a garantia mais forte, e a tela só
   não precisou dela para este fluxo específico.
2. Não achei nada no pedido que estivesse errado ou destampado; segui direto.
