import { Router } from "express";
import multer from "multer";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { FoodLog, foodLogCreateSchema } from "../models/FoodLog.js";
import { Plan } from "../models/Plan.js";
import { processImage } from "../services/media/image.js";
import { analisarRefeicao, exigirModeloComVisao } from "../services/ai/refeicaoPorFoto.js";

export const nutritionRouter = Router();
nutritionRouter.use(requireAuth);

function serialize(l: InstanceType<typeof FoodLog>) {
  return {
    id: l._id.toString(),
    date: l.date,
    meal: l.meal,
    name: l.name,
    kcal: l.kcal,
    proteinG: l.proteinG,
    carbsG: l.carbsG,
    fatG: l.fatG,
    gramas: l.gramas ?? null,
    origem: l.origem ?? "manual",
    imageUrl: l.imageUrl || "",
  };
}

// ---- análise de foto de refeição ----

// Em memória: a foto é analisada e descartada. Guardar o prato de todo mundo
// custaria armazenamento para um dado que ninguém revisita.
const uploadDaFoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Envie uma imagem"));
  },
}).single("image");

/**
 * Estima o que tem no prato. NÃO grava nada.
 *
 * A pessoa confere e corrige na tela seguinte, e só então os itens viram
 * registros — um modelo de visão estima porção pela aparência, ele não pesa o
 * prato, e um erro de 30% que entra calado no total do dia desanda a dieta sem
 * ela entender por quê.
 */
nutritionRouter.post(
  "/analisar-foto",
  // Cada análise é uma chamada de IA com imagem, que custa bem mais que texto.
  rateLimit({ windowMs: 60_000, max: 8, name: "refeicao-foto" }),
  (req, res, next) =>
    uploadDaFoto(req, res, (err: unknown) =>
      err ? next(new HttpError(400, (err as Error).message || "Falha no envio")) : next()
    ),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Nenhuma foto enviada");
    exigirModeloComVisao();

    // O mesmo processamento do upload de post: reduz o tamanho e DESCARTA o
    // EXIF. Foto de refeição é tirada em casa e carrega a coordenada de casa.
    let imagem;
    try {
      imagem = await processImage(req.file.buffer);
    } catch {
      throw new HttpError(400, "Arquivo de imagem inválido");
    }

    const analise = await analisarRefeicao(
      { base64: imagem.buffer.toString("base64"), mimeType: imagem.contentType },
      { userId: req.user!._id.toString(), dica: typeof req.body?.dica === "string" ? req.body.dica : undefined }
    );

    res.json({ data: analise });
  })
);

// Registra um alimento no diário.
nutritionRouter.post(
  "/logs",
  asyncHandler(async (req, res) => {
    const input = foodLogCreateSchema.parse(req.body);
    const log = await FoodLog.create({ user: req.user!._id, ...input });
    res.status(201).json({ data: serialize(log) });
  })
);

// Resumo do dia: itens, totais e a meta do plano.
nutritionRouter.get(
  "/day",
  asyncHandler(async (req, res) => {
    const date = String(req.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Data inválida (use yyyy-mm-dd)");

    const logs = await FoodLog.find({ user: req.user!._id, date }).sort({ createdAt: 1 });
    const totals = logs.reduce(
      (acc, l) => ({
        kcal: acc.kcal + l.kcal,
        proteinG: acc.proteinG + l.proteinG,
        carbsG: acc.carbsG + l.carbsG,
        fatG: acc.fatG + l.fatG,
      }),
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
    );

    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    const diet = plan?.diet as
      | { dailyCalories?: number; macros?: { proteinG: number; carbsG: number; fatG: number } }
      | undefined;
    const target = diet ? { dailyCalories: diet.dailyCalories ?? 0, macros: diet.macros ?? null } : null;

    res.json({ logs: logs.map(serialize), totals, target });
  })
);

// Alimentos recentes (distintos por nome, mais novo primeiro) — para o quick-add.
nutritionRouter.get(
  "/recent-foods",
  asyncHandler(async (req, res) => {
    const logs = await FoodLog.find({ user: req.user!._id }).sort({ createdAt: -1 }).limit(100);
    const seen = new Set<string>();
    const out: { name: string; kcal: number; proteinG: number }[] = [];
    for (const l of logs) {
      const key = l.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: l.name, kcal: l.kcal, proteinG: l.proteinG });
      if (out.length >= 15) break;
    }
    res.json({ data: out });
  })
);

// Apaga um registro.
nutritionRouter.delete(
  "/logs/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "ID inválido");
    const r = await FoodLog.deleteOne({ _id: req.params.id, user: req.user!._id });
    if (!r.deletedCount) throw new HttpError(404, "Registro não encontrado");
    res.json({ data: { deleted: true } });
  })
);
