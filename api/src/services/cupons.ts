import type mongoose from "mongoose";
import { Cupom, type CupomDoc } from "../models/Cupom.js";
import { CupomUso } from "../models/CupomUso.js";
import { User, type UserDoc } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { normalizarCodigo } from "../utils/codigo.js";
import { recomputeTier } from "./entitlement.js";
import { CATALOGO, type Ciclo, type Produto } from "./pagamentos/catalogo.js";

// O que um cupom faz, num lugar só.
//
// Os dois eixos do cupom (desconto e parceria) são resolvidos por funções
// diferentes de propósito, porque acontecem em MOMENTOS diferentes:
//
//   cadastro  -> `registrarOrigem`   (parceria: de onde a pessoa veio)
//   checkout  -> `aplicarDesconto`   (dinheiro: quanto ela paga)
//   pagamento -> `creditarParceiro`  (comissão, gravada no ato da venda)
//
// Juntar as três numa só obrigaria cada chamador a passar o que não tem.

/** Por que um cupom não vale. Vira mensagem para quem digitou. */
type Recusa =
  | "inexistente"
  | "revogado"
  | "expirado"
  | "esgotado"
  | "produto"
  | "ciclo"
  | "repetido";

const MOTIVO: Record<Recusa, string> = {
  inexistente: "Esse cupom não existe.",
  revogado: "Esse cupom não está mais válido.",
  expirado: "Esse cupom venceu.",
  esgotado: "Esse cupom já atingiu o limite de usos.",
  produto: "Esse cupom não vale para este plano.",
  ciclo: "Esse cupom não vale para esta forma de pagamento.",
  repetido: "Você já usou esse cupom.",
};

export interface CupomValido {
  cupom: CupomDoc;
  /** Quanto sai do preço, em centavos. Zero para cupom sem desconto. */
  descontoCentavos: number;
  /** Meses de cortesia, quando o cupom é desse tipo. */
  mesesGratis: number;
}

/**
 * O cupom existe e vale AGORA, para este produto e ciclo?
 *
 * Não grava nada — é consulta. A tela chama isto enquanto a pessoa digita, e o
 * checkout chama de novo antes de cobrar: validar na tela e confiar nela seria
 * deixar o desconto na mão de quem abre o console do navegador.
 */
export async function validarCupom(
  codigoBruto: string,
  opcoes: { produto?: Produto; ciclo?: Ciclo; userId?: mongoose.Types.ObjectId } = {}
): Promise<CupomValido> {
  const codigo = normalizarCodigo(codigoBruto);
  const cupom = await Cupom.findOne({ codigo });
  if (!cupom) throw new HttpError(404, MOTIVO.inexistente);

  const agora = new Date();
  if (cupom.revogadoEm) throw new HttpError(409, MOTIVO.revogado);
  if (cupom.validoAte && cupom.validoAte.getTime() <= agora.getTime()) {
    throw new HttpError(409, MOTIVO.expirado);
  }
  const teto = cupom.limiteDeUsos ?? null;
  if (teto !== null && (cupom.usos ?? 0) >= teto) {
    throw new HttpError(409, MOTIVO.esgotado);
  }
  // Listas vazias querem dizer "vale para tudo", e não "não vale para nada".
  if (opcoes.produto && cupom.produtos.length > 0 && !cupom.produtos.includes(opcoes.produto)) {
    throw new HttpError(409, MOTIVO.produto);
  }
  if (opcoes.ciclo && cupom.ciclos.length > 0 && !cupom.ciclos.includes(opcoes.ciclo)) {
    throw new HttpError(409, MOTIVO.ciclo);
  }
  if (opcoes.userId) {
    const jaUsou = await CupomUso.exists({ cupom: codigo, user: opcoes.userId });
    // Só barra se a pessoa já usou para COMPRAR. Ter se cadastrado com o cupom
    // do parceiro não pode impedi-la de usar o desconto dele depois — seria
    // punir exatamente quem veio por ele.
    if (jaUsou) {
      const uso = await CupomUso.findOne({ cupom: codigo, user: opcoes.userId });
      if (uso?.primeiraCompraEm) throw new HttpError(409, MOTIVO.repetido);
    }
  }

  return {
    cupom,
    descontoCentavos: calcularDesconto(cupom, opcoes.produto, opcoes.ciclo),
    mesesGratis: cupom.desconto?.tipo === "meses_gratis" ? cupom.desconto.valor : 0,
  };
}

/**
 * Quanto o cupom tira do preço.
 *
 * Nunca deixa o preço negativo nem zero: o gateway recusa cobrança de zero, e
 * um cupom de R$ 50 num plano de R$ 29,90 tornaria o checkout inabrível com
 * uma mensagem que não explica nada. Quem quer dar de graça usa `meses_gratis`,
 * que não passa pelo gateway.
 */
function calcularDesconto(cupom: CupomDoc, produto?: Produto, ciclo?: Ciclo): number {
  if (!cupom.desconto || !produto || !ciclo) return 0;
  if (cupom.desconto.tipo === "meses_gratis") return 0;

  const cheio = CATALOGO[produto].precoCentavos[ciclo];
  const bruto =
    cupom.desconto.tipo === "percentual"
      ? Math.round((cheio * cupom.desconto.valor) / 100)
      : cupom.desconto.valor;

  // Sobra pelo menos um real para cobrar.
  return Math.max(0, Math.min(bruto, cheio - 100));
}

/**
 * Marca DE ONDE esta pessoa veio. Chamado no cadastro.
 *
 * Nunca lança: um cupom errado digitado no cadastro não pode impedir alguém de
 * criar a conta. O código simplesmente não é registrado, e a pessoa entra
 * normalmente — o pior desfecho aqui seria perder um cadastro por causa de uma
 * letra trocada num campo opcional.
 */
export async function registrarOrigem(user: UserDoc, codigoBruto: string): Promise<void> {
  const codigo = normalizarCodigo(codigoBruto);
  if (!codigo) return;

  try {
    const { cupom, mesesGratis } = await validarCupom(codigo);

    await CupomUso.create({ cupom: cupom.codigo, user: user._id, origem: "cadastro" });
    await Cupom.updateOne({ _id: cupom._id }, { $inc: { usos: 1 } });

    user.set("cupom", cupom.codigo);
    user.set("cupomEm", new Date());

    // Meses grátis valem NA HORA, sem passar pelo gateway: é cortesia nossa, e
    // é o cupom que faz a pessoa experimentar o Pro antes de decidir pagar.
    if (mesesGratis > 0) {
      const base = user.cortesiaAte && user.cortesiaAte > new Date() ? user.cortesiaAte : new Date();
      const ate = new Date(base.getTime());
      ate.setMonth(ate.getMonth() + mesesGratis);
      user.set("cortesiaAte", ate);
      if (!user.produtoAssinado) user.set("produtoAssinado", "pro");
    }

    await user.save();
    await recomputeTier(user);
  } catch (e) {
    // Código inválido no cadastro é silencioso de propósito (ver o docstring).
    // Erro de banco, não: esse tem de aparecer no log.
    if (!(e instanceof HttpError)) {
      console.error(`[cupons] falha ao registrar origem de ${String(user._id)}:`, (e as Error).message);
    }
  }
}

/**
 * Registra que a pessoa usou o cupom para COMPRAR, e credita o parceiro.
 *
 * Chamado quando o dinheiro entra — nunca antes. A comissão é calculada com a
 * taxa VIGENTE AGORA e gravada na `Cobranca`; se a combinação com o parceiro
 * mudar amanhã, esta venda continua valendo o que valia.
 */
export async function creditarParceiro(
  codigo: string | null | undefined,
  userId: mongoose.Types.ObjectId,
  valorPagoCentavos: number
): Promise<{ comissaoCentavos: number }> {
  if (!codigo) return { comissaoCentavos: 0 };

  const cupom = await Cupom.findOne({ codigo: normalizarCodigo(codigo) });
  const percentual = cupom?.parceiro?.comissaoPercentual ?? 0;
  const comissaoCentavos = percentual > 0 ? Math.round((valorPagoCentavos * percentual) / 100) : 0;

  // `upsert` porque a pessoa pode ter usado o cupom só no checkout, sem ter
  // passado pelo cadastro com ele.
  await CupomUso.updateOne(
    { cupom: normalizarCodigo(codigo), user: userId },
    {
      $setOnInsert: { origem: "checkout" },
      $set: { primeiraCompraEm: new Date() },
      $inc: { totalPagoCentavos: valorPagoCentavos, comissaoTotalCentavos: comissaoCentavos },
    },
    { upsert: true }
  );

  return { comissaoCentavos };
}

/**
 * O que este cupom produziu. É a resposta que o parceiro vem cobrar.
 *
 * Agregação por cupom, com `$match` no campo indexado primeiro. Sem `$lookup`:
 * tudo que o relatório precisa está no próprio `CupomUso`, que foi desenhado
 * para isso — é o motivo de ele guardar os totais em vez de derivá-los de
 * `Cobranca` a cada consulta.
 */
export async function relatorioDoCupom(codigo: string): Promise<{
  entraram: number;
  pagaram: number;
  gratis: number;
  receitaCentavos: number;
  comissaoCentavos: number;
}> {
  const [r] = await CupomUso.aggregate<{
    entraram: number;
    pagaram: number;
    receitaCentavos: number;
    comissaoCentavos: number;
  }>([
    { $match: { cupom: normalizarCodigo(codigo) } },
    {
      $group: {
        _id: null,
        entraram: { $sum: 1 },
        pagaram: { $sum: { $cond: [{ $ifNull: ["$primeiraCompraEm", false] }, 1, 0] } },
        receitaCentavos: { $sum: "$totalPagoCentavos" },
        comissaoCentavos: { $sum: "$comissaoTotalCentavos" },
      },
    },
  ]);

  const entraram = r?.entraram ?? 0;
  const pagaram = r?.pagaram ?? 0;
  return {
    entraram,
    pagaram,
    // Quem entrou e ainda não pagou. É o número que mostra se o cupom traz
    // gente que converte ou só gente que olha.
    gratis: entraram - pagaram,
    receitaCentavos: r?.receitaCentavos ?? 0,
    comissaoCentavos: r?.comissaoCentavos ?? 0,
  };
}

/** Conserta o contador desnormalizado a partir da verdade, que são os usos. */
export async function recontarUsos(codigo: string): Promise<number> {
  const cod = normalizarCodigo(codigo);
  const usos = await CupomUso.countDocuments({ cupom: cod });
  await Cupom.updateOne({ codigo: cod }, { $set: { usos } });
  return usos;
}

/** Quem entrou por este cupom, página por página. Cursor, nunca offset. */
export async function usosDoCupom(
  codigo: string,
  opcoes: { limit?: number; cursor?: string | null } = {}
) {
  const limit = Math.min(Math.max(opcoes.limit ?? 20, 1), 100);
  const filtro: Record<string, unknown> = { cupom: normalizarCodigo(codigo) };
  if (opcoes.cursor) filtro._id = { $lt: opcoes.cursor };

  const itens = await CupomUso.find(filtro).sort({ _id: -1 }).limit(limit + 1);
  const temMais = itens.length > limit;
  const pagina = temMais ? itens.slice(0, limit) : itens;

  const contas = await User.find({ _id: { $in: pagina.map((u) => u.user) } }).select(
    "name email plan tier"
  );
  const porId = new Map(contas.map((c) => [c._id.toString(), c]));

  return {
    itens: pagina.map((u) => {
      const c = porId.get(u.user.toString());
      return {
        id: u._id.toString(),
        user: u.user.toString(),
        nome: c?.name ?? "(conta removida)",
        email: c?.email ?? "",
        plano: c?.plan ?? "free",
        origem: u.origem,
        entrouEm: u.get("createdAt") as Date,
        primeiraCompraEm: u.primeiraCompraEm ?? null,
        totalPagoCentavos: u.totalPagoCentavos ?? 0,
        comissaoCentavos: u.comissaoTotalCentavos ?? 0,
      };
    }),
    nextCursor: temMais ? pagina[pagina.length - 1]!._id.toString() : null,
  };
}
