import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { processImage } from "../services/media/image.js";
import { getStorageProvider } from "../services/storage/index.js";

// Guarda o arquivo em memória; o processamento (sharp) e o destino (disco/S3)
// ficam a cargo da camada de storage. Sem multer.diskStorage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Apenas imagens são permitidas"));
  },
});

// Envolve o multer para transformar seus erros em HttpError 400.
function uploadSingle(req: Request, res: Response, next: NextFunction) {
  upload.single("image")(req, res, (err: unknown) => {
    if (err) return next(new HttpError(400, (err as Error).message || "Falha no upload"));
    next();
  });
}

/** URL relativa (/uploads/..) vira absoluta com o host da requisição; absoluta passa direto. */
function toAbsolute(req: Request, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${req.protocol}://${req.get("host")}${url}`;
}

export const uploadsRouter = Router();

uploadsRouter.post(
  "/",
  requireAuth,
  uploadSingle,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Nenhuma imagem enviada");

    let processed;
    try {
      processed = await processImage(req.file.buffer);
    } catch {
      throw new HttpError(400, "Arquivo de imagem inválido");
    }

    const saved = await getStorageProvider().save({
      buffer: processed.buffer,
      contentType: processed.contentType,
      ext: processed.ext,
    });

    res.status(201).json({ url: toAbsolute(req, saved.url) });
  })
);
