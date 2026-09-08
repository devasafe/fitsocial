import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage } from "./image.js";

/** Gera um JPEG com EXIF embutido, para provar que o processamento o remove. */
async function jpegComExif(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Software: "fitsocial-test" } } })
    .toBuffer();
}

describe("processImage", () => {
  it("remove os metadados EXIF (segurança: foto de celular carrega GPS)", async () => {
    const comExif = await jpegComExif(800, 600);
    // Garante que a entrada REALMENTE tem EXIF, senão o teste não prova nada.
    expect((await sharp(comExif).metadata()).exif).toBeDefined();

    const out = await processImage(comExif);

    expect((await sharp(out.buffer).metadata()).exif).toBeUndefined();
  });

  it("redimensiona imagens grandes para no máximo 1600px no maior lado", async () => {
    const grande = await jpegComExif(2000, 1000);

    const out = await processImage(grande);
    const meta = await sharp(out.buffer).metadata();

    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1600);
    expect(out.contentType).toBe("image/jpeg");
    expect(out.ext).toBe(".jpg");
  });

  it("não amplia imagens menores que o limite", async () => {
    const pequena = await jpegComExif(320, 240);

    const out = await processImage(pequena);
    const meta = await sharp(out.buffer).metadata();

    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
  });

  it("lança erro para um buffer que não é imagem válida", async () => {
    await expect(processImage(Buffer.from("isso não é imagem"))).rejects.toThrow();
  });
});
