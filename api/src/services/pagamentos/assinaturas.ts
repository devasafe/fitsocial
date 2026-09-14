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
    assinatura.provedorCheckoutId = criado.provedorCheckoutId;
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

/**
 * Cancela a cobrança recorrente. NÃO tira o acesso.
 *
 * Quem cancela comprou aquele ciclo e fica com ele até o fim — por isso nada
 * aqui encosta em `assinaturaAte`. O que muda é só o futuro: o gateway para de
 * cobrar o cartão.
 *
 * Se o gateway recusar, NADA é marcado e o erro sobe. O contrário seria pior
 * que não ter botão: a pessoa veria "assinatura cancelada" na tela e o cartão
 * continuaria sendo cobrado todo mês, sem ela ter como descobrir por quê.
 */
export async function cancelarAssinatura(user: UserDoc): Promise<AssinaturaDoc> {
  const assinatura = await Assinatura.findOne({
    user: user._id,
    // "cancelada" entra na busca para o cancelamento ser IDEMPOTENTE.
    //
    // Sem ela, o segundo toque no botão — ou a tentativa depois de uma rede
    // ruim — respondia 404 "Você não tem uma assinatura para cancelar" a quem
    // tinha acabado de cancelar.
    //
    // "pendente" NÃO entra, e é o oposto de um detalhe: no checkout hospedado
    // a assinatura do gateway só nasce quando o cartão passa, então uma
    // pendente nunca tem `provedorAssinaturaId`. Cancelá-la marcaria
    // "cancelada" aqui sem avisar ninguém lá — e o caso é comum: a pessoa paga,
    // o webhook demora, ela volta ao app, vê "pendente", cancela, recebe 200, e
    // segundos depois o cartão está matriculado na recorrência. É exatamente o
    // desfecho que o parágrafo acima diz evitar.
    status: { $in: ["ativa", "inadimplente", "cancelada"] },
  }).sort({ createdAt: -1 });

  if (!assinatura) throw new HttpError(404, "Você não tem uma assinatura para cancelar.");
  // Já cancelada: devolve o mesmo resultado em vez de erro.
  if (assinatura.status === "cancelada") return assinatura;

  if (!assinatura.provedorAssinaturaId) {
    // Uma assinatura ativa SEM id do gateway não deveria existir — quem a
    // ativou foi um evento de pagamento, e ele traz o id. Se acontecer, é
    // estado inconsistente, e marcar "cancelada" aqui esconderia uma cobrança
    // que continua de pé.
    console.error(
      `[pagamentos] assinatura ${String(assinatura._id)} está ${assinatura.status} sem id do gateway`
    );
    throw new HttpError(409, "Sua assinatura ainda está sendo confirmada. Tente em instantes.");
  }

  const provedor = provedorPeloNome(assinatura.provedor as Provedor);
  if (!provedor) throw new HttpError(502, "Não foi possível cancelar agora. Tente de novo.");
  try {
    await provedor.cancelarAssinatura(assinatura.provedorAssinaturaId, true);
  } catch (e) {
    // O detalhe do gateway fica no log, como no checkout: a mensagem deles
    // fala de conta e de integração, e nada disso é da conta de quem clicou.
    console.error(
      `[pagamentos] cancelamento falhou para a assinatura ${String(assinatura._id)}:`,
      (e as Error).message
    );
    throw new HttpError(502, "Não foi possível cancelar agora. Tente de novo.");
  }

  assinatura.status = "cancelada";
  assinatura.cancelaNoFimDoCiclo = true;
  assinatura.canceladaEm = new Date();
  await assinatura.save();

  // "cancelada" ainda é um status que SUSTENTA o acesso enquanto `assinaturaAte`
  // valer — o motor só para no vencimento. Quem cancelou não perde nada hoje.
  user.set("assinaturaStatus", "cancelada");
  await user.save();
  await recomputeTier(user);

  return assinatura;
}

/**
 * A partir de quando contar o ciclo que acabou de ser pago.
 *
 * Renovação SOMA ao que ainda falta, em vez de reiniciar — quem paga adiantado
 * não pode perder os dias que já tinha. E o "que ainda falta" não está só nesta
 * assinatura: numa TROCA DE PLANO ele está no usuário.
 *
 * O caminho é o que o próprio produto manda seguir. `iniciarAssinatura` recusa
 * quem já tem assinatura ativa com "Cancele antes de trocar de plano" — então
 * a pessoa cancela e assina o plano novo, e a assinatura nova nasce com
 * `validoAte` nulo. Olhando só para ela, um anual trocado no dia seguinte
 * perdia 335 dias já pagos, e a `Assinatura` antiga ficava dizendo 2027
 * enquanto o `User` dizia 2026 — duas verdades opostas para o suporte
 * desempatar na hora de reembolsar.
 *
 * Não há risco de crédito indevido depois de estorno: `derrubarAcesso` já
 * empurra `assinaturaAte` para agora, e o que já passou não entra na conta.
 */
async function direitoQueAindaVale(assinatura: AssinaturaDoc): Promise<Date> {
  const agora = new Date();
  const candidatos = [agora];
  if (assinatura.validoAte) candidatos.push(assinatura.validoAte);

  const user = await User.findById(assinatura.user).select("assinaturaAte");
  if (user?.assinaturaAte) candidatos.push(user.assinaturaAte);

  return new Date(Math.max(...candidatos.map((d) => d.getTime())));
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

  const assinatura = await acharAssinatura(provedor, e);
  if (!assinatura) return { resultado: "ignorado", assinatura: null };

  // Os ids que só passam a existir depois do pagamento são carimbados no
  // primeiro evento que os traz, qualquer que seja ele.
  //
  // É o que permite cancelar a assinatura no gateway mais tarde: sem o
  // `provedorAssinaturaId`, o botão de cancelar não teria o que chamar, e o
  // cartão da pessoa continuaria sendo cobrado todo mês.
  if (e.provedorAssinaturaId && !assinatura.provedorAssinaturaId) {
    assinatura.provedorAssinaturaId = e.provedorAssinaturaId;
  }
  if (e.provedorClienteId && !assinatura.provedorClienteId) {
    assinatura.provedorClienteId = e.provedorClienteId;
  }

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
      const ate = emDias(dias, await direitoQueAindaVale(assinatura));

      assinatura.status = "ativa";
      assinatura.inicioEm = assinatura.inicioEm ?? new Date();
      assinatura.validoAte = ate;
      assinatura.renovaEm = ate;
      await registrarCobranca(assinatura, e, "paga");

      // A assinatura é gravada ANTES de o acesso ser concedido, e a ordem não
      // é estética.
      //
      // `aplicarAcesso` escreve no `User`. Se ela viesse primeiro e o `save()`
      // da assinatura falhasse depois — um índice único violado, por exemplo —
      // a pessoa ficaria com o acesso e a assinatura continuaria "pendente":
      // duas verdades opostas, e o webhook devolvendo 200 como se nada tivesse
      // acontecido. Aconteceu num teste contra o sandbox, e o efeito seguinte
      // foi pior: o evento repetido creditou um ciclo EM CIMA do prazo que a
      // tentativa falha já tinha gravado.
      //
      // Gravando a cobrança primeiro, ou as duas coisas valem, ou nenhuma.
      await assinatura.save();
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

    case "checkout.pago": {
      // NÃO libera nada, de propósito.
      //
      // "Concluiu o checkout" não é "o dinheiro entrou": quem libera acesso é
      // `pagamento.aprovado`, e ele vem logo atrás com o valor real. Tratar
      // este evento como pagamento liberaria acesso por uma tentativa de
      // cartão que ainda pode ser recusada. O que ele faz de útil é carimbar
      // os ids, e isso já aconteceu acima.
      break;
    }

    case "checkout.expirado": {
      // O link venceu ou foi abandonado sem pagar. Só faz sentido para quem
      // nunca chegou a pagar — uma assinatura já ativa não regride porque um
      // checkout velho expirou.
      if (assinatura.status === "pendente") assinatura.status = "expirada";
      break;
    }
  }

  assinatura.ultimoEventoEm = valida ?? new Date();
  await assinatura.save();
  return { resultado: "aplicado", assinatura };
}

/**
 * De quem é este evento.
 *
 * A ordem importa e é do mais estável para o mais frágil. A nossa referência
 * vem primeiro porque é a única que a gente controla; depois os ids do
 * gateway; e por último a pergunta ao próprio gateway, que custa uma chamada
 * de rede e só acontece quando todo o resto falhou.
 *
 * O último degrau existe por causa do checkout hospedado: entre "clicou em
 * assinar" e "pagou", a assinatura do Asaas ainda não existe — se o primeiro
 * evento de cobrança chegar antes do `CHECKOUT_PAID`, ele traz um
 * `subscription` que a gente nunca viu. Sem perguntar de onde veio, esse
 * evento seria descartado em silêncio, e alguém teria pago sem liberar nada.
 */
async function acharAssinatura(
  provedor: Provedor,
  e: EventoNormalizado
): Promise<AssinaturaDoc | null> {
  // Pela NOSSA referência primeiro: é a que não muda de forma.
  if (e.referencia && mongoose.isValidObjectId(e.referencia)) {
    const porRef = await Assinatura.findById(e.referencia);
    if (porRef) return porRef;
  }
  if (e.provedorAssinaturaId) {
    const porAssinatura = await Assinatura.findOne({
      provedorAssinaturaId: e.provedorAssinaturaId,
    });
    if (porAssinatura) return porAssinatura;
  }
  if (e.provedorCheckoutId) {
    const porCheckout = await Assinatura.findOne({ provedorCheckoutId: e.provedorCheckoutId });
    if (porCheckout) return porCheckout;
  }

  if (!e.provedorAssinaturaId) return null;

  const p = provedorPeloNome(provedor);
  if (!p?.resolverOrigem) return null;

  const origem = await p.resolverOrigem(e.provedorAssinaturaId);
  if (!origem) return null;

  if (origem.referencia && mongoose.isValidObjectId(origem.referencia)) {
    const porRef = await Assinatura.findById(origem.referencia);
    if (porRef) return porRef;
  }
  if (origem.provedorCheckoutId) {
    return Assinatura.findOne({ provedorCheckoutId: origem.provedorCheckoutId });
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

    // E no LOG também, não só no livro-razão.
    //
    // O webhook responde 200 mesmo quando o evento falha — tem de responder,
    // senão o gateway reenvia em laço. O preço disso é que a falha fica
    // invisível: um pagamento confirmado que não liberou nada não aparece em
    // lugar nenhum que alguém olhe. Sem esta linha, descobrir por que uma
    // assinatura não ativou exige ir ler `EventoDeCobranca` no banco — foi
    // exatamente o que custou uma rodada inteira de investigação.
    console.error(
      `[pagamentos] evento ${evento.eventoId} (${evento.tipo}) falhou:`,
      (err as Error).message
    );
  }
  registro.set("processadoEm", new Date());
  await registro.save();

  return { aceito: true };
}
