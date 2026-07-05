# Vídeos de execução dos exercícios — Design

**Data:** 2026-07-05
**Status:** Aprovado o desenho de alto nível (abordagem C). Aguardando revisão da spec.

## Problema

Os planos de treino do FitSocial listam cada exercício apenas como um **nome em texto livre** (`exercise.name`, gerado pela IA Gemini). Usuários iniciantes não sabem executar um exercício só pelo nome ("puxada supinada", "crucifixo inclinado"). Falta uma forma visual, dentro do app, de ver o movimento correto.

## Objetivo

Ao lado de cada exercício (nas telas de treino), mostrar uma **miniatura (thumbnail)** de um vídeo curto de execução. Ao tocar, abre um **player embutido**. A associação nome→vídeo deve ser **automática**, sem curadoria manual obrigatória, mas com qualidade que melhora com o tempo.

## Abordagem escolhida (C — Híbrido com cache compartilhado)

Uma coleção `ExerciseVideo` no Mongo funciona como cache/catálogo compartilhado entre todos os usuários, que **cresce sozinho**:

1. Na 1ª vez que um exercício aparece, o backend busca no YouTube uma vez, guarda o resultado e retorna.
2. Todos os próximos usuários com o mesmo exercício batem no **cache** — sem gastar quota da YouTube API.
3. Como nomes de exercícios se repetem muito entre usuários, o cache satura rápido e passa a servir quase tudo localmente.
4. O campo `pinned` permite sobrescrever/corrigir manualmente uma entrada ruim — curadoria só onde importa.

Fonte de vídeo: **YouTube** (thumbnails e embed triviais e gratuitos). TikTok fica fora de escopo (API fechada, embed ruim).

### Por que não as alternativas
- **A (busca 100% dinâmica):** estoura a quota grátis da YouTube Data API (~100 buscas/dia) sem cache.
- **B (catálogo 100% curado):** trabalho manual alto e engessaria a geração de plano (a IA teria que ficar presa a nomes fixos).

## Arquitetura

### Backend (`api/`)

**Modelo `api/src/models/ExerciseVideo.ts`**
```
{
  normalizedName: string,   // chave de cache, índice ÚNICO
  displayName: string,      // nome original que originou a entrada
  youtubeId: string | null, // null = "miss" (busca não achou nada; evita re-tentar sempre)
  thumbnailUrl: string,     // derivado do youtubeId (hqdefault)
  title: string,            // título do vídeo no YouTube
  source: "youtube" | "curated",
  pinned: boolean,          // true = não sobrescrever automaticamente (curadoria manual)
  createdAt, updatedAt
}
```
- Índice único em `normalizedName`.

**Normalização de nome** (`api/src/services/exerciseVideo.ts` — helper `normalizeExerciseName`)
- minúsculas + remover acentos + colapsar espaços + `trim`.
- Ex.: `"Supino Reto com Barra"` → `supino reto com barra`.
- **Não** remove qualificadores como "com barra"/"na máquina" — eles mudam o exercício.

**Serviço `resolveExerciseVideo(name)`** (`api/src/services/exerciseVideo.ts`)
1. Normaliza o nome.
2. Procura no cache (`ExerciseVideo.findOne({ normalizedName })`).
   - Se achar (inclusive um "miss" recente), retorna.
3. Se não existe e há `YOUTUBE_API_KEY`: chama YouTube Data API `search.list`
   - `q = "<nome> execução correta"`, `type=video`, `videoDuration=short`, `maxResults=1`, `relevanceLanguage=pt`, `safeSearch=strict`.
   - Pega o 1º resultado → persiste `{ youtubeId, thumbnailUrl, title, source: "youtube", pinned: false }`.
   - Se a API não achar nada → persiste um "miss" (`youtubeId: null`) para não re-tentar toda hora.
4. Se **não** há `YOUTUBE_API_KEY`: não persiste nada, retorna `null` (feature degrada — app mostra fallback).
5. Falha da API (erro/quota): loga e retorna `null` **sem** persistir miss (para tentar de novo depois).

**Rota `api/src/routes/exerciseVideos.ts`**
- `POST /exercise-videos/resolve` — body `{ names: string[] }` (a sessão inteira de uma vez).
  - Retorna `{ videos: Record<originalName, { youtubeId, thumbnailUrl, title } | null> }`.
  - `requireAuth` (segue o padrão `router.use(requireAuth)`).
  - `rateLimit({ windowMs: 60_000, max: 30, name: "exercise-videos" })`.
  - Resolve os nomes em paralelo, deduplicando por nome normalizado dentro do request.
- Registrar em `api/src/app.ts`: `app.use("/exercise-videos", exerciseVideosRouter)`.

**Config** (`api/src/config/env.ts`)
- Adicionar `youtubeApiKey: process.env.YOUTUBE_API_KEY ?? ""` (opcional; ausência degrada a feature, não quebra).

### App (`app-android/`)

**Client `app-android/src/api/exerciseVideos.ts`**
- `resolveExerciseVideos(names: string[], token): Promise<Record<string, VideoRef | null>>` usando `apiFetch`.

**Componente `app-android/src/components/ExerciseVideoThumb.tsx`**
- Recebe `video: VideoRef | null` e `exerciseName`.
- Com vídeo: miniatura pequena (~64×40) com `thumbnailUrl` + ícone ▶ sobreposto. Ao tocar → abre modal.
- Sem vídeo / sem API key: ícone neutro ▶ que abre a **busca no YouTube externo** (`Linking.openURL`) como fallback — nunca fica quebrado nem some.
- Estado de loading: placeholder discreto (mesma caixa, shimmer/opaco) enquanto resolve.

**Modal de player `app-android/src/components/ExerciseVideoModal.tsx`**
- Player embutido do YouTube. Biblioteca: `react-native-youtube-iframe` (preferida) com fallback para `WebView` embed. **Decisão de lib validada na 1ª fatia de implementação** (verificar compatibilidade Expo). Se nenhuma servir bem no Expo web, cai para abrir externo.

**Integração nas telas**
- `WorkoutScreen.tsx`: ao montar, coletar todos os `exercise.name` das sessões e chamar `resolveExerciseVideos` (1 request batch). Renderizar `ExerciseVideoThumb` no `exerciseHeader`, ao lado do nome.
- `CheckInScreen.tsx`: idem, dentro de cada card de exercício do checklist ao vivo.

## Fluxo de dados

```
WorkoutScreen/CheckInScreen (monta)
  → coleta nomes da sessão
  → POST /exercise-videos/resolve { names }
      → para cada nome: resolveExerciseVideo
          → cache hit? retorna
          → senão: YouTube search → persiste → retorna
  → mapa nome→vídeo
  → cada ExerciseVideoThumb renderiza miniatura (ou fallback ▶)
  → toque → ExerciseVideoModal (player embutido)
```

## Tratamento de erros / degradação

- Sem `YOUTUBE_API_KEY`: rota responde 200 com todos `null`; app mostra fallback ▶ (busca externa). Treino nunca quebra.
- YouTube API falha/quota: serviço retorna `null` para aquele nome, sem persistir miss; resto do treino segue normal.
- Falha de rede no app: miniaturas não aparecem, exercícios continuam listados (a resolução de vídeo é totalmente não-bloqueante do fluxo de treino).

## Testes

Backend (Jest + mongodb-memory-server, seguindo o padrão existente):
- `normalizeExerciseName`: acentos, caixa, espaços, qualificadores preservados.
- `resolveExerciseVideo`: cache hit não chama a API; cache miss chama a API (mockada) e persiste; "miss" persistido não re-chama; sem API key retorna null sem persistir.
- Rota `/exercise-videos/resolve`: requer auth; dedup de nomes; formato da resposta; rate limit.

App: typecheck limpo (padrão do projeto). Validação visual (miniatura + modal) fica com o Asafe no emulador — não há render automatizado.

## Fora de escopo (YAGNI)

- TikTok (API fechada, embed ruim — YouTube cobre a necessidade).
- Tela de administração de curadoria (o campo `pinned` já deixa a porta aberta para o futuro).
- Pré-aquecimento do cache no momento em que o plano é gerado (pode ser uma otimização v2; por ora resolve-se sob demanda ao abrir a tela).

## Variáveis de ambiente novas

- `YOUTUBE_API_KEY` (opcional) — chave da YouTube Data API v3. Sem ela, a feature degrada graciosamente.
