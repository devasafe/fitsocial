import fs from "node:fs";
import path from "node:path";
import { randomKey, type FileToSave, type SavedFile, type StorageProvider } from "./provider.js";

/** Pasta onde as imagens ficam no disco local (servida estaticamente em /uploads). */
export const UPLOADS_DIR = path.resolve("uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/**
 * Armazenamento em disco local. Bom para desenvolvimento; em produção o disco
 * costuma ser efêmero (ex.: Render), então prefira o provider S3/MinIO.
 * Retorna uma URL relativa; a rota a converte em absoluta usando o host da requisição.
 */
export class DiskStorage implements StorageProvider {
  readonly name = "disk";

  async save(file: FileToSave): Promise<SavedFile> {
    const nome = randomKey(file.ext || ".jpg");
    await fs.promises.writeFile(path.join(UPLOADS_DIR, nome), file.buffer);
    return { url: `/uploads/${nome}` };
  }
}
