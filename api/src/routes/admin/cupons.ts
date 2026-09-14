import { Router } from "express";
import { z } from "zod";
import { Cupom, type CupomDoc } from "../../models/Cupom.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError } from "../../utils/httpError.js";
import { codigoInedito, normalizarCodigo } from "../../utils/codigo.js";
import { recordAudit } from "../../services/adminAudit.js";
import { relatorioDoCupom, usosDoCupom } from "../../services/cupons.js";
import { CICLOS, PRODUTOS, emReais } from "../../services/pagamentos/catalogo.js";
import { TIPOS_DE_DESCONTO } from "../../models/Cupom.js";

export const adminCuponsRouter = Router();

// O painel de cupons.
//
// Duas coisas moldam este arquivo:
//
//  - Cupom NÃO se apaga. Quem entrou por ele continua contando no relatório do
//    parceiro, e apagar reescreveria o passado de quem tem dinheiro a receber.
//    Só se revoga, e a revogação é reversível.
//  - Toda ação pede motivo, como o resto do painel. Daqui a seis meses "por
//    que esse cupom foi revogado?" precisa ter resposta.

const motivoSchema = z.string().min(3, "Explique o motivo").max(500);

const descontoSchema = z
  .object({
    tipo: z.enum(TIPOS_DE_DESCONTO),
    /**
     * Em centavos para `valor`, pontos percentuais para `percentual`, meses
     * para `meses_gratis`. O teto de 100 no percentual não é decorativo: 120%
     * faria o desconto passar do preço, e quem quer dar de graça usa meses.
     */
    valor: z.number().int().min(1),
  })
  .refine((d) => d.tipo !== "percentual" || d.valor <= 100, {
    message: "Desconto percentual vai até 100",
  })
  .refine((d) => d.tipo !== "meses_gratis" || d.valor <= 24, {
    message: "Meses grátis vai até 24",
  });

const parceiroSchema = z.object({
  nome: z.string().min(2, "Nome do parceiro muito curto").max(120),
  contato: z.string().max(200).optional(),
  comissaoPercentual: z.number().min(0).max(100).default(0),
});

const criarSchema = z.object({
  /** Vazio = o servidor sorteia um código legível. */
  codigo: z.string().max(40).optional(),
  descricao: z.string().max(200).optional(),
  desconto: descontoSchema.nullable().optional(),
  parceiro: parceiroSchema.nullable().optional(),
  produtos: z.array(z.enum(PRODUTOS)).optional(),
  ciclos: z.array(z.enum(CICLOS)).optional(),
  limiteDeUsos: z.number().int().min(1).nullable().optional(),
  validoAte: z.coerce.date().nullable().optional(),
});

/** Como o painel lê um cupom. O relatório vem junto: é o que se olha. */
async function comRelatorio(c: CupomDoc | null) {
  if (!c) throw new HttpError(404, "Cupom não encontrado");
  const rel = await relatorioDoCupom(c.codigo);
  return {
    id: c._id.toString(),
    codigo: c.codigo,
    descricao: c.descricao ?? "",
    desconto: c.desconto
      ? {
          tipo: c.desconto.tipo,
          valor: c.desconto.valor,
          // Formatado no servidor: "R$ 10,00" e "20%" são a mesma coluna na
          // tela, e a regra de qual usar é a mesma do catálogo.
          rotulo:
            c.desconto.tipo === "percentual"
              ? `${c.desconto.valor}%`
              : c.desconto.tipo === "valor"
                ? emReais(c.desconto.valor)
                : `${c.desconto.valor} ${c.desconto.valor === 1 ? "mês" : "meses"} grátis`,
        }
      : null,
    parceiro: c.parceiro
      ? {
          nome: c.parceiro.nome,
          contato: c.parceiro.contato ?? "",
          comissaoPercentual: c.parceiro.comissaoPercentual ?? 0,
        }
      : null,
    produtos: c.produtos ?? [],
    ciclos: c.ciclos ?? [],
    limiteDeUsos: c.limiteDeUsos ?? null,
    usos: c.usos ?? 0,
    validoAte: c.validoAte ?? null,
    revogadoEm: c.revogadoEm ?? null,
    criadoEm: c.get("createdAt") as Date,
    relatorio: {
      ...rel,
      receitaFormatada: emReais(rel.receitaCentavos),
      comissaoFormatada: emReais(rel.comissaoCentavos),
      // O que sobra para você depois de pagar o parceiro. É o número da
      // decisão "vale a pena manter esta parceria?".
      liquidoCentavos: rel.receitaCentavos - rel.comissaoCentavos,
      liquidoFormatado: emReais(rel.receitaCentavos - rel.comissaoCentavos),
    },
  };
}

/** Lista os cupons. Poucos por natureza, então sem cursor. */
adminCuponsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const incluirRevogados = req.query.todos === "1";
    const filtro = incluirRevogados ? {} : { revogadoEm: null };
    const cupons = await Cupom.find(filtro).sort({ createdAt: -1 }).limit(200);
    res.json({
      data: await Promise.all(cupons.map((c) => comRelatorio(c))),
      meta: { total: cupons.length },
    });
  })
);

adminCuponsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const dados = criarSchema.parse(req.body);

    // Um cupom que não desconta e não tem parceiro não faz nada. Recusar aqui
    // evita a pergunta "criei e não aconteceu nada, por quê?".
    if (!dados.desconto && !dados.parceiro) {
      throw new HttpError(400, "O cupom precisa de um desconto, de um parceiro, ou dos dois.");
    }

    const codigo = dados.codigo
      ? normalizarCodigo(dados.codigo)
      : await codigoInedito(async (c) => Boolean(await Cupom.exists({ codigo: c })));

    if (!codigo) throw new HttpError(400, "Código inválido");
    if (await Cupom.exists({ codigo })) {
      throw new HttpError(409, `Já existe um cupom com o código ${codigo}.`);
    }

    const cupom = await Cupom.create({
      codigo,
      descricao: dados.descricao ?? "",
      desconto: dados.desconto ?? null,
      parceiro: dados.parceiro ?? null,
      produtos: dados.produtos ?? [],
      ciclos: dados.ciclos ?? [],
      limiteDeUsos: dados.limiteDeUsos ?? null,
      validoAte: dados.validoAte ?? null,
      criadoPor: req.user!._id,
    });

    await recordAudit({
      actor: req.user!,
      action: "cupom.create",
      targetKind: "cupom",
      targetId: cupom._id,
      targetLabel: codigo,
      reason: dados.descricao ?? "",
      after: {
        codigo,
        desconto: dados.desconto ?? null,
        parceiro: dados.parceiro?.nome ?? null,
        comissao: dados.parceiro?.comissaoPercentual ?? 0,
      },
    });

    res.status(201).json({ data: await comRelatorio(cupom), meta: {} });
  })
);

/** O detalhe, com quem entrou por ele. */
adminCuponsRouter.get(
  "/:codigo",
  asyncHandler(async (req, res) => {
    const cupom = await Cupom.findOne({ codigo: normalizarCodigo(String(req.params.codigo)) });
    const detalhe = await comRelatorio(cupom);
    const usos = await usosDoCupom(detalhe.codigo, {
      limit: Number(req.query.limit) || 20,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : null,
    });
    res.json({ data: { ...detalhe, usos: usos.itens }, meta: { nextCursor: usos.nextCursor } });
  })
);

/**
 * Revoga. Não apaga.
 *
 * Quem já entrou pelo cupom continua no relatório, e o parceiro continua tendo
 * direito ao que vendeu. O que a revogação faz é impedir usos NOVOS.
 */
adminCuponsRouter.post(
  "/:codigo/revogar",
  asyncHandler(async (req, res) => {
    const motivo = motivoSchema.parse(req.body?.motivo);
    const cupom = await Cupom.findOne({ codigo: normalizarCodigo(String(req.params.codigo)) });
    if (!cupom) throw new HttpError(404, "Cupom não encontrado");
    if (cupom.revogadoEm) throw new HttpError(409, "Esse cupom já está revogado.");

    cupom.revogadoEm = new Date();
    cupom.revogadoPor = req.user!._id;
    await cupom.save();

    await recordAudit({
      actor: req.user!,
      action: "cupom.revoke",
      targetKind: "cupom",
      targetId: cupom._id,
      targetLabel: cupom.codigo,
      reason: motivo,
      before: { revogadoEm: null },
      after: { revogadoEm: cupom.revogadoEm },
    });

    res.json({ data: await comRelatorio(cupom), meta: {} });
  })
);

/** Volta a valer. Reversível de propósito: revogar por engano acontece. */
adminCuponsRouter.post(
  "/:codigo/reativar",
  asyncHandler(async (req, res) => {
    const motivo = motivoSchema.parse(req.body?.motivo);
    const cupom = await Cupom.findOne({ codigo: normalizarCodigo(String(req.params.codigo)) });
    if (!cupom) throw new HttpError(404, "Cupom não encontrado");

    const antes = cupom.revogadoEm;
    cupom.revogadoEm = null;
    cupom.revogadoPor = null;
    await cupom.save();

    await recordAudit({
      actor: req.user!,
      action: "cupom.reactivate",
      targetKind: "cupom",
      targetId: cupom._id,
      targetLabel: cupom.codigo,
      reason: motivo,
      before: { revogadoEm: antes },
      after: { revogadoEm: null },
    });

    res.json({ data: await comRelatorio(cupom), meta: {} });
  })
);
