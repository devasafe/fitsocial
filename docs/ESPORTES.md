# FitSocial — Esportes e Formatos de Registro

> Especificação definitiva de quais esportes o app suporta e exatamente como cada um é registrado.
> Spec de referência dos esportes e payloads. Complementa o design do domínio `Activity` em `docs/ARQUITETURA.md` §5.2.
>
> ⚠️ **Escopo:** este documento é a visão COMPLETA (alvo). A implementação é fatiada — ver o
> plano de decomposição da Fase 2 em `docs/ARQUITETURA.md` §7. Nem tudo aqui entra de uma vez.

---

# 1. A decisão

**Fase 2: 5 formatos de payload, cobrindo 21 esportes.**

Não são 3 nem 5 como as opções colocavam — são 5, mas com uma redistribuição que muda o custo. A jogada que faz isso caber: **natação, corrida de pista e remo não ganham formato próprio.** Todos os três são "distância + tempo + ritmo, opcionalmente quebrado em séries". É o mesmo formato do `endurance` com um bloco `intervals[]` opcional. Um 8×400m na pista e um 8×100m livre na piscina têm exatamente a mesma forma de dado — muda a unidade do ritmo e a biblioteca de nomes.

| Formato | Esportes | Por que existe |
|---|---|---|
| `strength` | Musculação, calistenia, powerlifting, LPO | Exercício → séries de carga × reps. Nada mais tem essa forma |
| `endurance` | Corrida, trail, caminhada, ciclismo, natação, remo, escada, esteira | Distância + tempo + ritmo. `intervals[]` cobre pista e piscina |
| `wod` | CrossFit, funcional, HIIT | Score é o resultado (tempo, rounds, carga), não a soma das partes |
| `class` | Jiu-jitsu, muay thai, boxe, MMA, judô, karatê, yoga, pilates, spinning, dança | Presença e duração são o dado. Não há número de performance |
| `generic` | Qualquer coisa fora dos anteriores | Escape hatch. Sem ele o usuário fica sem registrar e desiste |

**Fase 2.1 (logo depois, custo marginal baixo porque a casca já existe): +2 formatos.**

| Formato | Esportes |
|---|---|
| `climb` | Escalada esportiva, boulder |
| `match` | Futebol, futsal, beach tennis, padel, tênis, vôlei, basquete |

**Por que `match` não entra na Fase 2:** futebol e beach tennis são gigantes no Brasil, mas o dado que geram é pobre (duração, resultado, posição) e o `generic` já registra o essencial. O ganho de ter formato próprio é de identidade social, não de dado — e identidade social pode esperar duas semanas. **Por que `climb` não entra:** o sistema de graus (V-scale, Fontainebleau, brasileiro, francês, YDS) é uma tabela de conversão inteira, e escalada é nicho demais para pagar esse custo agora.

---

# 2. Tabela mestra

| # | Esporte | `sportId` | Formato | Cor | GPS | PR principal |
|---|---|---|---|---|---|---|
| 1 | Musculação | `musculacao` | strength | `#C8FA4B` | — | Carga máxima e 1RM estimado por exercício |
| 2 | Calistenia | `calistenia` | strength | `#B4E63F` | — | Máximo de reps e maior tempo de isometria |
| 3 | Powerlifting | `powerlifting` | strength | `#8FBF42` | — | 1RM de agacho, supino, terra e o **Total** |
| 4 | Levantamento olímpico | `lpo` | strength | `#A8D42E` | — | 1RM de arranco, arremesso e Total olímpico |
| 5 | Corrida de rua | `corrida` | endurance | `#FF8A4C` | Sim | Melhor 1k, 5k, 10k, 21k, 42k |
| 6 | Corrida em trilha | `trail` | endurance | `#E06A2C` | Sim | Maior D+ e maior distância |
| 7 | Esteira | `esteira` | endurance | `#FFA06B` | Não | Melhor 5k e 10k |
| 8 | Caminhada | `caminhada` | endurance | `#96A39A` | Sim | Maior distância e mais passos |
| 9 | Ciclismo | `ciclismo` | endurance | `#4C9AFF` | Sim | Maior distância, velocidade máxima, melhor 20k/40k |
| 10 | Natação | `natacao` | endurance | `#2FD4D4` | Opcional | Melhor 50/100/200/400/1500 por nado |
| 11 | Remo / ergômetro | `remo` | endurance | `#3AA8C4` | Não | Melhor 500m, 1k, **2k**, 5k |
| 12 | CrossFit | `crossfit` | wod | `#F5C63C` | — | Melhor tempo em benchmark + 1RM dos levantamentos |
| 13 | Funcional / HIIT | `funcional` | wod | `#4FD69C` | — | Melhor score por circuito nomeado |
| 14 | Jiu-jitsu | `jiu_jitsu` | class | `#9B7CF0` | — | Horas de tatame, rolas acumuladas, graduação |
| 15 | Muay thai | `muay_thai` | class | `#F27299` | — | Rounds acumulados, horas, sequência |
| 16 | Boxe | `boxe` | class | `#EF5350` | — | Rounds acumulados, horas |
| 17 | MMA | `mma` | class | `#D96FE0` | — | Horas por disciplina |
| 18 | Judô | `judo` | class | `#7C9BF0` | — | Horas de tatame, randoris, graduação |
| 19 | Yoga | `yoga` | class | `#DCC4A0` | — | Minutos acumulados, sequência |
| 20 | Pilates | `pilates` | class | `#C9B08A` | — | Aulas no mês, sequência |
| 21 | Outro | `outro` | generic | `#7A8079` | Opcional | Sequência e minutos |

**Fase 2.1:** `escalada` (climb, `#C98A3C`) · `futebol` · `futsal` · `beach_tennis` · `padel` · `tenis` · `volei` · `basquete` (match).

---

# 3. Campos comuns a toda atividade

Independem do esporte. Já estão em `docs/ARQUITETURA.md` §3.2, repetidos aqui por conveniência:

```ts
{
  sportId, title, startedAt, durationSec,
  visibility, caption, media[], taggedUserIds[], clubId,
  perceivedEffort: 1..10,          // RPE da sessão inteira
  feeling: 'otimo'|'bom'|'normal'|'ruim'|'pessimo',
  notes,
  location: { name?, geo? },       // "Smart Fit Centro", opcional
  weather?: { tempC, condition },  // só quando houve GPS
  payload,                         // ← muda por formato
  metrics                          // ← desnormalizado, calculado no save
}
```

**Regra de ouro do registro:** todo formato tem um **caminho rápido** (3 toques, campos mínimos) e um **caminho completo**. O iniciante nunca vê o completo até pedir. Se o registro rápido de qualquer esporte passar de 30 segundos, o desenho está errado.

---

# 4. Formato `strength`

## 4.1 Estrutura

```ts
StrengthPayload = {
  variant: 'musculacao' | 'calistenia' | 'powerlifting' | 'lpo',
  exercises: [{
    exerciseId, name, order,
    supersetGroup: string | null,     // 'A' agrupa bi-set/superset
    unilateral: boolean,
    sets: [{
      order,
      type: 'aquecimento' | 'valida' | 'drop' | 'falha' | 'rest_pause' | 'backoff',
      weightKg: number,               // 0 = peso corporal
      addedWeightKg: number | null,   // lastro na calistenia
      assistedKg: number | null,      // elástico / máquina assistida (valor negativo de carga)
      reps: number | null,
      holdSec: number | null,         // isometria: prancha, front lever, dead hang
      side: 'ambos' | 'esq' | 'dir' | null,
      rpe: number | null,             // 1–10
      rir: number | null,             // reps in reserve, alternativa ao RPE
      tempo: string | null,           // cadência, ex '3-1-2-0'
      restSec: number | null,
      done: boolean,
      isPr: boolean                   // marcado na detecção
    }]
  }],
  notes: string | null
}
```

**Variantes — o que muda na tela, não no schema:**

| Variante | Campo em destaque | Campo escondido | Biblioteca |
|---|---|---|---|
| `musculacao` | carga + reps | tempo, RIR | ~200 exercícios gerais |
| `calistenia` | reps ou `holdSec` + lastro | carga bruta | ~60 movimentos de peso corporal |
| `powerlifting` | carga + RPE + tentativa | tempo | 3 principais + acessórios |
| `lpo` | carga + % do 1RM + falhas | RIR | ~25 levantamentos e parciais |

## 4.2 Como a pessoa registra na prática

**Caminho rápido:** escolhe o exercício → digita carga e reps da primeira série → botão "repetir série" preenche igual → marca o checkbox a cada série feita. Carga e reps vêm pré-preenchidos com o **último treino do mesmo exercício**, que é como 90% das séries são registradas de verdade.

**Durante o treino ao vivo:** cronômetro de descanso sobe sozinho ao marcar a série. A tela nunca pede scroll para achar o próximo campo.

**Detalhes que importam e quase todo app erra:**
- **Unilateral** conta uma vez, não duas. 3×10 rosca alternada = 3 séries, não 6. Mas o volume conta os dois lados.
- **Série de aquecimento não entra no volume nem gera PR.** Precisa ser marcável em um toque.
- **Assistida é carga negativa.** Barra fixa com elástico de 20 kg em quem pesa 80 kg equivale a 60 kg. Sem isso, a evolução do iniciante fica invisível — e o iniciante é o público principal.
- **Peso corporal muda.** Barra fixa a 80 kg e a 74 kg não é a mesma coisa. Ao calcular PR de calistenia, use o peso corporal registrado mais próximo da data.

## 4.3 Métricas calculadas

```
volumeTotalKg   = Σ (weightKg + addedWeightKg) × reps   [só séries válidas]
seriesValidas   = contagem de type='valida'
seriesPorGrupo  = { peito: 12, costas: 10, ... }   ← alimenta o alerta de desequilíbrio do coach
tonelagem       = volumeTotalKg / 1000
densidade       = volumeTotalKg / durationSec
```

## 4.4 PRs detectados

| PR | Regra |
|---|---|
| **Carga máxima** | Maior `weightKg` já feito naquele exercício, com qualquer número de reps ≥1 |
| **Carga por faixa de rep** | Maior carga em 1–3, 4–6, 7–10, 11–15 reps. Separado, porque melhorar 12 reps é progresso real e o PR absoluto não captura |
| **1RM estimado** | Epley: `carga × (1 + reps/30)`. Só para séries de 1 a 12 reps — acima disso a fórmula mente. Guardar como `estimated_1rm` |
| **Volume no exercício** | Maior `Σ carga × reps` de um exercício em uma sessão |
| **Volume na sessão** | Maior volume total de uma sessão daquele esporte |
| **Máximo de reps** | Só calistenia: maior `reps` com `weightKg = 0` |
| **Isometria** | Maior `holdSec` por movimento |
| **Maior lastro** | Calistenia: maior `addedWeightKg` |
| **Total (powerlifting)** | Soma dos melhores 1RM de agacho + supino + terra. Recalculado quando qualquer um dos três muda |
| **Total olímpico** | Melhor arranco + melhor arremesso |
| **DOTS** | Pontuação relativa ao peso corporal, a partir do Total. Permite comparar pessoas de pesos diferentes — é o que dá sentido a um ranking de powerlifting |

**Regra anti-frustração:** um PR só dispara celebração se a diferença for real. Aumentos abaixo de 0,5 kg ou 1% não geram tela de PR (só atualizam o número em silêncio). Senão o app celebra ruído e a celebração perde o valor.

---

# 5. Formato `endurance`

## 5.1 Estrutura

```ts
EndurancePayload = {
  subType: 'rua' | 'trilha' | 'esteira' | 'indoor' | 'piscina' | 'aguas_abertas' | 'ergometro' | 'escada',

  distanceM: number,
  movingTimeSec: number,
  elapsedTimeSec: number,
  elevationGainM: number | null,
  elevationLossM: number | null,

  paceUnit: 'min_km' | 'min_100m' | 'kmh' | 'split_500m',
  avgPace: number,                 // segundos, na unidade acima
  bestPace: number,
  maxSpeedKmh: number | null,

  avgHr: number | null, maxHr: number | null,
  avgCadence: number | null,       // ppm na corrida, rpm na bike, braçadas/min na natação
  avgPowerW: number | null,        // ciclismo com medidor
  calories: number | null,

  // GPS (só quando houve rastreamento)
  polyline: string | null,
  startPoint: GeoPoint | null,
  splits: [{ index, distanceM, timeSec, pace, elevationM, avgHr }] | null,
  mapThumbUrl: string | null,
  privacyZonesApplied: boolean,
  gpsQuality: 'boa' | 'media' | 'ruim' | null,

  // Séries — pista, piscina, ergômetro
  intervals: [{
    order, repeat: number,          // 8 (de 8×400m)
    distanceM: number | null,
    timeSec: number | null,
    targetPace: number | null,
    actualPaces: number[],          // um por repetição
    restSec: number | null,
    restType: 'parado' | 'trote' | 'nado_leve',
    stroke: 'crawl'|'costas'|'peito'|'borboleta'|'medley' | null,   // natação
    equipment: string[] | null      // palmar, pullbuoy, nadadeira, snorkel
  }] | null,

  // Específicos
  poolLengthM: 25 | 50 | null,
  swolf: number | null,
  strokeCount: number | null,
  steps: number | null,             // caminhada, via Health Connect
  inclinePct: number | null,        // esteira
  bikeType: 'estrada'|'mtb'|'speed'|'rolo'|'urbana' | null,
  gearId: string | null,            // tênis ou bike usada
  effortSurface: 'asfalto'|'terra'|'areia'|'pista'|'esteira' | null
}
```

## 5.2 Como cada um é registrado

**Corrida de rua e trail** — o app grava por GPS. Distância, tempo e ritmo saem sozinhos; a pessoa só confirma no fim. Manualmente: distância, tempo e o resto é derivado. Campo de **tênis usado** — corredor acompanha quilometragem do calçado e troca a cada 600–800 km; é um detalhe pequeno que faz corredor sério confiar no app.

**Esteira** — sem GPS: distância, tempo, inclinação média, velocidade. Aceite também "por tempo" quando a pessoa não sabe a distância.

**Caminhada** — distância e tempo, ou só passos importados do Health Connect. Registro mais leniente de todos: para muito iniciante, é a primeira atividade da vida no app e não pode ter fricção.

**Ciclismo** — GPS com velocidade em vez de pace (`paceUnit: 'kmh'`). Campos extras: tipo de bike, cadência, potência se houver medidor. Velocidade máxima é o número que ciclista mais compartilha.

**Natação em piscina** — não é GPS. A pessoa registra:
1. Comprimento da piscina (25 ou 50 m) — pergunta uma vez, memoriza.
2. Séries: `8 × 100 m crawl, saindo de 1'45"`. É assim que a prancheta do treinador escreve, e é assim que a tela tem que aceitar.
3. Ou o modo simples: distância total + tempo.

Ritmo em **min/100m**, nunca min/km. SWOLF (tempo da volta + número de braçadas) para quem quer eficiência — campo opcional, escondido no caminho completo.

**Águas abertas** — GPS, ritmo em min/100m, sem `poolLengthM`.

**Remo / ergômetro** — distância, tempo, **split por 500 m** (a unidade do remo), SPM e watts. O teste de **2 km** é a referência universal do esporte e merece destaque próprio na tela de PRs.

**Escada / stairmaster** — tempo, andares, elevação equivalente.

## 5.3 PRs detectados

**A regra que separa um app bom de um app ruim:** o melhor 5 km não é o tempo de uma corrida que teve exatamente 5 km. É o **trecho de 5 km mais rápido dentro de qualquer corrida já gravada**. Quem correu 12 km fez um 5 km ali dentro, e é esse que conta.

Implementação: janela deslizante sobre os pontos do track, procurando a menor duração que cobre a distância alvo. Roda no job `gps.track.process`. Para registro manual sem track, só vale se a distância registrada for ≥ a distância do PR, e usa o pace médio.

| Esporte | Distâncias de PR | Outros PRs |
|---|---|---|
| Corrida / esteira | 400 m, 1 k, 1 milha, 5 k, 10 k, 15 k, 21,1 k, 42,2 k | Maior distância, maior tempo contínuo, maior D+ |
| Trail | 5 k, 10 k, 21 k | **Maior D+ acumulado** (o PR que importa no trail), maior distância |
| Caminhada | 5 k, 10 k | Maior distância, mais passos em um dia |
| Ciclismo | 10 k, 20 k, 40 k, 100 k | Velocidade máxima, maior distância, maior D+, maior potência média em 20 min |
| Natação | 50, 100, 200, 400, 800, 1500 m — **por nado** | Melhor ritmo/100m, maior volume em uma sessão, melhor SWOLF |
| Remo | 500 m, 1 k, **2 k**, 5 k, 10 k | Maior distância em 30 min, melhor split médio |

**Cuidado obrigatório:** PR de natação separado por nado. Melhor 100 m livre e melhor 100 m borboleta são recordes diferentes, e juntá-los é erro grosseiro aos olhos de quem nada.

---

# 6. Formato `wod`

Este é o formato que o CrossFit exige e que quase nenhum app brasileiro faz direito.

## 6.1 O que ninguém acerta

Uma aula de CrossFit **não é só o WOD**. A estrutura típica é:

```
Aquecimento  →  Força/Skill (ex: 5×3 back squat @80%)  →  WOD (ex: Fran)  →  Acessório
```

A parte de força é onde nascem os 1RM. O WOD é onde nasce o tempo. **Se o payload só guardar o WOD, o app perde metade dos PRs do crossfiteiro.** Por isso o `wod` carrega um bloco `strength` opcional, com exatamente a mesma estrutura do formato `strength`.

## 6.2 Estrutura

```ts
WodPayload = {
  // Parte de força/skill da aula — opcional, mesma forma do StrengthPayload
  strengthBlock: { exercises: [...] } | null,

  // O WOD
  wod: {
    name: string | null,              // 'Fran' ou 'WOD do dia'
    benchmarkId: string | null,       // referência à biblioteca
    isBenchmark: boolean,

    scoreType: 'for_time' | 'amrap' | 'emom' | 'rft'
             | 'max_load' | 'for_reps' | 'tabata' | 'chipper' | 'interval',

    // Prescrição
    description: string,              // '21-15-9 thruster + pull-up'
    timeCapSec: number | null,
    durationSec: number | null,       // AMRAP: 20 min. EMOM: 12 min

    // Resultado — só um destes é preenchido, conforme scoreType
    resultTimeSec: number | null,     // for_time, rft, chipper
    resultRounds: number | null,      // amrap
    resultExtraReps: number | null,   // amrap: 12 rounds + 8 reps
    resultReps: number | null,        // for_reps, tabata
    resultLoadKg: number | null,      // max_load
    cappedOut: boolean,               // estourou o time cap
    repsAtCap: number | null,         // quanto faltou

    // Como foi feito
    level: 'rx' | 'scaled' | 'adaptado',
    movements: [{
      movementId, name,
      loadKg: number | null,
      reps: number | null,
      heightCm: number | null,        // box jump
      distanceM: number | null,       // run, row
      calories: number | null,        // assault bike, remo
      scaling: string | null,         // 'elástico verde', 'joelho no chão'
      unbroken: boolean
    }],

    partnerIds: string[] | null,      // WOD em dupla ou time
    partition: 'individual' | 'dupla' | 'time'
  },

  notes: string | null
}
```

## 6.3 Como a pessoa registra

**Caminho rápido (o mais usado):** seleciona o WOD do dia do box (ou digita), escolhe Rx ou Scaled, digita o resultado. Três campos.

**Caminho benchmark:** busca "Fran" → o app já traz a prescrição oficial (21-15-9 thruster 43/30 kg + pull-ups), a pessoa só põe o tempo e confirma se foi Rx. **A comparação com o tempo anterior aparece na hora**, antes de salvar — é o momento em que o crossfiteiro decide se posta.

**Caminho completo:** monta o WOD movimento a movimento com cargas.

**Detalhes que o pessoal do box cobra:**
- **Rx importa mais que o tempo.** Fran em 4:12 scaled não compara com Fran em 5:30 Rx. Nunca coloque os dois no mesmo ranking.
- **Time cap conta como resultado.** "Cap + 14 reps" é um score legítimo e comparável entre pessoas que também estouraram.
- **Carga usada por movimento**, não só o nome. Thruster de 30 kg e de 43 kg são treinos diferentes.
- **Unbroken** (sem soltar a barra) é motivo de orgulho e merece um toque para marcar.

## 6.4 PRs detectados

| PR | Regra |
|---|---|
| **Benchmark nomeado** | Melhor resultado por WOD, **separado por nível** (Rx / Scaled). Comparar tempos entre níveis é erro |
| **1RM dos levantamentos** | Vem do `strengthBlock` pela mesma regra do formato `strength`: back squat, front squat, overhead squat, deadlift, clean, snatch, clean & jerk, push press, bench, strict press |
| **Máximo de reps unbroken** | Pull-up, toes-to-bar, double under, HSPU, muscle-up, wall ball |
| **Benchmark de máquina** | 500 m e 2 k no remo, 1 milha de corrida, máximo de calorias em 1 min de assault bike |
| **Girl / Hero WOD** | Tratado como benchmark, com destaque próprio no perfil |

## 6.5 Biblioteca necessária (seed)

**~80 movimentos de CrossFit** com: nome em inglês (é como se fala no box) + tradução, categoria (halterofilismo / ginástica / metabólico / máquina), carga padrão masculina e feminina, escalonamentos comuns.

**~25 benchmark WODs.** Os mais registrados, com prescrição:

| WOD | Tipo | Prescrição resumida |
|---|---|---|
| Fran | For time | 21-15-9 thruster (43/30 kg) + pull-up |
| Grace | For time | 30 clean & jerk (61/43 kg) |
| Isabel | For time | 30 snatch (61/43 kg) |
| Helen | 3 RFT | 400 m corrida + 21 kettlebell swing (24/16 kg) + 12 pull-up |
| Cindy | AMRAP 20 | 5 pull-up + 10 push-up + 15 air squat |
| Murph | For time | 1,6 km corrida + 100 pull-up + 200 push-up + 300 air squat + 1,6 km corrida, com colete 9/6 kg |
| Diane | For time | 21-15-9 deadlift (102/70 kg) + handstand push-up |
| Karen | For time | 150 wall ball (9/6 kg) |
| Annie | For time | 50-40-30-20-10 double under + sit-up |
| Jackie | For time | 1000 m remo + 50 thruster (barra vazia) + 30 pull-up |
| Angie | For time | 100 pull-up + 100 push-up + 100 sit-up + 100 air squat |
| Barbara | 5 RFT | 20 pull-up + 30 push-up + 40 sit-up + 50 air squat, 3 min de descanso |
| Chelsea | EMOM 30 | 5 pull-up + 10 push-up + 15 air squat |
| Elizabeth | For time | 21-15-9 clean (61/43 kg) + ring dip |
| Nancy | 5 RFT | 400 m corrida + 15 overhead squat (43/30 kg) |
| Kelly | 5 RFT | 400 m corrida + 30 box jump (60 cm) + 30 wall ball |
| Mary | AMRAP 20 | 5 HSPU + 10 pistol + 15 pull-up |
| Linda | 10-9-8…1 | Deadlift 1,5× PC + bench 1× PC + clean 0,75× PC |
| Filthy Fifty | For time | 50 reps de 10 movimentos |
| Fight Gone Bad | 3 rounds | 5 estações × 1 min, pontuação por reps |
| DT (Hero) | 5 RFT | 12 deadlift + 9 hang power clean + 6 push jerk (70/47 kg) |
| Randy (Hero) | For time | 75 power snatch (34/25 kg) |
| JT (Hero) | For time | 21-15-9 HSPU + ring dip + push-up |
| The Chief | 5× AMRAP 3 | 3 power clean + 6 push-up + 9 air squat |
| Nate (Hero) | AMRAP 20 | 2 muscle-up + 4 HSPU + 8 kettlebell swing (32/24 kg) |

> **Ao implementar o seed, confira as prescrições em fonte oficial.** Existem versões diferentes em circulação (principalmente das cargas femininas e dos Hero WODs), e errar a prescrição de um benchmark é o tipo de detalhe que faz o crossfiteiro desinstalar.

**Funcional / HIIT** usa o mesmo formato com `scoreType: 'interval'` ou `for_reps`, sem biblioteca de benchmark — o circuito é descrito em texto livre com estações.

---

# 7. Formato `class`

Para esportes onde **não existe número de performance**. Ninguém tem "PR de jiu-jitsu". O que existe é presença acumulada, e é isso que precisa virar progresso visível — senão o lutador abre o app e não vê motivo para voltar.

## 7.1 Estrutura

```ts
ClassPayload = {
  modality: string,                  // 'jiu_jitsu', 'muay_thai', 'yoga'...
  sessionType: 'tecnica' | 'drill' | 'sparring' | 'aula_completa'
             | 'condicionamento' | 'competicao' | 'seminario' | 'open_mat',

  // Lutas de agarre
  gi: boolean | null,                // kimono ou no-gi
  rolls: number | null,              // quantas rolas / randoris
  rollDurationSec: number | null,
  submissions: number | null,        // opcional, quem gosta anota
  submitted: number | null,

  // Lutas de percussão
  rounds: number | null,
  roundDurationSec: number | null,
  restBetweenSec: number | null,
  workType: ('saco'|'manopla'|'sparring'|'sombra'|'tecnica'|'clinch'|'condicionamento')[] | null,

  // MMA
  disciplines: ('striking'|'wrestling'|'grappling'|'clinch'|'solo')[] | null,

  // Aulas de estúdio
  style: string | null,              // 'vinyasa', 'hatha', 'yin', 'solo', 'aparelho'
  intensity: 'leve' | 'moderada' | 'intensa' | null,

  instructor: string | null,
  partnerIds: string[] | null,
  techniques: string[] | null,       // texto livre: 'raspagem de gancho', 'armlock da guarda'

  // Competição
  competition: {
    name: string, category: string,
    fights: number, wins: number, losses: number,
    result: 'ouro' | 'prata' | 'bronze' | 'participacao',
    submissionWins: number | null
  } | null
}
```

**Graduação** (faixa, grau, kyu/dan) **não fica na atividade** — fica no perfil, em `profiles.gradings[]`, porque é um estado da pessoa, não de um treino. Quando a pessoa registra uma nova graduação, o app gera uma atividade `kind: 'achievement'` que aparece no feed. Graduação de faixa é um dos posts com mais engajamento que uma rede social de luta pode ter.

## 7.2 Como a pessoa registra

**Dois toques.** Abre o app, escolhe o esporte, confirma a duração padrão da aula (memorizada do último registro) e salva. Esse é o caminho de 90% dos casos, e ele precisa ser realmente instantâneo.

O caminho completo aparece só para quem toca em "detalhar": tipo de sessão, rolas, parceiros, técnicas treinadas.

## 7.3 "PRs" — o que substitui o recorde

| Métrica | Descrição |
|---|---|
| **Horas de tatame** | Total acumulado por modalidade. É a moeda de valor no jiu-jitsu — "tenho 300 horas de tatame" diz mais que qualquer número |
| **Rolas / rounds acumulados** | Contagem total, com marco a cada 100 |
| **Aulas no mês** | Com recorde mensal próprio ("seu melhor mês: 18 aulas") |
| **Sequência de semanas** | Semanas consecutivas com pelo menos uma aula |
| **Tempo desde a última graduação** | Contexto, não cobrança |
| **Marcos** | 50, 100, 250, 500, 1000 aulas. Cada um gera post automático |

**Regra de tom:** nada aqui pode virar cobrança. "Você não treina há 5 dias" não existe neste app. "Sua sequência: 3 semanas" existe.

---

# 8. Formato `generic`

```ts
GenericPayload = {
  activityName: string,              // 'surf', 'skate', 'stand up paddle', 'trilha a pé'
  description: string | null,
  customMetrics: [{ label, value, unit }] | null   // até 3, definidas pela pessoa
}
```

**Por que as métricas customizadas existem:** o surfista quer anotar "12 ondas". O skatista quer anotar "kickflip: acertei". Sem esse escape, ele registra nada — e um usuário que não registra some em duas semanas. Três campos livres custam quase nada e salvam a cauda longa inteira.

**PRs:** só sequência, minutos acumulados e o recorde da própria métrica customizada quando o rótulo se repete (se "ondas" aparece 3 vezes, o app passa a acompanhar o máximo).

---

# 9. Fase 2.1

## 9.1 `climb`

```ts
ClimbPayload = {
  discipline: 'boulder' | 'esportiva' | 'top_rope' | 'tradicional' | 'indoor' | 'outdoor',
  gradeSystem: 'v_scale' | 'fontainebleau' | 'frances' | 'brasileiro' | 'yds',
  location: string | null,
  routes: [{
    name: string | null, grade: string, color: string | null,
    attempts: number,
    result: 'flash' | 'onsight' | 'redpoint' | 'top' | 'projeto' | 'nao_completou',
    heightM: number | null, notes: string | null
  }],
  totalRoutes: number, hardestSent: string
}
```

PRs: grau máximo enviado por disciplina, grau máximo no flash, grau máximo no onsight, número de vias em uma sessão. Precisa de tabela de conversão entre sistemas de grau — é o custo que empurra este formato para depois.

## 9.2 `match`

```ts
MatchPayload = {
  sport: string,
  format: string | null,             // 'society 7v7', 'dupla', 'simples'
  position: string | null,
  durationSec: number,
  score: { us: number, them: number } | null,
  sets: [{ us: number, them: number }] | null,    // tênis, padel, beach tennis, vôlei
  result: 'vitoria' | 'derrota' | 'empate' | 'amistoso',
  stats: { goals?, assists?, points?, aces?, blocks? } | null,
  partnerIds: string[] | null,
  opponents: string | null
}
```

PRs: pouco aplicável. Use frequência, minutos acumulados, sequência de vitórias e recorde de gols/pontos em uma partida.

---

# 10. Bibliotecas de dados a semear

| Biblioteca | Volume | Conteúdo | Prioridade |
|---|---|---|---|
| `exercises` (musculação) | ~200 | Nome PT + EN, grupo muscular primário e secundário, equipamento, unilateral, vídeo | Fase 2 |
| `exercises` (calistenia) | ~60 | Progressões encadeadas (negativa → assistida → completa → lastro) | Fase 2 |
| `movements` (CrossFit) | ~80 | Nome em inglês + tradução, categoria, carga padrão M/F, escalonamentos | Fase 2 |
| `wodBenchmarks` | ~25 | Prescrição, tipo de score, padrões de movimento | Fase 2 |
| `swimDrills` | ~30 | Nados, exercícios educativos, equipamentos | Fase 2 |
| `lpoLifts` | ~25 | Levantamentos completos e parciais | Fase 2 |
| `gradings` | ~10 sistemas | Faixas de jiu-jitsu, judô, karatê, taekwondo, muay thai (prajioud) | Fase 2 |
| `climbGrades` | tabela | Conversão V-scale ↔ Font ↔ francês ↔ brasileiro ↔ YDS | Fase 2.1 |

**Fonte dos exercícios de musculação:** existem bases abertas com licença permissiva (verifique a licença antes de usar). Evite copiar base proprietária de app concorrente — nome de exercício não é protegido, mas descrição e mídia são.

---

# 11. O que muda na tela de registro por formato

| Formato | Caminho rápido (3 toques) | Elemento dominante | Campo pré-preenchido do último treino |
|---|---|---|---|
| `strength` | Exercício → carga/reps → repetir série | `SetRow` com stepper grande | Carga e reps do mesmo exercício |
| `endurance` GPS | Iniciar → correr → deslizar para finalizar | Distância em `metric-hero` sobre o mapa | Nada (vem do sensor) |
| `endurance` manual | Distância → tempo → salvar | Dois campos numéricos grandes | Distância da última sessão do mesmo esporte |
| `endurance` piscina | Distância total → tempo → salvar | Ritmo por 100 m em destaque | Comprimento da piscina |
| `wod` | Nome do WOD → Rx/Scaled → resultado | Campo de resultado adaptado ao `scoreType` | Nível (Rx ou Scaled) usado da última vez |
| `class` | Esporte → confirmar duração → salvar | Botão único gigante de confirmar | Duração e tipo de sessão da última aula |
| `generic` | Nome → duração → salvar | Campo de texto + duração | Nome da última atividade genérica |

---

# 12. Detecção de PR — regras gerais

Roda no `activity.service.create()`, de forma síncrona (é rápido) para `strength`, `wod` e `class`. Roda no job `gps.track.process` para `endurance` com track, porque a varredura de janela deslizante é pesada.

**Regras que valem para todos:**

1. **Só série válida gera PR.** Aquecimento, drop set e falha são excluídos do cálculo de carga máxima.
2. **Só compara igual com igual.** Rx com Rx, nado com nado, gi com gi.
3. **Limiar mínimo.** Melhoria abaixo de 1% (ou 0,5 kg, ou 1 segundo) atualiza o número mas não dispara celebração.
4. **Backfill não celebra.** PR registrado manualmente como histórico entra na lista, sem tela de PR.
5. **Primeira vez não é PR.** A primeira vez que a pessoa faz um exercício não gera recorde — gera "linha de base". Senão o primeiro treino dispara 15 celebrações e nenhuma significa nada.
6. **Guarda o anterior.** Todo PR grava `previousValue` e `previousAchievedAt`, porque o delta é o que a pessoa quer ver e o que faz o post render.
7. **Recálculo em massa.** O job `pr.recalc` reprocessa o histórico inteiro de um usuário quando um exercício é fundido, uma atividade é apagada ou a regra muda.

---

# 13. O que fica de fora, e por quê

| Fora | Motivo |
|---|---|
| Segmentos globais estilo Strava | Casamento de trecho entre usuários é problema pesado de geo. A versão viável é "suas rotas repetidas": comparar você com você mesmo no mesmo percurso |
| TSS, NP, IF (ciclismo) | Exige medidor de potência e FTP calibrado. Público pequeno demais para o custo |
| Zonas de frequência cardíaca | Depende de FC máxima confiável e de monitor. Fase 3, junto com a integração de wearables |
| Detecção automática de exercício | Reconhecer que você está fazendo supino por sensor é problema de ML, não de app |
| Golfe, esportes radicais, esportes motorizados | Cauda longa. `generic` com métricas customizadas atende |
| Contagem automática de reps por câmera | Demanda alta, entrega ruim. Todo app que tentou entregou algo que erra e frustra |
