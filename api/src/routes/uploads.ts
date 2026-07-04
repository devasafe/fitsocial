import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../utils/httpError.js";

// Pasta onde as imagens ficam salvas (servida estaticamente em /uploads).
export const UPLOADS_DIR = path.resolve("uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
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

export const uploadsRouter = Router();

uploadsRouter.post("/", requireAuth, uploadSingle, (req, res) => {
  if (!req.file) throw new HttpError(400, "Nenhuma imagem enviada");
  // URL absoluta baseada no host da requisição (funciona no web e no celular).
  const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.status(201).json({ url });
});
