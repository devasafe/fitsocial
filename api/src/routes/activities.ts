import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { Activity, activityCreateSchema, strengthPayloadSchema } from "../models/Activity.js";
import { Follow } from "../models/Follow.js";
import { createActivity } from "../services/activities.js";
import { computeStrengthMetrics } from "../services/activityMetrics.js";
import { parseGpx } from "../services/gpx.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";

export const activitiesRouter = Router();
activitiesRouter.use(requireAuth);

function serializeActivity(a: InstanceType<typeof Activity>) {
  return {
    id: a._id.toString(),
    author: a.user.toString(),
    sportId: a.sportId,
    kind: a.kind,
    title: a.title,
    startedAt: a.startedAt,
    durationSec: a.durationSec,
    visibility: a.visibility,
    notes: a.notes,
    perceivedEffort: a.perceivedEffort ?? null,
    feeling: a.feeling ?? null,
    planLink: a.planLink ?? null,
    payload: a.payload,
    metrics: a.metrics,
    createdAt: a.get("createdAt") as Date,
  };
}

function assertObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "ID inválido");
}

// Cria uma atividade (2a: strength) e, se pedido, compartilha no feed.
activitiesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = activityCreateSchema.parse(req.body);
    const { activity, post, newPRs } = await createActivity(req.user!._id, input);
    res.status(201).json({
      data: serializeActivity(activity),
      meta: { sharedPostId: post?._id.toString() ?? null, newPRs },
    });
  })
);

// Importa um arquivo GPX como atividade de endurance (o servidor deriva o track).
const importGpxSchema = z.object({ sportId: z.string(), gpx: z.string().min(1) });
activitiesRouter.post(
  "/import-gpx",
  asyncHandler(async (req, res) => {
    const { sportId, gpx } = importGpxSchema.parse(req.body);
    const points = parseGpx(gpx);
    if (points.length < 2) throw new HttpError(400, "GPX sem pontos de trajeto suficientes");
    const input = activityCreateSchema.parse({ sportId, kind: "endurance", payload: { points } });
    const { activity, newPRs } = await createActivity(req.user!._id, input);
    res.status(201).json({ data: serializeActivity(activity), meta: { newPRs } });
  })
);

// Lista as próprias atividades, mais novas primeiro, com cursor.
activitiesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!._id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const cursor = req.query.cursor ? decodeCursor(String(req.query.cursor)) : null;

    const filter: mongoose.FilterQuery<typeof Activity> = { user: me };
    if (cursor) {
      filter.$or = [
        { startedAt: { $lt: cursor.startedAt } },
        { startedAt: cursor.startedAt, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
      ];
    }

    const docs = await Activity.find(filter).sort({ startedAt: -1, _id: -1 }).limit(limit + 1);
    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ startedAt: last.startedAt, id: last._id.toString() }) : null;

    res.json({ data: items.map(serializeActivity), meta: { nextCursor } });
  })
);

// Detalhe — respeita a visibilidade (dono sempre; público; seguidores).
activitiesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const a = await Activity.findById(req.params.id);
    if (!a) throw new HttpError(404, "Atividade não encontrada");

    const me = req.user!._id;
    const isOwner = a.user.toString() === me.toString();
    if (!isOwner) {
      if (a.visibility === "private") throw new HttpError(404, "Atividade não encontrada");
      if (a.visibility === "followers") {
        const follows = await Follow.exists({ follower: me, following: a.user });
        if (!follows) throw new HttpError(404, "Atividade não encontrada");
      }
    }
    res.json({ data: serializeActivity(a) });
  })
);

const updateSchema = z.object({
  title: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  visibility: z.enum(["private", "followers", "public"]).optional(),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  perceivedEffort: z.number().int().min(1).max(10).optional(),
  feeling: z.enum(["otimo", "bom", "normal", "ruim", "pessimo"]).optional(),
  payload: strengthPayloadSchema.optional(),
});

activitiesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const a = await Activity.findById(req.params.id);
    if (!a || a.user.toString() !== req.user!._id.toString()) {
      throw new HttpError(404, "Atividade não encontrada");
    }
    const patch = updateSchema.parse(req.body);
    if (patch.title !== undefined) a.title = patch.title;
    if (patch.notes !== undefined) a.notes = patch.notes;
    if (patch.visibility !== undefined) a.visibility = patch.visibility;
    if (patch.durationSec !== undefined) a.durationSec = patch.durationSec;
    if (patch.perceivedEffort !== undefined) a.perceivedEffort = patch.perceivedEffort;
    if (patch.feeling !== undefined) a.feeling = patch.feeling;
    if (patch.payload !== undefined) {
      a.payload = patch.payload;
      a.metrics = computeStrengthMetrics(patch.payload);
      a.markModified("payload");
      a.markModified("metrics");
    }
    await a.save();
    res.json({ data: serializeActivity(a) });
  })
);

activitiesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const r = await Activity.deleteOne({ _id: req.params.id, user: req.user!._id });
    if (!r.deletedCount) throw new HttpError(404, "Atividade não encontrada");
    res.json({ data: { deleted: true } });
  })
);
