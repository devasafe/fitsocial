import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppEvent, EVENTOS_CONHECIDOS } from "../models/AppEvent.js";

export const eventosRouter = Router();

eventosRouter.use(requireAuth);

/**
 * Valores curtos e de tipo simples, no máximo cinco por evento.
 *
 * O limite não é economia de espaço: é o que impede texto escrito pela pessoa
 * de escorregar para dentro da telemetria. Propriedade aqui é dimensão de
 * análise ("qual esporte", "quantos campos"), nunca conteúdo.
 */
const valorDaProp = z.union([z.string().max(40), z.number(), z.boolean()]);

const eventoSchema = z.object({
  nome: z.string().min(1).max(60),
  props: z
    .record(valorDaProp)
    .refine((p) => Object.keys(p).length <= 5, "No máximo 5 propriedades por evento")
    .optional(),
});

/** Em lote porque o app enfileira: uma requisição por tela aberta seria absurdo. */
const loteSchema = z.object({
  eventos: z.array(eventoSchema).min(1).max(100),
});

const CONHECIDOS: readonly string[] = EVENTOS_CONHECIDOS;

eventosRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { eventos } = loteSchema.parse(req.body);

    // Nome desconhecido é IGNORADO, não recusado: o app e a API sobem em
    // deploys separados, então um evento novo no app sempre chega antes de a
    // API conhecê-lo. Derrubar o lote inteiro por causa disso perderia junto os
    // eventos que a API entende — e telemetria que some no deploy é pior que
    // telemetria incompleta.
    //
    // Propriedade malformada, ao contrário, derruba o lote (o zod acima já
    // recusou): aquilo é erro de quem escreveu a chamada, e falhar alto é o que
    // evita descobrir semanas depois que o dado estava sujo.
    const aceitos = eventos.filter((e) => CONHECIDOS.includes(e.nome));

    if (aceitos.length > 0) {
      await AppEvent.insertMany(
        // O dono do evento é sempre quem está autenticado. Se viesse do corpo,
        // qualquer pessoa poderia escrever percurso na conta de outra.
        aceitos.map((e) => ({ user: req.user!._id, nome: e.nome, props: e.props }))
      );
    }

    res.status(201).json({
      data: { aceitos: aceitos.length, ignorados: eventos.length - aceitos.length },
      meta: {},
    });
  })
);
