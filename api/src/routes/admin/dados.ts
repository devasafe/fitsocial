import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError } from "../../utils/httpError.js";
import { recordAudit } from "../../services/adminAudit.js";

export const adminDadosRouter = Router();

// Acesso direto às coleções, para quando a tela certa ainda não existe.
//
// Existe porque o Mongo NÃO está exposto na internet — e não deve estar. Sem
// isto, apagar um documento errado exigia console web do provedor da VPS e
// mongosh digitado à mão, o que é pior de todos os jeitos: mais lento, sem
// registro nenhum, e com o risco de um `deleteMany` sem filtro.
//
// A regra que molda o arquivo: **isto grava o documento inteiro na auditoria
// antes de mexer nele**. Uma ferramenta que apaga sem deixar cópia é uma
// ferramenta que transforma um erro de clique em perda definitiva.

/**
 * Campos que NUNCA saem daqui.
 *
 * Hash de senha e token de reset não têm por que aparecer numa tela, e
 * gravá-los na auditoria seria espalhá-los para um segundo lugar. O painel
 * mostra que o campo existe, sem o valor.
 */
const SEGREDOS = new Set([
  "passwordHash",
  "password",
  "tokenHash",
  "token",
  "apiKey",
  "authToken",
  "pushToken",
]);

/** Troca o valor dos segredos por um marcador, recursivamente. */
function limpar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 8 || valor === null || valor === undefined) return valor;
  if (Array.isArray(valor)) return valor.map((v) => limpar(v, profundidade + 1));
  if (valor instanceof Date || valor instanceof mongoose.Types.ObjectId) return valor;
  if (typeof valor !== "object") return valor;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    out[k] = SEGREDOS.has(k) ? "«oculto»" : limpar(v, profundidade + 1);
  }
  return out;
}

/**
 * O modelo com este nome, ou 404.
 *
 * Só o que o Mongoose conhece. Uma coleção digitada errado não pode virar uma
 * coleção nova criada por engano — e um nome livre abriria a porta para mexer
 * em coleções internas do banco.
 */
function modelo(nome: string) {
  const encontrado = mongoose.modelNames().find((n) => n.toLowerCase() === nome.toLowerCase());
  if (!encontrado) throw new HttpError(404, `Não existe coleção "${nome}".`);
  return mongoose.model(encontrado);
}

/** As coleções, com quantos documentos cada uma tem. */
adminDadosRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const nomes = mongoose.modelNames().sort();
    const itens = await Promise.all(
      nomes.map(async (nome) => {
        const M = mongoose.model(nome);
        return {
          nome,
          colecao: M.collection.collectionName,
          documentos: await M.estimatedDocumentCount(),
        };
      })
    );
    res.json({ data: itens, meta: { total: itens.length } });
  })
);

const buscaSchema = z.object({
  /** Filtro em JSON, como no Compass. Vazio = tudo. */
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Cursor por `_id`, nunca offset. */
  cursor: z.string().optional(),
  /** Campo para ordenar. `-campo` para descendente. */
  ordem: z.string().optional(),
});

/** Busca documentos de uma coleção. */
adminDadosRouter.get(
  "/:colecao",
  asyncHandler(async (req, res) => {
    const { q, limit, cursor, ordem } = buscaSchema.parse(req.query);
    const M = modelo(String(req.params.colecao));

    let filtro: Record<string, unknown> = {};
    if (q && q.trim()) {
      try {
        filtro = JSON.parse(q) as Record<string, unknown>;
      } catch {
        throw new HttpError(400, "O filtro não é um JSON válido.");
      }
      // Um `$where` é JavaScript executado no servidor do banco. Nada que
      // venha de um campo de texto entra ali.
      if (JSON.stringify(filtro).includes("$where")) {
        throw new HttpError(400, "Filtro com $where não é permitido.");
      }
    }

    // O cursor é sempre por `_id` decrescente, independente da ordem pedida:
    // paginar por um campo que repete perde e duplica linhas.
    const consulta: Record<string, unknown> = { ...filtro };
    if (cursor) {
      if (!mongoose.isValidObjectId(cursor)) throw new HttpError(400, "Cursor inválido");
      consulta._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const sort: Record<string, 1 | -1> = ordem
      ? { [ordem.replace(/^-/, "")]: ordem.startsWith("-") ? -1 : 1, _id: -1 }
      : { _id: -1 };

    const docs = await M.find(consulta).sort(sort).limit(limit + 1).lean();
    const temMais = docs.length > limit;
    const pagina = temMais ? docs.slice(0, limit) : docs;

    res.json({
      data: pagina.map((d) => limpar(d)),
      meta: {
        nextCursor: temMais ? String((pagina[pagina.length - 1] as { _id: unknown })._id) : null,
        // A contagem do filtro, para a tela dizer "3 de 128".
        total: await M.countDocuments(filtro),
      },
    });
  })
);

/** Um documento. */
adminDadosRouter.get(
  "/:colecao/:id",
  asyncHandler(async (req, res) => {
    const M = modelo(String(req.params.colecao));
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Id inválido");
    const doc = await M.findById(req.params.id).lean();
    if (!doc) throw new HttpError(404, "Documento não encontrado");
    res.json({ data: limpar(doc), meta: {} });
  })
);

const motivoSchema = z.string().min(3, "Explique o motivo").max(500);

const edicaoSchema = z.object({
  motivo: motivoSchema,
  /** Só os campos a mudar. O resto do documento fica como está. */
  campos: z.record(z.unknown()),
});

/**
 * Edita campos de um documento.
 *
 * `$set` dos campos informados, e nada mais — enviar o documento inteiro de
 * volta apagaria em silêncio tudo que a tela não conhecesse, que é como uma
 * edição de um campo vira perda de dez.
 *
 * `strict: false` porque a ferramenta existe justamente para os casos que o
 * schema não previu. A validação do Mongoose continua valendo para o que ele
 * conhece.
 */
adminDadosRouter.patch(
  "/:colecao/:id",
  asyncHandler(async (req, res) => {
    const { motivo, campos } = edicaoSchema.parse(req.body);
    const M = modelo(String(req.params.colecao));
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Id inválido");

    if (Object.keys(campos).length === 0) throw new HttpError(400, "Nenhum campo para mudar.");
    for (const k of Object.keys(campos)) {
      if (k.startsWith("$")) throw new HttpError(400, `Campo inválido: ${k}`);
      if (k === "_id") throw new HttpError(400, "O _id não se muda.");
      // Gravar um segredo por aqui o deixaria em texto claro no banco, sem o
      // tratamento que o caminho normal faz (hash, expiração).
      if (SEGREDOS.has(k)) throw new HttpError(400, `O campo ${k} não se edita por aqui.`);
    }

    const antes = await M.findById(req.params.id).lean();
    if (!antes) throw new HttpError(404, "Documento não encontrado");

    await M.updateOne({ _id: req.params.id }, { $set: campos }, { strict: false });
    const depois = await M.findById(req.params.id).lean();

    await recordAudit({
      actor: req.user!,
      action: `dados.update.${M.modelName}`,
      targetKind: "system",
      targetId: req.params.id,
      targetLabel: `${M.modelName}/${req.params.id}`,
      reason: motivo,
      // O documento INTEIRO, e não só o diff: é o que permite desfazer.
      before: { documento: JSON.stringify(limpar(antes)).slice(0, 4000) },
      after: { documento: JSON.stringify(limpar(depois)).slice(0, 4000) },
    });

    res.json({ data: limpar(depois), meta: {} });
  })
);

const exclusaoSchema = z.object({
  motivo: motivoSchema,
  /**
   * O id, digitado de novo.
   *
   * Não é burocracia: é a diferença entre apagar o que se quer e apagar o que
   * estava sob o cursor. Um clique errado numa lista é a forma mais comum de
   * perder o documento errado, e aqui não há como desfazer pelo banco.
   */
  confirmacao: z.string(),
});

/**
 * Apaga UM documento. Nunca vários.
 *
 * Não existe apagar em massa aqui de propósito. `deleteMany` com o filtro
 * errado é irreversível e apaga tudo em milissegundos — para isso existe
 * script revisado, com dry-run, não um campo de texto num painel.
 */
adminDadosRouter.delete(
  "/:colecao/:id",
  asyncHandler(async (req, res) => {
    const { motivo, confirmacao } = exclusaoSchema.parse(req.body);
    const M = modelo(String(req.params.colecao));
    const id = String(req.params.id);
    if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "Id inválido");
    if (confirmacao !== id) {
      throw new HttpError(400, "A confirmação não bate com o id do documento.");
    }

    const antes = await M.findById(id).lean();
    if (!antes) throw new HttpError(404, "Documento não encontrado");

    await M.deleteOne({ _id: id });

    await recordAudit({
      actor: req.user!,
      action: `dados.delete.${M.modelName}`,
      targetKind: "system",
      targetId: id,
      targetLabel: `${M.modelName}/${id}`,
      reason: motivo,
      // A cópia do que foi apagado. É a única forma de reconstruir, e é o que
      // torna esta ferramenta aceitável.
      before: { documento: JSON.stringify(limpar(antes)).slice(0, 4000) },
      after: { documento: null },
    });

    res.json({ data: { apagado: true, id }, meta: {} });
  })
);
