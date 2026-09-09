import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

// Registro imutável de toda ação administrativa. Nenhuma rota atualiza ou
// apaga: se pudesse ser editado, não serviria como prova do que aconteceu.
//
// O que NÃO pode entrar aqui: e-mail completo (usar maskEmail), senha, token,
// qualquer campo de Profile (dado de saúde) e coordenada. Ver docs/SECURITY.md.
const adminAuditSchema = new Schema(
  {
    // null = ação do sistema (script de bootstrap, expiração automática).
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorLabel: { type: String, default: "" },
    action: { type: String, required: true, index: true },
    targetKind: {
      type: String,
      enum: ["user", "post", "comment", "aiKey", "system"],
      required: true,
    },
    targetId: { type: Schema.Types.ObjectId, default: null },
    /** Identificação legível do alvo — username, ou e-mail MASCARADO. */
    targetLabel: { type: String, default: "" },
    reason: { type: String, default: "", maxlength: 500 },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

adminAuditSchema.index({ createdAt: -1 });
adminAuditSchema.index({ targetId: 1, createdAt: -1 });

export type AdminAuditDoc = HydratedDocument<InferSchemaType<typeof adminAuditSchema>>;

export const AdminAudit = mongoose.model("AdminAudit", adminAuditSchema);
