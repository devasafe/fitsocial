import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { DiskStorage, UPLOADS_DIR } from "./disk.js";
import { S3Storage } from "./s3.js";
import { getStorageProvider, setStorageProvider } from "./index.js";
import type { StorageProvider } from "./provider.js";

const criados: string[] = [];

afterAll(() => {
  for (const nome of criados) {
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, nome));
    } catch {
      /* já removido */
    }
  }
  setStorageProvider(null);
});

describe("DiskStorage", () => {
  it("grava o arquivo no disco e retorna uma URL relativa /uploads/", async () => {
    const disk = new DiskStorage();
    const out = await disk.save({ buffer: Buffer.from("conteudo"), contentType: "image/jpeg", ext: ".jpg" });

    expect(out.url.startsWith("/uploads/")).toBe(true);
    const nome = out.url.replace("/uploads/", "");
    criados.push(nome);
    expect(fs.existsSync(path.join(UPLOADS_DIR, nome))).toBe(true);
  });
});

describe("S3Storage", () => {
  it("envia um PutObject e retorna a URL pública montada a partir do bucket", async () => {
    const enviados: PutObjectCommand[] = [];
    const clienteFake = {
      async send(cmd: PutObjectCommand) {
        enviados.push(cmd);
        return {};
      },
    };

    const s3 = new S3Storage({
      client: clienteFake as never,
      bucket: "fotos",
      publicBaseUrl: "https://cdn.exemplo.com/fotos",
    });
    const out = await s3.save({ buffer: Buffer.from("x"), contentType: "image/jpeg", ext: ".jpg" });

    expect(enviados).toHaveLength(1);
    const cmd = enviados[0];
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input.Bucket).toBe("fotos");
    expect(cmd.input.ContentType).toBe("image/jpeg");
    expect(out.url.startsWith("https://cdn.exemplo.com/fotos/")).toBe(true);
    expect(out.url.endsWith(".jpg")).toBe(true);
    // A URL termina com a mesma key enviada ao bucket.
    expect(out.url.endsWith(cmd.input.Key as string)).toBe(true);
  });
});

describe("factory de storage", () => {
  it("usa DiskStorage por padrão", () => {
    setStorageProvider(null);
    expect(getStorageProvider().name).toBe("disk");
  });

  it("permite injetar um provider (para testes)", () => {
    const fake: StorageProvider = {
      name: "fake",
      save: async () => ({ url: "https://fake/x.jpg" }),
    };
    setStorageProvider(fake);
    expect(getStorageProvider()).toBe(fake);
    setStorageProvider(null);
  });
});
