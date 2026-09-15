# Progresso de nutrição — aderência ao longo do tempo

> Desenho aprovado em 15/09/2026. Nada implementado ainda.
> Primeira fatia do pilar nutrição no tempo. Peso, medidas e fotos ficam para a fatia
> seguinte; o painel do nutricionista ([frente 3](#j-o-que-a-frente-3-vai-consumir))
> consome o que está desenhado aqui.

---

# A. O problema, dito com precisão

O pedido veio assim: *"criar o progresso de nutrição do usuário, lembrando de adicionar
quando ele errar — hoje falhei na dieta, aí adiciono lá também, justamente pra criar um
gráfico realista."*

O diagnóstico está certo, mas a causa é outra. **O gráfico mentiria mesmo que ninguém
falhasse**, porque quem come mal não abre o app naquele dia. O dado que falta não é a
falha — é o dia inteiro. Um botão de "falhei" resolveria o caso em que a pessoa está
disposta a se declarar; não resolve o caso comum, que é o silêncio.

Então o desenho ataca o silêncio, não a falha. São três movimentos:

1. o dia sem registro **aparece como buraco**, nunca como zero e nunca omitido;
2. a tela mostra **quantos dias foram registrados** com o mesmo destaque da média;
3. existe um **atalho para preencher ontem e anteontem**, enquanto a memória serve.

Isto também respeita o guardrail do [`VISAO.md`](../../VISAO.md), que é inegociável:
*"Nenhum texto do app usa linguagem de vergonha corporal nem pune quem 'falhou' na
dieta."* Não existe categoria "falhei" em lugar nenhum deste desenho. A pessoa registra
a pizza como registra o frango, e o desvio aparece sozinho como distância da meta.

---

# B. O que já existe e não será reconstruído

| Peça | Onde | Estado |
|---|---|---|
| `FoodLog` | `api/src/models/FoodLog.ts` | Completo: `user`, `date` (yyyy-mm-dd), `meal`, `name`, `kcal`, `proteinG`, `carbsG`, `fatG`, `gramas`, `origem`, `imageUrl` |
| Registro de alimento | `POST /nutrition/logs` | Aceita `date` livre — já grava em dia passado |
| Dia isolado | `GET /nutrition/day?date=` | Devolve `logs`, `totals` e `target` do `Plan.diet` |
| Recentes | `GET /nutrition/recent-foods` | Servidor autoritativo + cache local |
| Meta | `Plan.diet` | `dailyCalories` + `macros{proteinG,carbsG,fatG}` + `meals` |
| Telas | `DiarioScreen`, `QuickFoodAdd`, card da Home | Registro manual, por foto e por recentes |
| Gráfico | `components/LineChart`, `Heatmap` | Já usados na evolução de treino |
| Padrão de janela + gate | `services/evolucao.ts`, `routes/evolucao.ts` | `JANELA_DO_GRATIS = 7`, `janelaPermitida()` que **corta em vez de recusar** |

**Não existe nada de histórico de nutrição.** Sem série temporal, sem model de peso
corporal (o `Profile.weightKg` é um valor único do onboarding), sem medidas, sem fotos.

---

# C. Decisões travadas

| # | Decisão | Por quê |
|---|---|---|
| C1 | A métrica é **aderência**: kcal e macros contra a meta | É o que o dado já sustenta, sem model novo — e é o que o nutricionista precisa ver |
| C2 | Peso, medidas e fotos ficam **para a fatia seguinte** | É onde o escopo `medidas`/`fotos` do `ProfessionalLink`, hoje vazio, ganha conteúdo |
| C3 | Dia sem registro é **`null`, nunca `0`** | `0` é uma afirmação sobre a comida; `null` é a ausência de afirmação. É a diferença entre "comeu pouco" e "não registrou" |
| C4 | A meta é resolvida **por dia**, pela versão do `Plan` ativa naquela data | Sem isso, o nutricionista apertar a meta hoje pinta o passado inteiro de vermelho, sem a pessoa ter feito nada |
| C5 | O atalho retroativo cobre **ontem e anteontem** | Janela em que a memória ainda serve. Mais que isso troca um viés por outro: um gráfico cheio de estimativa de duas semanas atrás parece completo e é tão falso quanto o que só tinha dia bom |
| C6 | O limite de C5 vale **só para o atalho**; o Diário não muda | O `DiarioScreen` já navega e grava em qualquer data passada. Limitar no servidor seria regressão para o APK 1.2.0 instalado |
| C7 | Progresso passa a ter **dois níveis**: `Treino · Nutrição` | Quatro abas viram seis quando CrossFit chegar, e o seletor deixa de ser navegável num celular |
| C8 | Vocabulário de macro em **inglês** (`proteinG`/`carbsG`/`fatG`) | É o que `FoodLog` e `GET /nutrition/day` já falam. Duas grafias para a mesma coisa no mesmo domínio é dívida |

---

# D. Modelo de dados

**Nenhuma coleção nova.** A agregação roda sobre o `FoodLog` que já existe.

Considerei uma coleção denormalizada de totais por dia (leitura mais barata) e descartei:
introduz sincronia e migração para um volume que não justifica, e o total de um dia é uma
soma de três a oito documentos.

**Um índice entra:**

```ts
foodLogSchema.index({ user: 1, date: 1 });
```

Hoje existem apenas dois índices soltos, em `user` e em `date`. Uma janela de 30 dias de
uma pessoa varreria todos os registros dela. O `CLAUDE.md` exige índice para toda query
nova, e esta é a query.

---

# E. A rota

Uma só. O registro retroativo reusa o `POST /nutrition/logs`, que já aceita `date`.

```
GET /nutrition/evolucao?dias=30
```

Envelope `{ data, meta }` como manda o `CLAUDE.md` para rota nova. Sem cursor: é uma
janela fixa, não uma lista paginada.

```jsonc
{
  "data": {
    "dias": [
      {
        "dia": "2026-09-15",
        "kcal": 1840,            // null quando não houve registro
        "proteinG": 128,
        "carbsG": 190,
        "fatG": 52,
        "registros": 3,          // 0 = buraco
        "alvo": {                // null antes do primeiro plano com dieta
          "kcal": 2000, "proteinG": 150, "carbsG": 200, "fatG": 60
        }
      }
    ],
    "resumo": {
      "diasComRegistro": 12,
      "diasNaJanela": 30,
      "mediaKcal": 1890,         // média só dos dias COM registro, e a tela diz isso
      "diasDentroDoAlvo": 8      // dentro de ±10% do alvo do próprio dia
    }
  },
  "meta": { "dias": 30, "limitadoPeloPlano": false }
}
```

Notas de contrato:

- `alvo` e não `meta`: `meta` já é o envelope, e ter os dois no mesmo corpo confunde.
- `dias` vem **completo**, um item por data da janela, inclusive os vazios. Quem monta a
  lacuna é o servidor, não a tela — senão cada cliente inventa a própria regra.
- `mediaKcal` é média dos dias com registro. A tela **nunca** mostra esse número sozinho:
  ele aparece sempre ao lado de `diasComRegistro / diasNaJanela`, porque uma média de 12
  dias apresentada como se fosse de 30 é a mentira que este desenho existe para evitar.
- Gate de plano igual ao de evolução: `janelaPermitida()` corta a janela do grátis em 7
  dias e marca `limitadoPeloPlano: true`, em vez de recusar.

---

# F. Resolver o alvo de cada dia

O `Plan` é versionado (`{ user: 1, version: -1 }`) e tem `timestamps`. O algoritmo:

1. buscar as versões do usuário que tenham `diet != null`, ordenadas por `createdAt`;
2. para cada dia da janela, o alvo é o da **última versão criada até o fim daquele dia**;
3. dia anterior à primeira versão com dieta → `alvo: null`, e o gráfico não desenha
   linha de meta ali.

**Limite honesto, e ele precisa estar escrito:** `PUT /plans/current` edita a dieta **no
lugar, sem criar versão** (`routes/plans.ts`). Então uma edição manual da dieta
sobrescreve a meta histórica, e os dias anteriores passam a ser comparados com o valor
novo. Só `generate`, `adjust`, `import` e a prescrição do profissional criam versão — a
prescrição do coach faz isso e preserva a dieta (`routes/pro.ts`).

Consequência para a frente 3: **a prescrição de dieta do nutricionista deve criar versão
nova**, seguindo o que a prescrição de treino já faz. Se ela editar no lugar, o histórico
de meta se perde exatamente no caso em que ele mais importa.

---

# G. A tela

## G1. O Progresso ganha um nível

```
ANTES                          DEPOIS
┌─────────────────────────┐    ┌─────────────────────────┐
│ Resumo Evolução Rec. At.│    │   Treino  │  Nutrição   │  ← nível novo
├─────────────────────────┤    ├─────────────────────────┤
│                         │    │ Resumo Evolução Rec. At.│  ← intacto, dentro de Treino
```

As quatro telas de hoje **não são reescritas** — elas já aceitam `embedded`. O
`ProgressoScreen` ganha o seletor de assunto por cima do que já existe.

Achado que vale registrar: das quatro, só `HistoryScreen` lê a prop `embedded` de fato;
`MeusPRsScreen` e `MinhasAtividadesScreen` declaram `_props` e ignoram. Não é problema
deste desenho, mas quem mexer ali vai tropeçar.

## G2. Dentro de Nutrição

1. **Cabeçalho honesto** — "12 dos últimos 30 dias registrados" com o mesmo peso visual
   da média. Não é rodapé.
2. **Gráfico de kcal** — linha de consumo, linha de alvo, e **lacuna** onde `kcal` é
   `null`. Sem interpolar: ligar os pontos por cima do buraco é inventar o dia.
3. **Barras de macro** — proteína, carbo e gordura contra o alvo, no período.
4. **Convite para preencher** — aparece só quando ontem ou anteontem estão vazios. Abre o
   `QuickFoodAdd` que já existe, com a data daquele dia. O texto pergunta o que a pessoa
   comeu; não diz que ela falhou.

`QuickFoodAdd` hoje grava sempre em `todayStr()` e precisa passar a aceitar uma data —
é a única mudança de componente existente.

---

# H. Compatibilidade

| Risco | Veredito |
|---|---|
| APK 1.2.0 instalado | Rota nova e aditiva; nenhum contrato existente muda |
| `DiarioScreen` gravando em data antiga | **Preservado** (C6). Nenhuma trava nova no servidor |
| `GET /nutrition/day` | Intacto |
| Índice novo | Criação de índice em coleção pequena, sem migração de dado |
| `QuickFoodAdd` com data | Parâmetro opcional; sem data, continua gravando hoje |

---

# I. Testes

Integração com Mongo em memória, como todo endpoint novo do projeto:

- janela de 30 dias devolve 30 itens, inclusive os dias sem registro;
- dia sem registro vem com `kcal: null` e `registros: 0` — **não** `0`;
- dia com registro soma os macros de vários `FoodLog`;
- alvo muda no meio da janela: dias antigos comparam com a versão antiga do `Plan`;
- dia anterior à primeira dieta vem com `alvo: null`;
- plano grátis recebe janela cortada em 7 dias com `limitadoPeloPlano: true`;
- `resumo.mediaKcal` ignora os dias vazios, e `diasComRegistro` reflete a realidade;
- registro de outro usuário nunca entra na janela.

---

# J. O que a frente 3 vai consumir

O painel do nutricionista chama **as mesmas funções** de `services/nutricao.ts` que
respondem ao aluno — a regra do projeto, com teste comparando as duas respostas, como já
existe entre `/evolucao` e `/pro/alunos/:id/*`.

Isso destrava um bloqueio que a auditoria encontrou e que a frente 3 terá de resolver:
hoje **toda** rota de leitura do aluno passa por `alunoComTreinosAbertos`, que exige
`escopo.treinos`. Um nutricionista cujo aluno abriu só a dieta leva 403 em todas elas.

---

# K. Fora de escopo

- **Peso, medidas e fotos de progresso** — fatia seguinte.
- **Base de alimentos, código de barras, modo sem-números** — não entram aqui.
- **Prescrição de dieta pelo nutricionista** — frente 3.
- **Trava de autoria da dieta** (`recusarSeTemNutricionista`) — frente 3. Hoje
  `POST /plans/diet` não checa nutricionista nenhum.
- **`POST /nutrition/logs` aceita data no futuro** — o zod só confere o formato. É um
  buraco real de integridade, pequeno e independente desta frente. Tarefa própria.
