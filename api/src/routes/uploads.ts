import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { processImage } from "../services/media/image.js";
import { getStorageProvider } from "../services/storage/index.js";

/**
 * Teto do arquivo que CHEGA, que não é o teto do que fica guardado.
 *
 * `processImage` reduz para 1600px no maior lado e reencoda como JPEG 82 —
 * uma foto de 18 MB vira algo em torno de 300 KB no disco. Este limite não
 * protege o armazenamento, protege a memória do servidor no caminho de entrada
 * (o multer segura o arquivo inteiro em RAM antes do sharp).
 *
 * Eram 5 MB, e foi pouco: câmera de celular de hoje produz foto de 4 a 12 MB
 * sem esforço, então gente normal postando foto normal batia no teto. E batia
 * com "File too large", em inglês, porque a mensagem crua do multer vazava
 * para a tela.
 */
const TAMANHO_MAXIMO_MB = 20;

// Guarda o arquivo em memória; o processamento (sharp) e o destino (disco/S3)
// ficam a cargo da camada de storage. Sem multer.diskStorage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Apenas imagens são permitidas"));
  },
});

/**
 * Envolve o multer para transformar seus erros em HttpError 400.
 *
 * As mensagens do multer são em inglês e escritas para quem programa
 * ("File too large", "Unexpected field"). Vazavam inteiras para a tela de quem
 * só queria postar uma foto. Aqui elas viram português, e a de tamanho diz o
 * limite — um erro que não diz o que fazer é um erro que vira chamado.
 */
function mensagemDoUpload(err: Error): string {
  const codigo = (err as Error & { code?: string }).code;
  if (codigo === "LIMIT_FILE_SIZE") {
    return `Esta imagem passa de ${TAMANHO_MAXIMO_MB} MB. Tente uma foto menor.`;
  }
  if (codigo === "LIMIT_FILE_COUNT" || codigo === "LIMIT_UNEXPECTED_FILE") {
    return "Mande uma imagem por vez.";
  }
  return err.message || "Falha no upload";
}

function uploadSingle(req: Request, res: Response, next: NextFunction) {
  upload.single("image")(req, res, (err: unknown) => {
    if (err) return next(new HttpError(400, mensagemDoUpload(err as Error)));
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

    // width/height são aditivos: o APK antigo lê só `url` e ignora o resto.
    res.status(201).json({
      url: toAbsolute(req, saved.url),
      width: processed.width,
      height: processed.height,
    });
  })
);
