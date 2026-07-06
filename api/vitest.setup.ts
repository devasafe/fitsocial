// Executado pelo vitest antes de qualquer módulo de teste, garantindo que as
// variáveis de ambiente existam quando config/env.ts for carregado.
process.env.JWT_SECRET = "segredo-de-teste-longo-o-suficiente";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.AI_PROVIDER = "gemini";
process.env.YOUTUBE_API_KEY = "test-key";
