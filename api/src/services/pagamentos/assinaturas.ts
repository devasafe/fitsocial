import crypto from "node:crypto";
import mongoose from "mongoose";
import { Assinatura, type AssinaturaDoc, type Provedor } from "../../models/Assinatura.js";
import { Cobranca } from "../../models/Cobranca.js";
import { EventoDeCobranca } from "../../models/EventoDeCobranca.js";
import { User, type UserDoc } from "../../models/User.js";
import { HttpError } from "../../utils/httpError.js";
import { recomputeTier } from "../entitlement.js";
import { recontarAlunosDe } from "../patrocinio.js";
import { CATALOGO, diasDoCiclo, emReais, type Ciclo, type Produto } from "./catalogo.js";
import { getProvedorDePagamento, provedorPeloNome } from "./index.js";
import type { EventoNormalizado } from "./provider.js";

// O que acontece com os direitos quando o dinheiro se move.
//
// REGRA DURA, e vale para o arquivo inteiro: nada aqui escreve `tier` nem
// `plan`. Este serviço grava FATOS — até quando vale, que produto, que
// capacidade, o que foi cobrado — e chama `recomputeTier`. Quem decide o plano
// é o motor, num lugar só. Foi assim que `tier` se desalinhou da primeira vez,
// e é a única regra deste arquivo que não tem exceção.

function emDias(dias: number, a = new Date()): Date {
  return new Date(a.getTime() + dias * 24 * 60 * 60 * 1000);
}

/**
 * Cria a assinatura pendente e devolve para onde mandar a pessoa.
 *
 * A `Assinatura` nasce ANTES da chamada ao gateway, e o id dela vai como
 * referência externa. É isso que torna o webhook resolvível mesmo quando o
 * provedor perde o resto do metadata — e sem isso o primeiro evento chegaria
 * sem ninguém para associar.
 */
export async function iniciarAssinatura(
  user: UserDoc,
  produto: Produto,
  ciclo: Ciclo
): Promise<{ assinatura: AssinaturaDoc; urlDeCheckout: string }> {
  const item = CATALOGO[produto];

  const jaTem = await Assinatura.findOne({ user: user._id, status: { $in: ["ativa", "pendente"] } });
  if (jaTem && jaTem.status === "ativa") {
    throw new HttpError(409, "Você já tem uma assinatura ativa. Cancele antes de trocar de plano.");
  }

  const provedor = getProvedorDePagamento();
  const assinatura = await Assinatura.create({
    user: user._id,
    produto,
    ciclo,
    status: "pendente",
    provedor: provedor.nome,
    precoCentavos: item.precoCentavos[ciclo],
  });

  try {
    const criado = await provedor.criarCheckout({
      referencia: assinatura._id.toString(),
      produto,
      ciclo,
      valorCentavos: item.precoCentavos[ciclo],
      descricao: `${item.nome} — ${ciclo} (${emReais(item.precoCentavos[ciclo])})`,
      cliente: { id: user._id.toString(), nome: user.name, email: user.email },
    });

    assinatura.provedorAssinaturaId = criado.provedorAssinaturaId;
    assinatura.provedorClienteId = criado.provedorClienteId;
    await assinatura.save();

    return { assinatura, urlDeCheckout: criado.urlDeCheckout };
  } catch (e) {
    // Assinatura pendente órfã vira lixo que bloqueia a próxima tentativa
    // (pelo `jaTem` acima). Some daqui mesmo.
    await Assinatura.deleteOne({ _id: assinatura._id });

    // O detalhe do gateway fica no log, e NÃO na resposta.
    //
    // A mensagem de erro do Asaas fala de conta, de cliente e de configuração
    // da integração — nada disso é da conta de quem clicou em "assinar", e
    // vazar isso numa tela é entregar de graça o mapa de como a cobrança é
    // montada aqui. Quem precisa do detalhe é quem lê o log do servidor.
    console.error(
      `[pagamentos] checkout falhou para a assinatura ${String(assinatura._id)}:`,
      (e as Error).message
    );
    throw new HttpError(502, "Não foi possível abrir o pagamento agora. Tente de novo.");
  }
}

/** Liga a assinatura aos direitos do usuário, sem nunca tocar em `tier`. */
async function aplicarAcesso(assinatura: AssinaturaDoc, ate: Date): Promise<void> {
  const item = CATALOGO[assinatura.produto as Produto];
  const user = await User.findById(assinatura.user);
  if (!user) return;

  user.set("assinaturaAte", ate);
  user.set("assinaturaStatus", "ativa");
  user.set("produtoAssinado", assinatura.produto);

  // A capacidade profissional vem do SKU. `origem: "gateway"` para o painel
  // saber que não foi cortesia — e para a concessão manual do admin continuar
  // vencendo dela, que é a precedência que já existia.
  for (const cap of item.capacidades) {
    if (user.get(`pro.${cap}.origem`) === "manual" && user.get(`pro.${cap}.ativo`)) continue;
    user.set(`pro.${cap}`, {
      ativo: true,
      origem: "gateway",
      validoAte: ate,
      limiteDeAlunos: Math.max(item.limiteDeAlunos, user.get(`pro.${cap}.limiteDeAlunos`) ?? 0),
    });
  }

  await user.save();
  await recomputeTier(user);

  // Os alunos dele voltam a ser bancados assim que a capacidade existe.
  for (const cap of item.capacidades) await recontarAlunosDe(user._id, cap);
}

/** Derruba o acesso AGORA. Para estorno e chargeback, onde o dinheiro voltou. */
async function derrubarAcesso(assinatura: AssinaturaDoc): Promise<void> {
  const user = await User.findById(assinatura.user);
  if (!user) return;

  user.set("assinaturaAte", new Date());
  user.set("assinaturaStatus", "expirada");

  const item = CATALOGO[assinatura.produto as Produto];
  for (const cap of item.capacidades) {
    if (user.get(`pro.${cap}.origem`) === "gateway") user.set(`pro.${cap}.ativo`, false);
  }

  await user.save();
  await recomputeTier(user);
  for (const cap of item.capacidades) await recontarAlunosDe(user._id, cap);
}

/**
 * Aplica um evento já normalizado.
 *
 * Devolve o que fez, para o livro-razão registrar. Não lança por evento
 * desconhecido: gateway manda muito mais tipo do que a gente trata, e explodir
 * faria o Asaas reenviar em laço.
 */
export async function aplicarEvento(
  provedor: Provedor,
  e: EventoNormalizado
): Promise<{ resultado: "aplicado" | "ignorado"; assinatura: AssinaturaDoc | null }> {
  if (e.tipo === "desconhecido") return { resultado: "ignorado", assinatura: null };

  const assinatura = await acharAssinatura(e);
  if (!assinatura) return { resultado: "ignorado", assinatura: null };

  // A data vem do adaptador, e o tipo diz `Date` — mas confiar nisso aqui é
  // frágil: um provedor que devolva a string do JSON faria a comparação abaixo
  // virar string contra objeto, cujo resultado o JavaScript decide de um jeito
  // que ninguém espera. Normalizar na entrada custa uma linha e não tem como
  // falhar em silêncio.
  const ocorridoEm = e.ocorridoEm ? new Date(e.ocorridoEm) : null;
  const valida = ocorridoEm && !Number.isNaN(ocorridoEm.getTime()) ? ocorridoEm : null;

  // Evento mais velho que o último aplicado: ignora.
  //
  // Gateway reenvia E REORDENA. Sem esta guarda, um "renovou" atrasado
  // chegando depois de um "cancelou" ressuscita a assinatura — e o bug depende
  // da ordem em que a rede entregou, então ninguém consegue reproduzir.
  if (valida && assinatura.ultimoEventoEm && valida < assinatura.ultimoEventoEm) {
    return { resultado: "ignorado", assinatura };
  }

  switch (e.tipo) {
    case "pagamento.aprovado":
    case "assinatura.renovada": {
      const dias = diasDoCiclo(assinatura.ciclo as Ciclo);
      // Renovação SOMA ao que ainda falta, em vez de reiniciar: quem paga
      // adiantado não pode perder os dias que já tinha.
      const base =
        assinatura.validoAte && assinatura.validoAte > new Date()
          ? assinatura.validoAte
          : new Date();
      const ate = emDias(dias, base);

      assinatura.status = "ativa";
      assinatura.inicioEm = assinatura.inicioEm ?? new Date();
      assinatura.validoAte = ate;
      assinatura.renovaEm = ate;
      await registrarCobranca(assinatura, e, "paga");
      await aplicarAcesso(assinatura, ate);
      break;
    }

    case "pagamento.falhou": {
      // NADA é revogado aqui. Cartão vencido é a causa número um de recusa, e
      // acontece com quem quer continuar pagando — a carência de 7 dias do
      // motor é que decide quando cai.
      assinatura.status = "inadimplente";
      await registrarCobranca(assinatura, e, "falhou");
      const user = await User.findById(assinatura.user);
      if (user) {
        user.set("assinaturaStatus", "inadimplente");
        await user.save();
        await recomputeTier(user);
      }
      break;
    }

    case "assinatura.cancelada": {
      // Cancelar NÃO é estornar: o acesso vale até o fim do ciclo já pago.
      assinatura.status = "cancelada";
      assinatura.cancelaNoFimDoCiclo = true;
      assinatura.canceladaEm = new Date();
      break;
    }

    case "estorno":
    case "chargeback": {
      assinatura.status = "estornada";
      await registrarCobranca(assinatura, e, e.tipo === "estorno" ? "estornada" : "chargeback");
      await derrubarAcesso(assinatura);
      break;
    }
  }

  assinatura.ultimoEventoEm = valida ?? new Date();
  await assinatura.save();
  return { resultado: "aplicado", assinatura };
}

async function acharAssinatura(e: EventoNormalizado): Promise<AssinaturaDoc | null> {
  // Pela NOSSA referência primeiro: é a que não muda de forma.
  if (e.referencia && mongoose.isValidObjectId(e.referencia)) {
    const porRef = await Assinatura.findById(e.referencia);
    if (porRef) return porRef;
  }
  if (e.provedorAssinaturaId) {
    return Assinatura.findOne({ provedorAssinaturaId: e.provedorAssinaturaId });
  }
  return null;
}

async function registrarCobranca(
  assinatura: AssinaturaDoc,
  e: EventoNormalizado,
  status: "paga" | "falhou" | "estornada" | "chargeback"
): Promise<void> {
  const campos: Record<string, unknown> = {
    assinatura: assinatura._id,
    user: assinatura.user,
    provedor: assinatura.provedor,
    valorCentavos: e.valorCentavos ?? assinatura.precoCentavos,
    // O líquido é o que BATE COM O EXTRATO. Sem ele, o relatório de receita
    // conta o bruto e nunca fecha com o banco.
    liquidoCentavos: e.liquidoCentavos,
    status,
    metodo: e.metodo,
    pagoEm: e.pagoEm,
    cupom: assinatura.cupom,
  };

  // `provedorCobrancaId` só é gravado quando EXISTE.
  //
  // O índice é `unique + sparse`, e `sparse` ignora o campo AUSENTE — não o
  // campo em `null`. Gravar `null` explicitamente fazia a segunda cobrança sem
  // id do provedor colidir com a primeira, e o erro era engolido pelo
  // `try/catch` do webhook: o evento virava "erro" no livro-razão e nada era
  // aplicado. Uma cobrança recusada, por exemplo, não marcava a conta como
  // inadimplente — e ninguém ficava sabendo.
  if (e.provedorCobrancaId) campos.provedorCobrancaId = e.provedorCobrancaId;

  const filtro = e.provedorCobrancaId
    ? { provedor: assinatura.provedor, provedorCobrancaId: e.provedorCobrancaId }
    : { assinatura: assinatura._id, status };

  await Cobranca.updateOne(filtro, { $set: campos }, { upsert: true });
}

/**
 * O caminho inteiro do webhook, da verificação ao efeito.
 *
 * A idempotência é o `insert` em `EventoDeCobranca`: se o índice único
 * recusar, o evento já foi processado e a função para. É o banco garantindo,
 * não um `if` que uma corrida vence.
 */
export async function processarWebhook(
  nome: Provedor,
  cabecalhos: Record<string, unknown>,
  corpoCru: Buffer
): Promise<{ aceito: boolean; motivo?: string }> {
  const provedor = provedorPeloNome(nome);
  if (!provedor) return { aceito: false, motivo: "provedor desconhecido" };

  if (!provedor.verificarWebhook(cabecalhos, corpoCru)) {
    return { aceito: false, motivo: "assinatura invalida" };
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoCru.toString("utf8"));
  } catch {
    return { aceito: false, motivo: "corpo invalido" };
  }

  const evento = provedor.normalizarEvento(corpo);
  if (!evento.eventoId) return { aceito: false, motivo: "evento sem id" };

  let registro;
  try {
    registro = await EventoDeCobranca.create({
      provedor: nome,
      provedorEventoId: evento.eventoId,
      tipo: evento.tipo,
      // Hash, nunca o corpo: payload de gateway vem cheio de dado pessoal, e
      // `docs/SECURITY.md` não admite isso em registro de sistema.
      payloadHash: crypto.createHash("sha256").update(corpoCru).digest("hex"),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return { aceito: true, motivo: "ja processado" };
    }
    throw err;
  }

  try {
    const r = await aplicarEvento(nome, evento);
    registro.set("assinatura", r.assinatura?._id ?? null);
    registro.set("user", r.assinatura?.user ?? null);
    registro.set("resultado", r.resultado);
  } catch (err) {
    registro.set("resultado", "erro");
    registro.set("erro", String((err as Error).message).slice(0, 500));
  }
  registro.set("processadoEm", new Date());
  await registro.save();

  return { aceito: true };
}
