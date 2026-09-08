import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required("MONGODB_URI", "mongodb://127.0.0.1:27017/fitsocial"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30d",
  // Camada de IA desacoplada: escolhe o provider por env (default: gemini).
  aiProvider: process.env.AI_PROVIDER ?? "gemini",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
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
  isProd: process.env.NODE_ENV === "production",
};
