import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

// Lê uma lista de chaves de várias envs (aceita CSV) e deduplica preservando ordem.
// Ex.: GEMINI_API_KEYS="k1,k2,k3" + GEMINI_API_KEY="k0" → [k0? ...] na ordem lida.
function keyList(...names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const raw = process.env[name];
    if (!raw) continue;
    for (const k of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!out.includes(k)) out.push(k);
    }
  }
  return out;
}

// Teto diário de chamadas por chave, no formato "gemini#1=1500,groq#1=14400".
// Serve só para o painel mostrar "quanto já queimei hoje" — não bloqueia nada.
function dailyLimits(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const par of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [chave, valor] = par.split("=").map((s) => s.trim());
    const n = Number(valor);
    if (chave && Number.isFinite(n) && n > 0) out[chave] = n;
  }
  return out;
}

export const env = {
  /** O nome do produto, num lugar só.
   *
   *  Tudo que a pessoa lê — e-mail de senha, título de push, as falas do coach
   *  — sai daqui. Trocar o nome do app é mudar esta linha (ou a env APP_NAME) e
   *  as constantes equivalentes em app-android/src/marca.ts e
   *  admin/src/marca.ts. São três porque os três Dockerfiles copiam só a
   *  própria pasta: um arquivo compartilhado na raiz não existiria dentro do
   *  build.
   *
   *  O que NÃO sai daqui, de propósito: o package Android, o slug do Expo, o
   *  projeto no Firebase, o nome do banco e as chaves "fitsocial.*" de
   *  armazenamento local. Mexer neles faz quem já tem o app instalar um app
   *  separado, ou perder a sessão. */
  appName: process.env.APP_NAME ?? "FitSocial",

  port: Number(process.env.PORT ?? 4000),
  mongoUri: required("MONGODB_URI", "mongodb://127.0.0.1:27017/fitsocial"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30d",
  // Camada de IA desacoplada: escolhe o provider por env (default: gemini).
  aiProvider: process.env.AI_PROVIDER ?? "gemini",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  // Fallback de IA: várias chaves grátis em cadeia. Quando uma estoura a quota
  // (429) ou falha, cai pra próxima. Todas aceitam CSV (uma env com várias chaves).
  geminiApiKeys: keyList("GEMINI_API_KEYS", "GEMINI_API_KEY"),
  groqApiKeys: keyList("GROQ_API_KEYS", "GROQ_API_KEY"),
  // O llama-3.3-70b-versatile saiu do catálogo do Groq. Conferido em 09/09/2026:
  // gpt-oss-120b responde em ~2s, devolve JSON válido e escreve bem em português.
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  openrouterApiKeys: keyList("OPENROUTER_API_KEYS", "OPENROUTER_API_KEY"),
  openrouterModel: process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free",
  // Chave da YouTube Data API v3 (opcional). Sem ela, os vídeos de exercício degradam graciosamente.
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  // Camada de storage plugável: "disk" (local, default) ou "s3" (S3/R2/MinIO).
  storageProvider: process.env.STORAGE_PROVIDER ?? "disk",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Region: process.env.S3_REGION ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  // Base pública de onde as imagens são servidas (ex.: https://cdn.seu-dominio/fotos).
  mediaPublicBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL ?? "",
  // Segredo esperado no header Authorization do webhook do RevenueCat (opcional).
  revenuecatWebhookAuth: process.env.REVENUECAT_WEBHOOK_AUTH ?? "",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  // O painel é uma segunda origem, então CORS_ORIGIN passou a aceitar lista
  // separada por vírgula. Uma origem só continua funcionando igual.
  corsOrigins: keyList("CORS_ORIGIN").length ? keyList("CORS_ORIGIN") : ["*"],
  // Sessão do painel é curta de propósito: quem entra ali apaga contas.
  adminSessionExpiresIn: process.env.ADMIN_SESSION_EXPIRES_IN ?? "12h",
  // Tetos diários por chave de IA, para o painel administrativo.
  aiDailyLimits: dailyLimits(process.env.AI_DAILY_LIMITS),
  // Quanto esperar por uma resposta de IA antes de desistir.
  //
  // 25s vem de medição, não de chute: o Gemini responde em 17-20s quando está
  // bom, e passa de 45s quando trava. O Groq entrega o mesmo plano em 9-12s.
  // Esperar mais que isso é queimar tempo de quem está olhando a tela antes de
  // chamar quem responde rápido.
  // E-mail. Sem RESEND_API_KEY o projeto usa o provider de console em
  // desenvolvimento e RECUSA subir em produção — melhor um erro claro do que
  // um "esqueci a senha" que promete um e-mail que nunca chega.
  brevoApiKey: process.env.BREVO_API_KEY ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  mailFromEmail: process.env.MAIL_FROM_EMAIL ?? "nao-responda@satriz.club",
  get mailFrom(): string {
    return process.env.MAIL_FROM ?? `${this.appName} <${this.mailFromEmail}>`;
  },
  get mailFromName(): string {
    return process.env.MAIL_FROM_NAME ?? this.appName;
  },
  mailTimeoutMs: Number(process.env.MAIL_TIMEOUT_MS ?? 10000),

  // Push. O envio funciona sem token, com limite mais apertado; com ele, o
  // Expo também recusa quem não é dono do projeto.
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? "",
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 25000),
  // Quantas vezes insistir na MESMA chave quando a falha é passageira (5xx).
  aiRetries: Number(process.env.AI_RETRIES ?? 1),
  // Teto de tokens na resposta. Sem isto o Groq corta a saída no default dele e
  // o JSON do plano chega quebrado ("Failed to validate JSON"). Um plano
  // completo gasta cerca de 2.800 tokens, então 8.000 dá folga larga.
  aiMaxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 8000),
  // Por quantos dias guardar o detalhe de cada chamada de IA (TTL da coleção).
  aiUsageRetentionDays: Number(process.env.AI_USAGE_RETENTION_DAYS ?? 180),
  isProd: process.env.NODE_ENV === "production",
};
