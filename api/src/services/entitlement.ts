import { User, type UserDoc } from "../models/User.js";
import { isFounder } from "./founders.js";
import { recordAudit, maskEmail } from "./adminAudit.js";
import { HttpError } from "../utils/httpError.js";

export type Plano = "free" | "pro" | "pro_plus";
export type Capacidade = "coach" | "nutri";

/**
 * O plano gravado na conta, tolerando quem ainda não tem o campo.
 *
 * Contas criadas antes do RUMO Pro não têm `plan`, só `tier`. Derivar daí é o
 * que impede o deploy de rebaixar, em silêncio, todo mundo que já paga — a
 * escada nova nasceu AO LADO de `tier`, não no lugar dele, porque o APK
 * instalado lê `tier` e compara com "premium".
 */
export function planDoUsuario(user: UserDoc): Plano {
  if (user.plan) return user.plan as Plano;
  return user.tier === "premium" ? "pro" : "free";
}

/** `tier` é derivado: qualquer plano pago é "premium" para quem lê de fora. */
export function tierDoPlan(plan: Plano): "free" | "premium" {
  return plan === "free" ? "free" : "premium";
}

/**
 * Quantos dias de folga uma cobrança recusada ganha antes de o acesso cair.
 *
 * Cartão vencido é a causa número um de falha de cobrança, e ela acontece com
 * quem quer continuar pagando. Derrubar na hora significaria, no caso de um
 * treinador, tirar o acesso de trinta alunos por causa de uma recusa que se
 * resolve trocando um cartão. A carência mora aqui, num lugar só, e vale para
 * todo mundo que lê o motor.
 */
export const CARENCIA_DE_INADIMPLENCIA_DIAS = 7;

/** De quanto em quanto tempo vale reescrever o carimbo quando nada mudou. */
const INTERVALO_DO_CARIMBO_MS = 12 * 60 * 60 * 1000;

/** A data ainda não passou? `null` conta como "sem prazo", que é para sempre. */
function valeAinda(ate: Date | null | undefined, agora: Date): boolean {
  return !ate || ate.getTime() > agora.getTime();
}

/**
 * O SKU comprado, traduzido no que ele concede ao CONSUMIDOR.
 *
 * O enum de `plan` não cresce com os produtos de propósito. Pro Coach e Pro
 * Nutri não são planos de consumidor — são o mesmo `pro` mais uma capacidade
 * profissional, que vive noutro eixo (`user.pro`). É isso que faz a regra "quem
 * compra Pro Coach não paga o Pro separado" cair sozinha, sem nenhuma linha
 * escrita para ela.
 */
function planoDoProduto(produto: string | null | undefined): Plano | null {
  switch (produto) {
    case "pro":
    case "pro_coach":
    case "pro_nutri":
      return "pro";
    case "pro_plus":
      return "pro_plus";
    default:
      return null;
  }
}

/**
 * Diz em que plano a pessoa está AGORA e por quê.
 *
 * FUNÇÃO PURA sobre o documento: nenhuma consulta, nenhum efeito. É o que
 * permite chamá-la dentro do `requireAuth`, que já carregou o usuário, sem
 * custo nenhum de banco — e é o que faz vencimento acontecer sem cron, porque
 * a comparação é sempre contra o relógio de agora.
 *
 * São cinco fontes de acesso pago e elas têm ordem. A ordem não é arbitrária:
 *
 * 1. CORTESIA DO ADMIN ganha de tudo. É o ponto desta camada desde o começo —
 *    uma cortesia dada pelo painel não pode ser derrubada em silêncio pelo
 *    próximo evento de expiração vindo do gateway.
 * 2. FUNDADOR vem de uma lista em env, lida ao vivo.
 * 3. CORTESIA DE CUPOM — meses grátis que nós concedemos, sem gateway.
 * 4. COMPRA, com a carência de inadimplência embutida.
 * 5. PATROCÍNIO — o aluno cujo profissional paga. Vem por ÚLTIMO de propósito:
 *    quem paga E é acompanhado deve aparecer como pagante nos relatórios, não
 *    como patrocinado, e não pode perder o que comprou se o vínculo encerrar.
 */
export function calcularPlan(user: UserDoc, agora = new Date()): Plano {
  const noDocumento = planDoUsuario(user);

  // 1. Cortesia do admin.
  if (user.premiumSource === "admin" && valeAinda(user.premiumUntil, agora)) {
    return noDocumento === "pro_plus" ? "pro_plus" : "pro";
  }
  // 2. Fundador.
  if (isFounder(user.email)) return noDocumento === "free" ? "pro" : noDocumento;
  // 3. Meses grátis de cupom.
  if (user.cortesiaAte && valeAinda(user.cortesiaAte, agora)) {
    return planoDoProduto(user.produtoAssinado) ?? "pro";
  }
  // 4. Compra. Inadimplente ganha alguns dias antes de cair.
  if (user.assinaturaStatus && user.assinaturaStatus !== "expirada") {
    const folga =
      user.assinaturaStatus === "inadimplente"
        ? CARENCIA_DE_INADIMPLENCIA_DIAS * 24 * 60 * 60 * 1000
        : 0;
    const limite = user.assinaturaAte ? new Date(user.assinaturaAte.getTime() + folga) : null;
    if (valeAinda(limite, agora)) {
      const doProduto = planoDoProduto(user.produtoAssinado);
      if (doProduto) return doProduto;
    }
  }
  // 4b. Compra pelo caminho antigo (RevenueCat), que não tem `produtoAssinado`.
  if (
    user.premiumSource === "purchase" &&
    noDocumento !== "free" &&
    valeAinda(user.premiumUntil, agora)
  ) {
    return noDocumento;
  }
  // 5. Patrocínio: alguém paga para acompanhar esta pessoa.
  if ((user.vinculosPatrocinados ?? 0) > 0) return "pro";

  // 6. LEGADO: premium sem nenhuma fonte que o explique.
  //
  // O primeiro webhook do RevenueCat que foi para produção fazia
  // `User.updateOne({_id}, { tier })` e mais nada — sem `premiumSource`, sem
  // `plan`. Quem comprou naquela época tem `tier: "premium"` e nenhum campo que
  // prove por quê. Sem este ramo, essas contas cairiam para free no primeiro
  // request, e o `recomputeTier` gravaria `tier: "free"` por cima — apagando a
  // ÚNICA evidência de que aquela pessoa pagou. Não haveria como reconstruir.
  //
  // Na dúvida entre cobrar de novo de quem já pagou e liberar para alguém que
  // não deveria, este projeto erra para o lado de quem pagou.
  //
  // Temporário: `npm run direitos:backfill` carimba `premiumSource: "purchase"`
  // nessas contas. Depois de ele rodar em produção e o diagnóstico acusar zero,
  // este ramo pode sair.
  if (ehPremiumLegado(user)) return "pro";

  return "free";
}

/**
 * Esta conta é premium de ANTES de o motor existir?
 *
 * O primeiro webhook do RevenueCat gravava `tier: "premium"` e mais nada. Essas
 * contas não têm como provar que pagaram, e rebaixá-las apagaria a única
 * evidência — por isso o motor as segura.
 *
 * A condição é SEM ORIGEM, e não `plan` ausente. Tentei ancorar em `plan`
 * ausente e estava errado: a Fase 0 já rodou em produção e gravou `plan: "pro"`
 * nessas contas sem gravar origem nenhuma. Ancorar ali teria rebaixado
 * justamente quem abriu o app depois daquele deploy — a maior parte delas.
 *
 * O laço que essa tentativa queria fechar (premium por patrocínio parecendo
 * legado depois que o patrocínio acaba) é fechado do outro lado: o patrocínio
 * CARIMBA `premiumSource: "patrocinio"`, então uma conta ex-patrocinada tem
 * origem e nunca cai aqui.
 *
 * `recomputeTier` carimba a origem quando isto dá verdadeiro, então cada conta
 * passa por aqui UMA vez e depois entra pelo ramo normal de compra.
 */
export function ehPremiumLegado(user: UserDoc): boolean {
  return (
    user.tier === "premium" &&
    !user.premiumSource &&
    !user.assinaturaStatus &&
    !user.cortesiaAte &&
    !user.produtoAssinado &&
    (user.vinculosPatrocinados ?? 0) === 0
  );
}

/** Mantida porque meio projeto (e o app instalado) raciocina em free/premium. */
export function calcularTier(user: UserDoc, agora = new Date()): "free" | "premium" {
  return tierDoPlan(calcularPlan(user, agora));
}

/**
 * O plano efetivo, já com o rótulo de quem tem os dois painéis.
 *
 * `pro_plus` não desbloqueava nada e não havia caminho para alguém virar
 * `pro_plus` — ele existia só no enum. Agora ele é o que sempre deveria ter
 * sido: o RÓTULO DERIVADO de ter as duas capacidades ativas, venham elas de
 * compra ou da mão do admin. Nada além disso depende dele.
 */
export function planEfetivo(user: UserDoc, agora = new Date()): Plano {
  const base = calcularPlan(user, agora);
  if (base === "free") return "free";
  const dois = temCapacidade(user, "coach", agora) && temCapacidade(user, "nutri", agora);
  return dois ? "pro_plus" : base;
}

/**
 * Recalcula e grava plano e tier só quando mudam. Expira cortesia sem cron.
 *
 * Grava com `updateOne`, e NÃO com `user.save()`.
 *
 * Esta função passou a ser chamada dentro do `requireAuth`, antes de a rota
 * rodar. Um `save()` grava o documento inteiro: se a rota carregar o mesmo
 * usuário, mexer noutro campo e salvar depois, o documento dela — montado
 * antes desta escrita — sobrescreveria o plano recém-calculado. É o mesmo
 * motivo pelo qual `marcarPresenca` usa `updateOne`, e a mesma classe de bug.
 *
 * A mutação em memória vem junto porque `req.user` já está na mão de quem
 * chamou: sem ela, a requisição atual decidiria pelo valor velho.
 */
export async function recomputeTier(user: UserDoc): Promise<void> {
  // Guardados antes de qualquer mutação: são a precondição da escrita.
  const planoAntes = user.plan;
  const tierAntes = user.tier;

  const novoPlan = planEfetivo(user);
  const novoTier = tierDoPlan(novoPlan);

  const mudanca: Record<string, unknown> = { direitosCalculadoEm: new Date() };

  // A origem é gravada a partir do que o motor JÁ SABE, e não adivinhada.
  //
  // A primeira versão testava predicados soltos e errava em dois casos reais:
  // um premium legado que aceitasse um convite era carimbado como
  // "patrocinio" (e perdia o Pro no dia em que o acompanhamento acabasse,
  // apagando a evidência de que tinha pago), e todo fundador virava "compra"
  // no segundo request — o que o tornaria Pro para sempre mesmo saindo da
  // lista, e impediria o painel de mexer nele.
  //
  // A pergunta certa é: **por que esta conta é paga SEM contar o patrocínio?**
  if (!user.premiumSource) {
    const semPatrocinio = calcularPlan({
      ...(user.toObject() as object),
      vinculosPatrocinados: 0,
    } as UserDoc);

    if (isFounder(user.email)) {
      mudanca.premiumSource = "founder";
    } else if (semPatrocinio !== "free") {
      // Ela se sustenta sozinha: é o legado, e vira compra de uma vez por
      // todas — sai do ramo de legado e passa a ser julgada como qualquer
      // outra compra.
      mudanca.premiumSource = "purchase";
    } else if (novoPlan !== "free" && (user.vinculosPatrocinados ?? 0) > 0) {
      // Só é paga PORQUE alguém a banca. Origem própria, para não ser
      // confundida com legado no dia em que o vínculo acabar.
      mudanca.premiumSource = "patrocinio";
    }
  }

  // Carimbar origem também é mudança: sem contar aqui, o atalho de 12h abaixo
  // engoliria a escrita e a conta ficaria sem origem — foi assim que um
  // premium legado acompanhado quase perdeu o Pro no fim do acompanhamento.
  const mudou =
    user.plan !== novoPlan || user.tier !== novoTier || mudanca.premiumSource !== undefined;

  if (mudou) {
    mudanca.plan = novoPlan;
    mudanca.tier = novoTier;
    // Origem que deixou de valer: apaga, senão a conta continuaria dizendo
    // "premium por cortesia" (ou "por patrocínio") já sendo free, e a próxima
    // leitura ficaria confusa — inclusive a que decide se ela é legado.
    if (novoPlan === "free" && (user.premiumSource === "admin" || user.premiumSource === "patrocinio")) {
      mudanca.premiumSource = null;
      mudanca.premiumUntil = null;
    }
  } else if (
    // Nada mudou e o carimbo é recente: não vale uma escrita por requisição.
    //
    // Isto NÃO atrasa vencimento: `calcularPlan` roda todo request contra o
    // relógio de agora, então uma cortesia que venceu faz o plano divergir e
    // cai no ramo de cima, que grava na hora. Este ramo só evita reescrever o
    // mesmo valor.
    user.direitosCalculadoEm &&
    Date.now() - user.direitosCalculadoEm.getTime() < INTERVALO_DO_CARIMBO_MS
  ) {
    return;
  }

  // O documento em memória vem PRIMEIRO, e de propósito.
  //
  // O cálculo é puro e não pode falhar; só a gravação pode. A permissão desta
  // requisição tem de sair certa mesmo que o banco recuse a escrita — senão
  // uma indisponibilidade momentânea viraria "você não é mais premium".
  for (const [campo, valor] of Object.entries(mudanca)) {
    user.set(campo, valor);
  }
  user.unmarkModified("plan");
  user.unmarkModified("tier");

  try {
    // O filtro carrega o estado OBSERVADO, e não só o `_id`.
    //
    // Isto aqui roda a partir de um documento carregado no começo da
    // requisição. Se o webhook de compra gravar no meio do caminho, um `$set`
    // por `_id` desfaria a compra: o cálculo foi feito sobre o documento de
    // antes. Com o estado no filtro, a escrita simplesmente não se aplica, e a
    // requisição seguinte recalcula já com o valor novo.
    const r = await User.updateOne(
      {
        _id: user._id,
        plan: planoAntes === undefined ? { $exists: false } : planoAntes,
        tier: tierAntes,
      },
      { $set: mudanca }
    );
    if (r.matchedCount === 0) return;
  } catch {
    // Falhar em gravar NÃO pode derrubar a sessão.
    //
    // `requireAuth` transforma qualquer exceção em 401, e o app apaga o token
    // do aparelho quando toma 401 no boot (`AuthContext`). Ou seja: um timeout
    // de escrita no Mongo, no segundo em que a pessoa abre o app, faria ela
    // ser deslogada de verdade e ter de lembrar a senha. O valor em memória já
    // está certo; a próxima requisição tenta gravar de novo.
  }
}

// ATENÇÃO, ao mexer em `concederPro`/`revogarPro`: a capacidade decide se os
// ALUNOS daquele profissional ganham Pro (`services/patrocinio.ts`). Este
// arquivo não chama o patrocínio de propósito — seria ciclo de import, porque
// o patrocínio precisa de `recomputeTier` daqui. Quem chama são os dois
// lugares que concedem: `routes/admin/users.ts` e `scripts/grantPro.ts`. Um
// terceiro caminho de concessão precisa chamar também.

/**
 * A pessoa pode atuar como coach/nutri agora?
 *
 * Independente de `plan` e de `role`: são três eixos separados. O coach também
 * é aluno (e pode ser aluno free), e ser admin não torna ninguém coach.
 */
export function temCapacidade(user: UserDoc, qual: Capacidade, agora = new Date()): boolean {
  const c = user.pro?.[qual];
  if (!c?.ativo) return false;
  return !c.validoAte || c.validoAte.getTime() > agora.getTime();
}

/** Quantos alunos esta pessoa pode acompanhar nesta capacidade. */
export function limiteDeAlunos(user: UserDoc, qual: Capacidade): number {
  return user.pro?.[qual]?.limiteDeAlunos ?? 10;
}

/** Libera coach/nutri pelo painel. `dias` nulo = sem prazo. */
export async function concederPro(
  ator: UserDoc,
  alvo: UserDoc,
  qual: Capacidade,
  dias: number | null,
  motivo: string,
  teto?: number
): Promise<UserDoc> {
  const antes = { [qual]: temCapacidade(alvo, qual) };

  alvo.set("pro." + qual, {
    ativo: true,
    origem: "manual",
    validoAte: dias ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null,
    limiteDeAlunos: teto ?? limiteDeAlunos(alvo, qual),
  });
  await alvo.save();

  await recordAudit({
    actor: ator,
    action: "pro." + qual + ".grant",
    targetKind: "user",
    targetId: alvo._id,
    targetLabel: maskEmail(alvo.email),
    reason: motivo,
    before: antes,
    after: { [qual]: true },
  });
  return alvo;
}

/**
 * Tira a capacidade. Os vínculos NÃO são apagados: eles são o histórico do
 * acompanhamento, e o aluno continua dono dos dados dele. O que some é o
 * acesso — quem perde a capacidade para de passar pelo `requirePro`.
 */
export async function revogarPro(
  ator: UserDoc,
  alvo: UserDoc,
  qual: Capacidade,
  motivo: string
): Promise<UserDoc> {
  if (!temCapacidade(alvo, qual)) {
    throw new HttpError(400, "Esta conta não tem essa capacidade ativa.");
  }
  alvo.set("pro." + qual + ".ativo", false);
  alvo.set("pro." + qual + ".origem", null);
  await alvo.save();

  await recordAudit({
    actor: ator,
    action: "pro." + qual + ".revoke",
    targetKind: "user",
    targetId: alvo._id,
    targetLabel: maskEmail(alvo.email),
    reason: motivo,
    before: { [qual]: true },
    after: { [qual]: false },
  });
  return alvo;
}

/** Concede premium pelo painel. `dias` nulo = sem prazo. */
export async function concederPremium(
  ator: UserDoc,
  alvo: UserDoc,
  dias: number | null,
  motivo: string
): Promise<UserDoc> {
  const antes = { tier: alvo.tier };
  alvo.premiumSource = "admin";
  alvo.premiumUntil = dias ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null;
  // Cortesia entra como "pro"; quem já era "pro_plus" não é rebaixado por ela.
  if (planDoUsuario(alvo) !== "pro_plus") alvo.plan = "pro";
  alvo.tier = "premium";
  await alvo.save();

  await recordAudit({
    actor: ator, action: "premium.grant", targetKind: "user", targetId: alvo._id,
    targetLabel: maskEmail(alvo.email), reason: motivo,
    before: antes, after: { tier: "premium" },
  });
  return alvo;
}

/** Tira a cortesia. Se houver compra ativa, a pessoa continua premium. */
export async function revogarPremium(
  ator: UserDoc,
  alvo: UserDoc,
  motivo: string
): Promise<{ user: UserDoc; aindaPremiumPor: string | null }> {
  if (alvo.premiumSource !== "admin") {
    throw new HttpError(400, "Esta conta não tem cortesia para remover.");
  }
  const antes = { tier: alvo.tier };

  alvo.premiumSource = null;
  alvo.premiumUntil = null;
  alvo.plan = "free";
  alvo.tier = "free";
  await alvo.save();

  // Fundador continua premium pela lista de env, mesmo sem cortesia.
  const aindaPremiumPor = isFounder(alvo.email) ? "founder" : null;
  if (aindaPremiumPor) {
    alvo.plan = "pro";
    alvo.tier = "premium";
    await alvo.save();
  }

  await recordAudit({
    actor: ator, action: "premium.revoke", targetKind: "user", targetId: alvo._id,
    targetLabel: maskEmail(alvo.email), reason: motivo,
    before: antes, after: { tier: alvo.tier },
  });
  return { user: alvo, aindaPremiumPor };
}

/** Aplica um evento da loja SEM pisar na cortesia do admin. */
export async function aplicarEventoDeCompra(userId: string, ativo: boolean): Promise<void> {
  const user = await User.findById(userId);
  if (!user) return;

  if (ativo) {
    user.premiumSource = "purchase";
    // A loja diz que pagou, não QUAL plano: sem informação de produto, entra
    // como "pro". Quem já estava em "pro_plus" continua onde estava.
    if (planDoUsuario(user) !== "pro_plus") user.plan = "pro";
    user.tier = "premium";
    await user.save();
    return;
  }

  // Expiração/problema de cobrança: só derruba quem é premium POR COMPRA.
  // Cortesia e fundador sobrevivem — era exatamente isso que quebrava antes.
  if (user.premiumSource === "admin" || isFounder(user.email)) return;

  user.premiumSource = null;
  user.plan = "free";
  user.tier = "free";
  await user.save();
}
