import { S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import { DiskStorage } from "./disk.js";
import { S3Storage } from "./s3.js";
import { StorageError, type StorageProvider } from "./provider.js";

let cached: StorageProvider | null = null;

/** Retorna o provider de storage configurado (singleton). Troque por env STORAGE_PROVIDER. */
export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  switch (env.storageProvider) {
    case "disk":
      cached = new DiskStorage();
      break;
    case "s3":
      cached = createS3FromEnv();
      break;
    default:
      throw new StorageError(`Provider de storage desconhecido: ${env.storageProvider}`);
  }
  return cached;
}

/** Permite injetar um provider (ex.: mock nos testes) ou resetar (null). */
export function setStorageProvider(provider: StorageProvider | null): void {
  cached = provider;
}

function createS3FromEnv(): S3Storage {
  const { s3Endpoint, s3Region, s3Bucket, s3AccessKeyId, s3SecretAccessKey, mediaPublicBaseUrl } = env;
  if (!s3Bucket || !s3AccessKeyId || !s3SecretAccessKey || !mediaPublicBaseUrl) {
    throw new StorageError(
      "STORAGE_PROVIDER=s3 exige S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY e MEDIA_PUBLIC_BASE_URL"
    );
  }
  const client = new S3Client({
    endpoint: s3Endpoint || undefined, // MinIO/R2 usam endpoint custom; S3 puro dispensa
    region: s3Region || "auto",
    credentials: { accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey },
    forcePathStyle: true, // MinIO exige path-style
  });
  return new S3Storage({ client, bucket: s3Bucket, publicBaseUrl: mediaPublicBaseUrl });
}

export { StorageError } from "./provider.js";
export type { StorageProvider } from "./provider.js";
