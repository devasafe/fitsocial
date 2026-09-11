import type mongoose from "mongoose";
import { Activity, type ActivityCreateInput } from "../models/Activity.js";
import { Post } from "../models/Post.js";
import { User } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { visibilidadeParaNovaAtividade } from "./activityVisibility.js";
import { getSport } from "./sports.js";
import { interpretarBlocos, normalizarWod } from "./crossfit.js";
import { computeMetrics } from "./activityMetrics.js";
import { detectPRs, type NewPR } from "./prEngine.js";
import { processTrack } from "./trackProcessing.js";

export interface CreatedActivity {
  activity: InstanceType<typeof Activity>;
  post: InstanceType<typeof Post> | null;
  newPRs: NewPR[];
}

/**
 * Cria uma atividade (Fase 2a: kind "strength"), calcula as métricas e,
 * opcionalmente, compartilha no feed criando um Post que a referencia.
 * Reutilizado pelo cutover do check-in.
 */
export async function createActivity(
  userId: mongoose.Types.ObjectId,
  input: ActivityCreateInput
): Promise<CreatedActivity> {
  // Precisa do documento para saber a preferência de visibilidade da pessoa.
  const dono = await User.findById(userId);
  if (!dono) throw new HttpError(404, "Usuário não encontrado");

  let storedPayload: unknown = input.payload;
  let durationSec = input.durationSec ?? 0;

  // O interpretador roda AQUI, no salvamento — nunca na digitação.
  //
  // É o que preenche `lido` em cada bloco a partir do modo escrito, e é o que
  // dá timer, tipo de score sugerido e a distinção entre WOD e descanso ao
  // resto do sistema. Sem esta linha os blocos são gravados crus: o cartão
  // mostra o aquecimento, o card do feed não sabe o que é descanso, e nada
  // disso dá erro — só fica errado em silêncio.
  //
  // Rodar de novo em cima de um treino já salvo é seguro e desejado: `lido` é
  // derivado, e reinterpretar é como todo treino antigo melhora quando o
  // interpretador melhorar.
  if (input.kind === "wod") {
    storedPayload = interpretarBlocos(normalizarWod(input.payload));
  }

  let metrics = computeMetrics({ ...input, payload: storedPayload } as ActivityCreateInput);

  // Fase 3a: endurance com track de GPS — distância/tempo/melhores trechos
  // derivados do percurso no servidor.
  if (input.kind === "endurance" && input.payload.points && input.payload.points.length >= 2) {
    const track = processTrack(input.payload.points);
    durationSec = track.elapsedTimeSec || durationSec;
    storedPayload = {
      ...input.payload,
      distanceM: track.distanceM,
      elevationGainM: track.elevationGainM,
      polyline: track.polyline,
      splits: track.splits,
      bestEfforts: track.bestEfforts,
    };
    const distanceKm = track.distanceM / 1000;
    metrics = {
      distanceKm,
      avgPaceSecPerKm: distanceKm > 0 && durationSec > 0 ? durationSec / distanceKm : 0,
      speedKmh: durationSec > 0 ? distanceKm / (durationSec / 3600) : 0,
      elevationGainM: track.elevationGainM,
    };
  }

  const activity = await Activity.create({
    user: userId,
    sportId: input.sportId,
    kind: input.kind,
    title: input.title ?? "",
    startedAt: input.startedAt ?? new Date(),
    durationSec,
    // A escolha explícita manda; sem ela, vale a preferência da pessoa.
    visibility: input.visibility ?? visibilidadeParaNovaAtividade(dono),
    perceivedEffort: input.perceivedEffort,
    feeling: input.feeling,
    notes: input.notes ?? "",
    planLink: input.planLink,
    payload: storedPayload,
    metrics,
  });

  // Detecção de PR (Fase 2c) — força, endurance e aulas, síncrona.
  const newPRs = await detectPRs(userId, {
    _id: activity._id,
    sportId: activity.sportId,
    kind: activity.kind,
    startedAt: activity.startedAt,
    durationSec: activity.durationSec,
    payload: activity.payload,
  });

  let post: InstanceType<typeof Post> | null = null;
  if (input.shareToFeed) {
    const sport = getSport(input.sportId);
    const text = input.caption?.trim() || `Treino de ${sport?.label ?? input.sportId} concluído 💪`;
    post = await Post.create({ author: userId, text, activity: activity._id });
  }

  return { activity, post, newPRs };
}
