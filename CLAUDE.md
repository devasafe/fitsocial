# FitSocial — instruções permanentes

Fonte de verdade de **produto**: `docs/VISAO.md`. De **arquitetura**: `docs/ARQUITETURA.md`.
De **segurança**: `docs/SECURITY.md`. **Leia o(s) relevante(s) antes de qualquer alteração
estrutural.** Se algo nesses documentos estiver errado, incompleto ou impossível, diga isso —
não contorne em silêncio.

## O que é

App multiesporte social com coach de IA (treino + dieta) + rede social de treino. Já está no
ar; em pivô de "só musculação" para multiesporte (corrida/GPS, jiu-jitsu, etc.) e desafios.

## Stack real

Node 20+ · Express · TypeScript **strict** · MongoDB/Mongoose · zod · Expo/React Native.
Deploy **hoje**: tudo na VPS via Coolify — API em `fitapi.satriz.club`, web em
`fit.satriz.club`, fotos no MinIO (`fitcdn.satriz.club`), Mongo self-hosted e fechado, IA no
Gemini free tier. Detalhes e armadilhas de infra: `docs/INFRA.md`. **Não há** Redis, BullMQ
nem worker — entram só quando uma feature exigir (ver `ARQUITETURA.md` §6).
Entrypoint: `api/src/index.ts` → `api/src/app.ts`.

## Estrutura

Backend flat por tipo: `config/ middleware/ models/ routes/ services/ utils/`. Código **novo**
segue o padrão de módulo: `model · schema (zod) · service · routes (finas) · test`. Rota não
contém regra de negócio — delega ao service. IA só dentro de `services/ai/` (interface
`AIProvider`).

## Sempre

- zod em toda entrada, antes da regra.
- Teste de integração (Mongo em memória) para todo endpoint novo — é a âncora de memória
  entre sessões.
- Envelope `{ data, meta }` / `{ error }` e paginação por **cursor** em endpoints/listas
  **novos**. Não reescrever endpoints antigos estáveis em massa (YAGNI); migrar quando tocá-los.
- IDs de esporte são strings estáveis (`'musculacao'`, `'corrida'`). Dinheiro em centavos
  (inteiro). Datas em UTC no banco; `America/Sao_Paulo` só na borda.
- Interface e saída de IA em **português do Brasil**.
- Commits em Conventional Commits, em português.

## Nunca

- Segredo no código ou em log; dado de saúde / coordenada / token / e-mail completo em log.
- Meta calórica abaixo do piso seguro; plano que contrarie lesão declarada na ficha; linguagem
  de vergonha corporal.
- Migração de dados sem script de rollback no mesmo PR.
- `any` sem comentário justificando.
- Trocar biblioteca, banco, regra de plano/preço ou infra sem perguntar.
- Se achar segredo no histórico do git: **pare e avise**.

## Protocolo

PLANO (esperar "ok") → EXECUÇÃO (testes junto) → VERIFICAÇÃO (colar saída real de
lint/typecheck/testes) → ENTREGA (o que mudou, como testar, o que ficou frágil).
Percebeu que o plano estava errado no meio? Pare e avise. Não improvise.
