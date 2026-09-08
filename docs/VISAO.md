# FitSocial — Visão de Produto

> Fonte de verdade de **produto**. Para a arquitetura técnica, veja
> [`ARQUITETURA.md`](./ARQUITETURA.md).

## O que é

FitSocial é um app que une, num só lugar, um **coach de treino e dieta por IA** e uma
**rede social de treino**. O objetivo é fechar um ciclo de retenção: a IA gera/ajusta o
plano → a pessoa treina e registra → compartilha a evolução com a comunidade → volta ao
app para continuar.

## O pivô (setembro/2026)

O FitSocial nasceu focado em **musculação + dieta**. A partir de agora ele evolui para uma
**plataforma multiesporte social**: qualquer pessoa registra qualquer tipo de treino
(musculação, corrida, ciclismo, jiu-jitsu, crossfit…), acompanha a evolução, e participa de
uma comunidade e de desafios em grupo.

Ambição: **produto para lançar de verdade**, com usuários reais e monetização. As decisões
de arquitetura e infraestrutura seguem essa ambição (ver `ARQUITETURA.md`), mas de forma
**evolutiva** — cada peça de infra entra quando uma feature a exige, não antes.

## Público

- **Iniciantes** que não sabem por onde começar e não têm como pagar personal + nutricionista.
- **Praticantes de qualquer esporte** que querem registrar treino, ver progresso e ter
  comunidade — sem depender de um app diferente para cada modalidade.

## Pilares

| Pilar | Estado | Descrição |
|---|---|---|
| **Coach IA (treino + dieta)** | Existe | Onboarding conversacional → ficha → plano gerado por IA; chat com o coach; reajuste por adesão. |
| **Rede social** | Existe | Posts com foto, feed de quem você segue, curtir, comentar, perfil com `@username`. |
| **Gamificação** | Existe (parcial) | Badges por conquistas + ranking (leaderboard) entre pessoas que você segue. |
| **Registro multiesporte** | Novo (Fase 2) | Sessões de treino de qualquer esporte, cada uma com o formato certo (carga/reps, distância/pace, aula, WOD…). |
| **GPS / rota** | Novo (Fase 3) | Corrida e ciclismo com rastreamento de rota, distância, pace e mapa. |
| **Desafios em grupo** | Novo (Fase 4) | Metas coletivas e competições (ex.: correr 50 km no mês), com ranking do desafio. |

## Modelo de negócio

**Freemium.** O grátis entrega o essencial; recursos avançados (regenerar/reajustar plano por
IA, e o que for definido nas próximas fases) exigem **Premium**. Assinatura in-app via
**RevenueCat + Google Play Billing** (o `dev-upgrade` atual é só para demonstração). A
integração real do RevenueCat ainda não foi plugada.

## Guardrails de saúde (inegociáveis)

- Triagem de lesões/condições no onboarding, respeitada na geração e no reajuste do plano.
- Aviso visível "não substitui profissional" no onboarding e no plano.
- A IA nunca gera meta calórica abaixo de um piso seguro configurável.
- Nenhum texto do app usa linguagem de vergonha corporal nem pune quem "falhou" na dieta.
- Diante de sinal de transtorno alimentar, a IA orienta procurar profissional em vez de
  fornecer números.
- Idioma de toda a interface e de todo texto gerado por IA: **português do Brasil**.

## O que NÃO é (por enquanto)

Para evitar espalhar escopo: FitSocial não é um wearable, não substitui prescrição médica, e
não pretende competir em features de nicho (ex.: análise biomecânica). O foco é o ciclo
coach → treino → comunidade, agora estendido a múltiplos esportes.
