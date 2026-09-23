import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

/**
 * Onde a pessoa PASSOU, não o que ela conseguiu.
 *
 * O painel de crescimento (`services/growthMetrics.ts`) mede resultado: se
 * registrou um treino, se voltou. Ele nunca responde "abriu o onboarding,
 * preencheu quatro campos e fechou o app" — e é essa frase que diz o que
 * consertar. Resultado dá para reconstruir do banco a qualquer momento, porque
 * está gravado nos próprios documentos; percurso, não: se ninguém registrou a
 * passagem na hora, ela não existe depois.
 *
 * Isto é diagnóstico, não histórico — daí o TTL. Cada linha vive o suficiente
 * para comparar o antes e o depois de uma mudança, e some.
 */

/**
 * A lista é FECHADA de propósito, e é a única salvaguarda de privacidade aqui:
 * nada que a pessoa digitou pode virar telemetria, porque só nome de evento
 * conhecido entra. Acrescentar um evento é acrescentar uma linha aqui.
 */
export const EVENTOS_CONHECIDOS = [
  // Entrada — o degrau onde hoje se perde a maior parte das pessoas.
  "onboarding_abriu",
  "onboarding_saiu",
  "onboarding_concluiu",
  "home_viu",
  // Registro do treino.
  "registrar_abriu",
  "registrar_esporte",
  "treino_salvo",
  // Saída para fora do app.
  "concluido_viu",
  "compartilhar_tocou",
  "card_gerado",
  "story_abriu",
] as const;

export type NomeDeEvento = (typeof EVENTOS_CONHECIDOS)[number];

/** Quanto tempo o detalhe fica. Diagnóstico não precisa de memória longa. */
export const RETENCAO_DIAS = 90;

const appEventSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    nome: { type: String, required: true },
    /** Poucas chaves, valores curtos — ver a validação em `routes/eventos.ts`. */
    props: { type: Schema.Types.Mixed, default: undefined },
    criadoEm: { type: Date, default: Date.now },
  },
  // Sem `timestamps`: `criadoEm` já é a hora do evento, e um `updatedAt` num
  // registro que nunca é atualizado seria só bytes a mais numa coleção que
  // cresce com cada tela aberta.
  { timestamps: false }
);

// O funil pergunta sempre "quem passou por este degrau nesta janela".
appEventSchema.index({ nome: 1, criadoEm: -1 });
// E, para contar PESSOAS em vez de eventos, agrupa por usuário dentro do nome.
appEventSchema.index({ user: 1, nome: 1 });
// O TTL. `criadoEm` ascendente é exigência do índice de expiração.
appEventSchema.index({ criadoEm: 1 }, { expireAfterSeconds: RETENCAO_DIAS * 24 * 60 * 60 });

export type AppEventDoc = HydratedDocument<InferSchemaType<typeof appEventSchema>>;

export const AppEvent = mongoose.model("AppEvent", appEventSchema);
