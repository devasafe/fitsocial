# Painel do nutricionista

> Desenho aprovado em 15/09/2026. Nada implementado ainda.
> Frente 3 do épico Pro. A Fase 2 (Pro Coach) está no ar desde 12/09; esta é a irmã dela.
> Consome o que a frente 2 construiu: [`2026-09-15-progresso-nutricao-design.md`](./2026-09-15-progresso-nutricao-design.md).

---

# A. O problema, dito com precisão

O pedido veio assim: *"quem tem o plano pro coach tem acesso ao painel coach da pessoa, e quem
tem o plano pro nutri tem que ter acesso ao painel nutri. Pode ser até no mesmo domínio, mas
tem que ser painéis diferentes, respectivos com suas funções."*

O diagnóstico está certo, e o estado é mais desequilibrado do que parece: **o nutricionista
existe por inteiro na camada de permissão e não existe em nada na camada de função.**

| Camada | Estado |
|---|---|
| Papel `nutri` em `PAPEIS_PRO` | Existe |
| Capacidade `User.pro.nutri`, com limite de alunos próprio | Existe |
| SKU `pro_nutri` no catálogo, e `requirePro("nutri")` | Existem |
| Convite de nutri, aberto e endereçado | Existe e funciona (`Convites.tsx` gera "link de nutrição") |
| `escopo.dieta` no vínculo, e `podeVer(..., "dieta")` | Existem |
| **Alguma rota que leia `escopo.dieta`** | **Nenhuma** |
| **Prescrição de dieta** | **Nenhuma** |
| **Qualquer tela de nutrição no painel `pro/`** | **Nenhuma** |

E há um bloqueio duro: **todas as seis rotas de leitura do aluno** passam por
`alunoComTreinosAbertos` (`routes/pro.ts:272`), que exige `escopo.treinos === true`. Um
nutricionista cujo aluno abriu só a dieta leva **403 em todas elas** — ele não consegue nem
abrir a ficha.

O comentário daquela função já antecipa isto: o parâmetro `preferido` existe *"para o erro
continuar dizendo a verdade a quem é nutri do aluno"*. Quem a escreveu sabia que este dia
chegaria.

---

# B. Decisões travadas

| # | Decisão | Por quê |
|---|---|---|
| B1 | **O vínculo com cada aluno decide o painel**, não um seletor de modo | `ProfessionalLink` já tem `papel`, e o índice único é `{professional, client, papel}` justamente para a mesma dupla ter dois vínculos. A lista de alunos já sabe o papel de cada um; pedir à pessoa que lembre em que modo está é inventar um estado para ela errar |
| B2 | **Trava de autoria espelhada**: com nutricionista ativo, a IA para de escrever dieta | Mesma regra e mesmo motivo do treino (`recusarSeTemTreinador`). Prescrição que troca sozinha é o aluno descobrir de manhã que está comendo outra coisa — e o nutri respondendo por um plano que ele não escreveu |
| B3 | **O escopo granular passa a valer de verdade**: a ficha exige vínculo ativo, e cada bloco aparece conforme o escopo daquele vínculo | É para isso que `escopo.{treinos,dieta,medidas,fotos}` foi construído, e hoje ele é promessa vazia. Nutricionista sério olha treino — gasto calórico depende de volume — mas quem decide é o aluno |
| B4 | **A ficha do nutri mostra aderência + dieta atual + conversa** | O gráfico de aderência já existe (frente 2) e está sem uso do lado profissional. Sem ele, o nutri prescreve no escuro e a próxima prescrição é chute |
| B5 | **A prescrição é por formulário estruturado**, não por texto livre | `dietSchema` é estrito (calorias, macros, refeições com itens). O formulário garante que o que entra é válido, e a conversão por IA faria o nutri assinar um número que ele não escreveu |

---

# C. O que reusar sem tocar

Esta é a parte boa: quase tudo que o painel precisa já está de pé.

| O que o painel do nutri precisa | O que já existe |
|---|---|
| Login, sessão, guarda de acesso | `pro/src/pages/Entrar.tsx`, `App.tsx`, `requirePro` |
| Lista de alunos com triagem "quem precisa de mim hoje" | `pro/src/pages/Alunos.tsx`, `GET /pro/alunos?papel=` |
| Convite por link e por @, com aceite do aluno | `Convites.tsx`, `POST /pro/convites`, `POST /pro/convites/:code/aceitar` |
| Conversa com foto e não-lidas | `Conversa.tsx`, `GET/POST /pro/acompanhamentos/:id/mensagens` |
| **Aderência à dieta no tempo** | **`services/nutricao.ts` — `evolucaoDeNutricao` e `alvosPorDia`** |
| Gráfico de série temporal | `pro/src/components/Grafico.tsx` (recharts) |
| Padrão de prescrição que cria versão e avisa pela conversa | `PUT /pro/alunos/:id/treino` (`routes/pro.ts:820`) |
| Forma do formulário de dieta | `app-android/src/screens/EditDietScreen.tsx` |

---

# D. A guarda, generalizada

O coração da mudança, e a única parte que toca o painel do coach que já está no ar.

`alunoComTreinosAbertos(req, id, preferido?)` vira `alunoDoProfissional(req, id, opts)`, onde
`opts` diz **qual parte** a rota precisa:

```ts
async function alunoDoProfissional(
  req: …,
  id: string,
  opts: { parte?: "treinos" | "dieta"; preferido?: PapelPro } = {}
): Promise<{ link: LinkAtivo; clientId: ObjectId }>
```

- **Sem `parte`**: exige apenas vínculo ativo. É o caso da ficha, que precisa abrir para
  qualquer profissional do aluno e mostrar o que o escopo permitir.
- **Com `parte`**: exige `escopo[parte] === true` naquele vínculo, e é o caso de cada rota de
  dado. A escolha entre vínculos continua sendo a de hoje (preferir o papel pedido, depois o
  que abre a parte), porque quem acompanha a mesma pessoa como coach **e** como nutri tem dois
  vínculos com escopos diferentes.
- Os erros continuam distintos e continuam dizendo a verdade: **404** "Este não é seu aluno"
  quando não há vínculo, **403** "Este aluno não abriu os treinos para você" (ou a dieta)
  quando há vínculo e o escopo está fechado. A diferença entre *"não treinou"* e *"não me
  deixou ver"* é exatamente o que o profissional precisa saber.

**O que muda para o coach**, e é melhoria: hoje, coach cujo aluno fechou os treinos leva 403 na
ficha inteira. Passa a abrir a ficha e ver o que pode. Na prática quase ninguém cai nisso —
`escopo.treinos` nasce `true` —, mas o caso existe e hoje é uma parede.

`GET /pro/alunos/:id` passa a montar a resposta por escopo: `perfil` e `vinculo` sempre;
`constancia`, `exercicios` e `calendario` só com `escopo.treinos`; o bloco de nutrição só com
`escopo.dieta`. Campo ausente, não campo vazio — a diferença importa pelo mesmo motivo do 403.

---

# E. As rotas novas

As duas de **leitura** ficam sob `requirePro("coach", "nutri")`, como as demais do painel — quem
de fato limita ali é o `parte: "dieta"` da guarda, não a capacidade. A de **escrita** é
`requirePro("nutri")`, espelho exato do `PUT …/treino`, que é `requirePro("coach")`: quem
prescreve dieta é nutricionista, mesmo que a pessoa também seja coach de alguém.

```
GET  /pro/alunos/:id/nutricao?dias=30
```
Chama **a mesma** `evolucaoDeNutricao(clientId, dias)` que responde ao aluno. Envelope
`{ data, meta }` com o `metaDaJanela` de sempre — sem gate de plano, porque o profissional não
paga a janela do aluno (é o mesmo tratamento que o painel do coach dá à evolução de treino).

```
GET  /pro/alunos/:id/dieta
```
A dieta corrente do aluno (`Plan.diet` da versão mais nova), mais quem a escreveu
(`Plan.createdBy`) e quando. O nutri precisa saber se está olhando a própria prescrição, a de
outro profissional, ou uma dieta que a IA gerou antes de ele chegar.

```
PUT  /pro/alunos/:id/dieta
```
`requirePro("nutri")` — espelho exato do `PUT …/treino`, que é `requirePro("coach")`.

Corpo validado pelo `dietSchema` que já existe, mais um `recado` opcional. E faz o mesmo que a
prescrição de treino faz:

1. **Cria versão nova** do `Plan` (`version: atual.version + 1`), com `createdBy` do
   profissional. **Isto é obrigatório, não estético** — a frente 2 depende da versão para saber
   qual meta valia em cada dia. Se a prescrição editasse no lugar, o histórico de meta se
   perderia exatamente no caso em que mais importa.
2. **Preserva o treino** (`workout: atual?.workout ?? null`), incluindo a agenda de dias que o
   aluno montou. As duas metades do plano são independentes.
3. **Avisa pela conversa**: uma `ProMessage` do nutricionista com o resumo da dieta, o recado
   opcional e push. Plano que troca sozinho na Home é a pessoa descobrir de manhã que está
   comendo outra coisa.

---

# F. A trava de autoria da dieta

Espelho de `recusarSeTemTreinador`, em `routes/plans.ts`:

```ts
async function recusarSeTemNutricionista(userId) {
  if (await temProfissional(userId, "nutri"))
    throw new HttpError(409, "Quem escreve a sua dieta é o seu nutricionista. Fale com ele pelo acompanhamento para mudar o plano.");
}
```

Aplicada nas portas que escrevem dieta, que são as que hoje estão todas abertas:

| Porta | Hoje | Passa a |
|---|---|---|
| `POST /plans/diet` | Aberta (gate só econômico) | Recusa com nutri ativo |
| `PUT /plans/current` com `{diet}` | Aberta | Recusa com nutri ativo |
| `DELETE /plans/current/:parte` com `diet` | Aberta | Recusa se a dieta tem `createdBy` (espelha `recusarSeForDoTreinador`) |
| `action: "adjust_diet"` do chat do coach IA | Aberta (`services/ai/coach.ts`) | Recusa com nutri ativo |

O `DELETE` é a exceção pelo mesmo motivo do treino: dieta sem `createdBy` (feita pela IA) pode
ser zerada, senão quem tinha dieta antiga e contratou nutricionista ficaria preso a ela.

`GET /plans/hoje` já devolve `podeEditarPlano` derivado de `temProfissional(id, "coach")`. Ganha
o irmão para a dieta, para o app saber o que desabilitar em vez de deixar a pessoa tentar e
levar 409.

---

# G. O painel

`pro/src/pages/Aluno.tsx` hoje tem as abas `evolucao | treino | conversa`. Elas passam a ser
escolhidas **pelo papel do vínculo**, que já vem em `buscarAluno`:

```
vínculo de coach  →  Evolução · Treino · Conversa        (o que já existe, intacto)
vínculo de nutri  →  Nutrição · Dieta · Conversa         (novo)
os dois vínculos  →  Evolução · Treino · Nutrição · Dieta · Conversa
```

- **Nutrição** — o gráfico de aderência (kcal contra a meta, com o buraco dos dias sem registro
  visível), a contagem honesta "X de N dias registrados", e as barras de macro. Mesmas regras de
  leitura da tela do aluno, porque é a mesma função respondendo.
- **Dieta** — a dieta corrente, quem escreveu e quando, e o formulário de prescrição.
- **Conversa** — o componente que já existe, sem mudança.

`Alunos.tsx` já aceita `?papel=` e já mostra a triagem por dias sem atividade. Para o nutri, o
sinal de "precisa de mim" não é "sumiu do treino" e sim **"parou de registrar comida"** — o
`diasComRegistro` da janela responde isso, e entra no lugar do `ultimoEm` de treino quando o
vínculo é de nutri.

---

# H. Compatibilidade

| Risco | Veredito |
|---|---|
| Painel do coach em produção | A ficha passa a ter campos condicionais que hoje são sempre presentes. Como `escopo.treinos` nasce `true`, na prática nada muda — mas o painel precisa tolerar a ausência |
| APK 1.2.0 instalado | A trava da dieta é **mudança de comportamento visível**: quem tem nutricionista passa a levar 409 onde antes gerava. O APK não desabilita o botão, então mostra o erro. É o mesmo que aconteceu com o treino, e o buraco conhecido é o mesmo: o botão falha em silêncio numa tela que não desenha erro. Aceito e registrado |
| `escopo.dieta` nasce `false` | Um aluno que aceitar convite de nutri **precisa** marcar a dieta no aceite, senão o profissional não vê nada. A tela de aceite já oferece o escopo; o texto dela precisa deixar claro o que cada caixa libera |
| Dieta escrita antes do nutri chegar | Continua valendo e continua visível. O `createdBy` é quem diz de quem é |

---

# I. Testes

Integração com Mongo em memória, como todo endpoint novo:

- nutri com `escopo.dieta` abre a ficha e recebe o bloco de nutrição;
- nutri **sem** `escopo.dieta` recebe 403 na rota de nutrição, e 404 quando não é vínculo dele;
- nutri sem `escopo.treinos` abre a ficha **sem** os blocos de treino, em vez de 403;
- coach sem `escopo.treinos` também abre a ficha sem eles (o caso que hoje é parede);
- quem é coach **e** nutri do mesmo aluno vê os dois conjuntos;
- `PUT …/dieta` cria versão nova, preserva o treino **e a agenda de dias**, e grava uma
  `ProMessage`;
- `PUT …/dieta` com `requirePro("coach")` apenas → 403;
- com nutricionista ativo, `POST /plans/diet` → 409, e a mensagem nomeia o acompanhamento;
- `DELETE /plans/current/diet` continua permitido quando a dieta não tem `createdBy`;
- **a resposta de `/pro/alunos/:id/nutricao` é idêntica à de `/nutrition/evolucao`** para o
  mesmo usuário e janela. É a regra do projeto: os dois lados chamam a mesma função, e o teste
  quebra se divergirem.

---

# J. Fora de escopo

- **Peso, medidas e fotos de progresso** — é a fatia que dá conteúdo a `escopo.medidas` e
  `escopo.fotos`, hoje vazios. O nutricionista é quem mais precisa, e por isso ela vem logo
  depois desta.
- **Colar a dieta e a IA estruturar** — fica para depois, e só com revisão obrigatória antes de
  salvar.
- **O diário dia a dia do aluno** (o que ele comeu, item por item) — é dado íntimo em volume, e
  merece decisão própria, não de passagem.
- **Chat entre coach e nutri do mesmo aluno** — é a frente 4 do épico Pro.
- **`POST /plans/diet` não criar versão** — a decisão de produto segue pendente. Esta frente
  não depende dela: a prescrição do nutri cria versão por conta própria, que é o que a frente 2
  precisava. A dívida continua valendo para quem gera dieta por IA.
