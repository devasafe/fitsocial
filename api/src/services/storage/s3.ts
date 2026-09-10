import { PutObjectCommand, DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { randomKey, type FileToSave, type SavedFile, type StorageProvider } from "./provider.js";

export interface S3StorageConfig {
  client: S3Client;
  bucket: string;
  /** Base pública de onde os objetos são servidos (sem barra no fim). */
  publicBaseUrl: string;
}

/**
 * Armazenamento compatível com S3 — serve para AWS S3, Cloudflare R2 e MinIO
 * (self-hosted na VPS/Coolify). O objeto é enviado ao bucket e a URL pública é
 * montada a partir de `publicBaseUrl` + chave.
 */
export class S3Storage implements StorageProvider {
  readonly name = "s3";

  constructor(private readonly cfg: S3StorageConfig) {}

  async save(file: FileToSave): Promise<SavedFile> {
    const key = randomKey(file.ext || ".jpg");
    await this.cfg.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.contentType,
      })
    );
    const base = this.cfg.publicBaseUrl.replace(/\/+$/, "");
    return { url: `${base}/${key}` };
  }

  async delete(url: string): Promise<void> {
    const base = this.cfg.publicBaseUrl.replace(/\/+$/, "");
    // URL de outro lugar (avatar de rede social, imagem antiga de outro
    // provider): não é nossa para apagar, e tentar seria apagar por adivinhação.
    if (!url.startsWith(`${base}/`)) return;

    const key = url.slice(base.length + 1);
    if (!key) return;
    await this.cfg.client.send(
      new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key })
    );
  }
}
