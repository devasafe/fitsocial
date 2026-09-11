# Briefing — cadastro de treino (FitSocial)

## Objetivo

Tela de cadastro de treino que aceite qualquer formato de CrossFit sem
travar o usuário, e que ainda assim gere dado estruturado o suficiente
para rodar timer, score e comparação entre atletas.

A regra que governa tudo: **o campo nunca bloqueia. A estrutura é bônus,
não pedágio.** Se o app não entender o que o coach digitou, salva como
texto e o treino funciona igual, só sem timer automático.

---

## Modelo mental

Um treino é uma **lista de blocos**. Cada bloco tem um MODO e uma lista
de MOVIMENTOS. A maioria dos treinos tem um bloco só; treino de
competição tem vários.

```
TREINO
 └── BLOCO A          MODO: "AMRAP 6'"
      ├── MOVIMENTO   100 Mts Run
      └── MOVIMENTO   2 Rope Climb
 └── BLOCO            MODO: "REST 1'"
 └── BLOCO B          MODO: "AMRAP 6'"
      ├── MOVIMENTO   20 BJO
      └── MOVIMENTO   10 C2B
```

Não existe "tipo de treino" no topo. O topo é só nome + lista de blocos.

---

## Campo MODO

- Input de **texto livre**. Sem select, sem enum fechado.
- Autocomplete alimentado pelo que **aquela conta** já digitou antes,
  ordenado por uso mais frequente/recente.
- Exemplos do que precisa caber: `AMRAP 8'`, `EMOM (1'15") x 4`,
  `FOR TIME 7'`, `5 ROUNDS FOR TIME`, `SKILL / STRENGTH`, `REST 1'`,
  `TABATA`, `21-15-9`.
- Ao salvar, o app **tenta** interpretar o texto (ver "Interpretador").
  Reconheceu: liga timer e define o tipo de score. Não reconheceu:
  guarda o texto e segue.

## Campo MOVIMENTO

Cada movimento tem:

| Campo | Regra |
|---|---|
| Nome | Texto livre + autocomplete da conta. **Sem número junto.** |
| Volume — valor | Número |
| Volume — unidade | reps / tempo / metros / calorias |
| Carga | Número + unidade (kg, lb, % do 1RM, peso corporal). Opcional |
| Altura | Opcional (box jump, wall ball) |
| Escopo | individual / dividido / cada / junto. Padrão: individual |
| Observação | Texto livre, opcional |

**Crítico:** o número não pode entrar no campo de nome. Se o coach
digitar `10 Bíceps Curl` num campo só, o autocomplete vai acumular
`10 Bíceps Curl`, `12 Bíceps Curl`, `15 Bíceps Curl` como exercícios
distintos e morre em um mês. Campo separado; o display junta os dois na
hora de mostrar.

Aceitar colagem tipo `21-15-9` no campo de valor, virando lista.

## Escopo do volume (treino em dupla/time)

O treino tem um campo "tamanho do time" (padrão 1). Quando for maior
que 1, o seletor de escopo aparece em cada movimento:

- **individual** — cada um faz o volume cheio (padrão)
- **dividido** — o volume é repartido entre o time ("Relay")
- **cada** — o volume é por atleta, total = valor × tamanho do time
- **junto** — fazem simultaneamente, conta uma vez

Isso muda a matemática do volume total e do ranking. Sem esse campo o
app conta errado em qualquer treino de dupla.

---

## Interpretador do MODO

Roda no salvamento, nunca durante a digitação. Extrai, quando
reconhecer:

- estrutura de tempo (duração total, intervalo, rounds, time cap)
- tipo de score sugerido
- se é descanso entre blocos

Mapeamento de score por estrutura reconhecida:

| Estrutura | Score sugerido |
|---|---|
| AMRAP | rounds + reps |
| FOR TIME / rounds for time | tempo |
| EMOM / TABATA / intervalado | reps |
| SKILL / STRENGTH | carga |
| REST | nenhum |
| não reconhecido | usuário escolhe, ou texto livre |

O score sugerido é sempre sobrescrevível. Existe score "customizado"
com descrição em texto, para casos tipo "soma do pior round".

`REST` vira um bloco de verdade, com duração, para o timer emendar um
bloco no outro sem o usuário tocar em nada.

---

## Autocomplete

- Escopo: **por conta**, não global.
- Guarda modo e nome de movimento em coleções separadas.
- Ordena por frequência de uso, com desempate pelo mais recente.
- Nunca sugere nada na primeira vez; enche sozinho com o uso.

---

## Preview

Renderizar o treino de volta no formato do quadro do box, sempre
visível durante o cadastro. É o teste de aceite: **se o preview não sai
igual ao que o coach escreveria no quadro, tem informação faltando ou
mal colocada no modelo.**

---

## Não fazer

- Select fechado de formato de treino
- Impedir salvar porque o modo não foi reconhecido
- Número dentro do campo de nome do movimento
- Jogar informação semântica (colete, "cada", "dividido", descanso) em
  campo de observação — se a IA ou o ranking precisa ler, é campo
- Criar tipo novo de bloco para cada variação (tabata simples vs tabata
  múltiplo, etc.)

---

## Critérios de aceite

Precisa cadastrar e reproduzir no preview, idênticos ao original:

1. `21-15-9` Thruster 43/30kg + Pull-up — escada compartilhada
2. `AMRAP 20'` Cindy — 3 movimentos, reps fixas
3. `3 ROUNDS FOR TIME` 400m Run + 21 KB Swing + 12 Pull-up — volumes
   mistos (metros e reps no mesmo bloco)
4. `5 ROUNDS FOR TIME` DT — reps diferentes por movimento
5. Murph — chipper longo, com colete, reps particionáveis
6. Força + Metcon no mesmo treino — dois blocos, scores diferentes
7. `EMOM (1'15") x 4` — modo fora de qualquer padrão comum
8. Fight Gone Bad — 3 rounds, 1min por estação, máx reps
9. Death by Burpee — EMOM até falhar, reps crescentes
10. O WOD de dupla: BLOCO A `AMRAP 6'` (Relay) + `REST 1'` + BLOCO B
    `AMRAP 6'` (Relay) + `REST 1'` + `FOR TIME 7'` com 400m Run
    *together*, 2 Rope Climb *cada*, 40 BJO, 20 C2B

---

## Decisão pendente

Carga: **um campo** (coach digita `43/30`) ou **dois campos**
(masculino e feminino separados)?

- Um campo: rápido de preencher, mas o app nunca vai conseguir mostrar
  automaticamente o peso certo pro atleta.
- Dois campos: chato de preencher todo dia, mas destrava prescrição
  personalizada e ranking por categoria.

Decidir antes de começar, porque muda o schema.

---

## Fora de escopo nesta etapa

- Parser por IA do WOD colado em texto
- Ranking e comparação entre atletas
- Registro do resultado do atleta (é outra tabela, outro fluxo)
