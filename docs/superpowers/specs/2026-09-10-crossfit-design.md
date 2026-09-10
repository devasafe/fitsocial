# CrossFit como atividade de primeira classe

> Auditoria do modelo atual e proposta de modelagem. Nada implementado ainda.

---

# A. Como o sistema registra atividades hoje

```
sportId ──(catálogo estático)──> kind ──> payload validado por zod
                                            │
                                            ├─ strength   musculação, calistenia, powerlifting, LPO
                                            ├─ endurance  corrida, ciclismo, natação, remo…
                                            ├─ wod        CROSSFIT, funcional
                                            ├─ class      jiu-jitsu, yoga, boxe…
                                            └─ generic    outro
```

`Activity` guarda `payload` como `Mixed` no Mongo, validado na borda por uma **união
discriminada por `kind`**. Além do payload, o documento tem `startedAt`, `durationSec`,
`visibility`, `perceivedEffort` (o RPE de 1 a 10 que você pediu — já existe), `feeling`,
`notes`, `planLink` e `metrics` desnormalizado, calculado no save.

`crossfit` **já é um esporte cadastrado**, mapeado para `kind: "wod"`.

---

# B. O que reusar sem tocar

Esta é a parte boa: quase toda a arquitetura que o pedido descreve já está de pé.

| O que o pedido pede | O que já existe |
|---|---|
| §2 Atividade ≠ Post | Já é assim desde a Fase 1. `shareToFeed` cria um `Post` que *referencia* a atividade |
| §40 CrossFit não contaminar outros esportes | A união discriminada por `kind` é exatamente esse isolamento |
| §4 RPE, sensação, observações, duração, data | `perceivedEffort`, `feeling`, `notes`, `durationSec`, `startedAt` |
| §29 Dados por série | `strengthSetSchema` já é **um objeto por série**, com carga e reps próprias |
| §10 PR | `PersonalRecord (user, exerciseName, type, repRange)` com `previousValue` para o delta |
| §34 Comparar o mesmo benchmark | O `repRange` do PR já guarda o nível (rx/scaled) — é o que impede comparar Fran RX com Fran scaled |
| §41 Autocomplete | `SuggestField` |
| §44 Plano → atividade | `planLink { planVersion, sessionDay }` |

**Consequência de projeto:** o bloco de Força do CrossFit deve usar
`strengthExerciseSchema` **literalmente**, o mesmo da musculação. Isso entrega de graça:
séries com cargas diferentes (§29), o cálculo de volume, e o motor de PR de 1RM
funcionando sem uma linha nova. É o oposto de duplicar entidade (§38).

---

# C. O que está errado hoje — e por que seu treino não coube

O payload de WOD atual é **plano**: um treino é *um* WOD.

```ts
wodPayload = {
  name, scoreType, level,
  resultTimeSec?, resultRounds?, resultReps?, resultLoadKg?,
  strengthBlock?,        // ← remendo: um campo especial para UM bloco
  movements?: [{ name, loadKg?, reps?, timeSec? }]
}
```

Nove furos, na ordem em que doem:

1. **Não existem blocos.** Aquecimento, mobilidade, skill e cooldown não têm onde ir. O
   `strengthBlock` é a prova: quando precisaram de um segundo bloco, criaram um campo
   especial em vez de uma lista.
2. **`movements[]` é pobre demais.** `21-15-9` não cabe. `400m Run` não cabe. `20 cal Row`
   não cabe.
3. **Não existe time cap.** Só `resultTimeSec`. Não dá para dizer "estourei o cap com 4
   rounds + 12".
4. **AMRAP não é comparável.** `resultRounds` e `resultReps` existem soltos; `7+12` não
   ordena contra `7+5` em nenhuma consulta.
5. **EMOM assume 1 minuto.** Não há intervalo configurável — E2MOM e "every 3 min" não
   cabem.
6. **Escala é um enum mudo.** `rx | scaled | adaptado` não diz *o que* foi escalado.
7. **Não separa prescrito de realizado.** AMRAP 15' onde você parou aos 12' é
   irrepresentável.
8. **Benchmark não é uma classificação.** "Fran" é só texto livre.
9. **Carga só em kg.** Sem lb, sem %1RM, sem corporal.

---

# D. Novas entidades e campos

**Nenhuma coleção nova.** Três mudanças:

### D.1 `strengthSetSchema` ganha campos opcionais (§9)

`rpe`, `percent1RM`, `restSec`, `tempo`. Já estavam previstos no comentário do próprio
arquivo. Sendo opcionais, nenhum dado existente precisa migrar.

### D.2 `wodPayload` vira `v: 2` com blocos

Os campos antigos continuam válidos. Um normalizador converte o formato antigo para o novo
**na leitura** — sem migração de dados, e reversível.

### D.3 `metrics` ganha superfície consultável

`payload` é genuinamente variável e continua `Mixed`. Mas o que o §45 quer consultar é
promovido para `metrics`, que já é o campo desnormalizado do projeto:

```ts
metrics: {
  minutes, volumeTotalKg,
  blocos: ["aquecimento", "forca", "metcon"],
  wod: { slug, formato, escala, scoreTipo, scoreValor, capado },
  movimentos: ["thruster", "pull_up"],     // normalizados
}
```

Índice em `metrics.wod.slug` resolve o histórico de benchmark. É o equilíbrio do §39: JSON
onde a forma varia de verdade, campo estruturado onde mora consulta.

---

# E. Fluxo de criação

```
Registrar → CrossFit

┌─ Data · hora · box · duração ────────┐   ← recolhido, preenchido sozinho
└──────────────────────────────────────┘

[ + Adicionar bloco ]  →  Aquecimento · Mobilidade · Skill · Força · WOD · Cooldown

FORÇA                          [editar]
Back Squat · 5×5 · até 100 kg

WOD                            [editar]
AMRAP 12' · 7 + 12 · RX

[ Salvar treino ]
```

Nenhum bloco é obrigatório (§32). Um treino pode ser só o WOD.

Cada bloco abre num sheet próprio — a tela principal nunca vira formulário longo. Rascunho
salvo em AsyncStorage a cada mudança: dá para sair e voltar (§42).

---

# F. Estrutura dos blocos

```ts
type Bloco =
  | { tipo: "aquecimento" | "mobilidade" | "cooldown";
      duracaoSec?, rounds?, movimentos: Movimento[], notas? }
  | { tipo: "skill";      /* ver I */ }
  | { tipo: "forca";      exercicios: strengthExerciseSchema[], notas? }
  | { tipo: "metcon";     /* ver G */ }
```

Aquecimento, mobilidade e cooldown compartilham a mesma forma livre — `rounds +
movimentos` cobre tanto "5 min Row" quanto "2 rounds: 10 Air Squats, 10 PVC, 10 Lunges".
Três tipos com um schema só, porque a diferença entre eles é rótulo, não estrutura.

### O Movimento — a peça central

```ts
Movimento = {
  nome: string,
  reps?: number,            // 15 Wall Balls
  repScheme?: number[],     // [21, 15, 9]  ← o que não cabia antes
  distanciaM?: number,      // 400m Run
  calorias?: number,        // 20 cal Row
  duracaoSec?: number,      // 60s de prancha
  carga?: Carga,
  notas?: string,
}
```

A ordem do array é a ordem do treino (§17: chipper).

### Carga (§23)

```ts
Carga = {
  valor?: number,
  unidade: "kg" | "lb" | "percent_1rm" | "corporal" | "livre",
  texto?: string,     // "caixa de 20 in", "colete 10 kg"
  valorKg?: number,   // derivado no servidor quando dá para converter
}
```

`valorKg` existe para o PR e os gráficos terem um número comparável sem reinterpretar
unidade a cada consulta.

---

# G. Estrutura do WOD

A separação entre **prescrição** e **resultado** (§43) é o eixo do bloco.

```ts
{
  tipo: "metcon",
  nome?: "Fran",
  benchmark?: { slug: "fran", familia: "girl" | "hero" | "open" | "outro" },
  formato: "for_time" | "amrap" | "emom" | "rft" | "tabata"
         | "intervalo" | "max_reps" | "max_load" | "outro",
  formatoLivre?: string,

  prescricao: {
    rounds?: 5,                    // 5 Rounds For Time
    duracaoSec?: 720,              // AMRAP 12'
    timeCapSec?: 1200,
    intervaloSec?: 120,            // E2MOM
    trabalhoSec?: 20, descansoSec?: 10,   // Tabata
    movimentos: Movimento[],       // ordem importa
  },

  resultado?: Score,
  escala: Escala,
  rounds?: { numero, tempoSec?, reps? }[],   // §28, opcional
  notas?: string,
}
```

**Benchmarks vivem num catálogo estático** (`services/benchmarks.ts`), como `sports.ts` —
slug, nome, família e prescrição canônica. Escolher "Fran" preenche 21-15-9
Thruster/Pull-up sozinho. Não é coleção no banco: não muda por usuário e não precisa de
migração.

---

# H. Estrutura de Força

```ts
{ tipo: "forca", exercicios: strengthExerciseSchema[], notas? }
```

Sem schema novo. `strengthExerciseSchema` já é `{ nome, sets: [{ weightKg, reps, type }] }`
— uma linha por série, que é exatamente o §29:

```
Set 1 — 5 × 80 kg     Set 4 — 5 × 95 kg
Set 2 — 5 × 85 kg     Set 5 — 5 × 100 kg
Set 3 — 5 × 90 kg
```

O formato compacto (`5×5 a 100 kg`) é a UI gerando cinco séries iguais — não um segundo
formato de dado.

---

# I. Estrutura de Skill

```ts
{
  tipo: "skill",
  movimento: "Double Under",
  formato?: "emom" | "pratica_livre" | "series",
  duracaoSec?, intervaloSec?, series?, repsPorSerie?,
  tentativas?: 10, acertos?: 8,        // "8/10 rounds completos"
  melhorSequencia?: 35,                // "35 unbroken"
  carga?: Carga,
  notas?,
}
```

`melhorSequencia` não é enfeite: é a métrica que faz skill virar PR (§L) e o gráfico que
mostra double-under saindo de 12 para 80 em três meses.

---

# J. Sistema de score

```ts
Score = {
  tipo: "tempo" | "rounds_reps" | "reps" | "carga" | "distancia",
  tempoSec?, rounds?, repsExtras?, reps?, cargaKg?, distanciaM?,
  valor: number,          // canônico, derivado no servidor
  maiorMelhor: boolean,   // tempo é o contrário
  capado?: boolean,       // não terminou dentro do cap
}
```

Três decisões dentro disso:

**`valor` canônico.** Para AMRAP, é o total de reps: `rounds × repsPorRound + repsExtras`,
com `repsPorRound` derivado dos movimentos. Assim `7+12` e `6+40` ordenam corretamente num
gráfico. Quando os movimentos não têm reps (só distância, por exemplo), `valor` fica nulo e
a comparação cai para `(rounds, repsExtras)` em ordem lexicográfica.

**O tipo do resultado pode divergir do formato.** Um "For Time" com cap estourado produz
`tipo: "rounds_reps"`, não `"tempo"` — porque tempo final não existe. Era o §27, e é o que
o modelo atual não sabe dizer.

**Capado nunca bate terminado.** Regra explícita no motor de PR. Sem ela, "4 rounds no cap
de 20'" apareceria como recorde contra "terminou em 17:34".

---

# K. Sistema de escala

```ts
Escala = {
  nivel: "rx" | "rx_plus" | "scaled" | "iniciante" | "custom",
  ajustes?: [{ de: "Pull Up", para: "Ring Row" }, { de: "60 kg", para: "45 kg" }],
  notas?: string,
}
```

O `nivel` continua indo para o `repRange` do PR, como já vai hoje. É o que garante que Fran
RX só compete com Fran RX — comparar com scaled não seria evolução, seria ruído.

Os `ajustes` são o que falta hoje: registrar **o que** mudou, não só que mudou.

---

# L. Integração com PR

O motor já tem os tipos `wod_time`, `wod_score`, `wod_load` e roda `strengthCandidates` no
bloco de força. Muda pouco:

| Origem | Tipo de PR | Chave |
|---|---|---|
| Bloco de força | `carga_max`, `rm_estimado` (já existe) | nome do exercício |
| Metcon com tempo | `wod_time` | slug do benchmark + nível |
| Metcon AMRAP/reps | `wod_score` | slug + nível |
| Metcon max load | `wod_load` | slug + nível |
| **Skill (novo)** | `skill_reps` | nome do movimento |

Regras novas: capado nunca supera terminado; benchmark sem slug não gera PR (texto livre
digitado diferente duas vezes viraria dois recordes).

---

# M. Perfil

O `TreinoCard` ganha um formato para CrossFit — resumo, não despejo:

```
CROSSFIT · 10 set

Fran · 5:32 · RX
Back Squat · 100 kg
RPE 8
```

A regra do card: **o WOD e o PR**, nada mais. Aquecimento e mobilidade só na tela de
detalhe, que mostra bloco a bloco na ordem em que aconteceram.

---

# N. Feed

`shareToFeed` já existe. O que muda é o texto sugerido: hoje é
`"Treino de CrossFit concluído 💪"` para tudo. Passa a ser gerado da atividade —
benchmark, score, escala, PR — e **editável antes de publicar** (§37).

---

# O. Histórico

`MinhasAtividadesScreen` e `HistoryScreen` já listam atividades. Ganham:

- o card de CrossFit acima;
- filtro por benchmark, alimentado por `metrics.wod.slug`;
- na tela de detalhe do benchmark: a série histórica com o delta (`Fran: 4:58 · anterior
  5:32 · −34s`), que é o §34.

---

# P. Planos de treino

Dois pontos, e o primeiro é o que abriu a conversa.

**P.1 — Quem faz CrossFit não deveria precisar gerar um plano.** Hoje a Home só oferece
"Gerar meu plano" ou "Importar o meu". Para quem segue a programação do box, gerar um plano
de musculação é ruído — e é a primeira coisa que o app pede. Proposta: um terceiro caminho,
"**Sigo a programação do meu box**", que troca a Home de "seguir o plano" para "registrar o
treino de hoje". É mudança pequena e resolve uma dor real de um público inteiro.

**P.2 — Plano → atividade.** `planLink` já existe. Um treino planejado vira a *prescrição*
do metcon, e a pessoa preenche só o resultado — que é precisamente por que prescrição e
resultado são campos separados (§43).

---

# Fases

| # | Entrega | Depende de |
|---|---|---|
| 1 | Modelo `v2` com blocos + normalizador do formato antigo + métricas | — |
| 2 | Tela de registro em blocos (aquecimento, força, metcon) | 1 |
| 3 | Skill, mobilidade, cooldown, escala com ajustes | 2 |
| 4 | Catálogo de benchmarks + autocomplete + preenchimento automático | 1 |
| 5 | PR de skill, capado, histórico de benchmark com delta | 1, 4 |
| 6 | Card e detalhe no perfil, texto do feed gerado | 1 |
| 7 | "Sigo a programação do meu box" na Home | — (independente) |
| 8 | Template de treino (§33) | 2 |

A Fase 7 não depende de nada e resolve a dor que abriu a conversa — pode vir primeiro.
