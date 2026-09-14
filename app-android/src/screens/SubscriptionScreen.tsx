import React, { useCallback, useRef, useState } from "react";
import { View, AppState, TouchableOpacity, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { notify, confirmDialog } from "../lib/notify";
import { irParaPagamento } from "../lib/checkout";
import {
  listarProdutos,
  abrirCheckout,
  obterAssinatura,
  cancelarAssinatura,
  type AssinaturaAtual,
  type Ciclo,
  type ProdutoDoCatalogo,
} from "../api/billing";
import { Button, Txt, Screen, Card, Chip, ErrorState } from "../components/ui";
import { SkeletonLista } from "../components/Skeleton";
import { colors, radius, spacing } from "../theme";
import { MARCA } from "../marca";

// A tela de planos.
//
// Três coisas dela não são escolhas de estilo:
//
//  - **Preço, benefício e "3 meses grátis" vêm do servidor.** O APK instalado
//    não se atualiza sozinho; qualquer promessa comercial escrita aqui fica
//    congelada na versão que a pessoa baixou e vira mentira quando o catálogo
//    mudar.
//  - **O pagamento acontece FORA do app**, numa página do gateway. É lá que o
//    CPF e o cartão são digitados, e nada disso passa por aqui nem é gravado.
//  - **Quem já assina vê o cancelamento na mesma tela.** Caminho de entrada sem
//    caminho de saída é armadilha.

/** Só o Pro é para todo mundo. Os outros três são para quem atende gente. */
const PARA_PROFISSIONAL: string[] = ["pro_coach", "pro_nutri", "pro_plus"];

const STATUS_LEGIVEL: Record<AssinaturaAtual["status"], string> = {
  ativa: "Ativa",
  inadimplente: "Pagamento pendente",
  cancelada: "Cancelada",
};

function comoData(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function SubscriptionScreen() {
  const { user, token, refreshUser } = useAuth();

  const [produtos, setProdutos] = useState<ProdutoDoCatalogo[]>([]);
  /** Espelho de `produtos` para o `carregar` não depender dele e se recriar. */
  const produtosRef = useRef<ProdutoDoCatalogo[]>([]);
  const [assinatura, setAssinatura] = useState<AssinaturaAtual | null>(null);
  const [ciclo, setCiclo] = useState<Ciclo>("mensal");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  /** Ligado depois de mandar a pessoa ao gateway: o pagamento termina lá fora. */
  const [esperandoPagamento, setEsperandoPagamento] = useState(false);

  const carregar = useCallback(
    async (silencioso = false) => {
      if (!silencioso) setLoading(true);
      // As duas chamadas são independentes de propósito: o catálogo é público
      // e a assinatura não. Num `Promise.all`, um 401 na assinatura derrubaria
      // junto a vitrine, que não depende de login nenhum.
      const [cat, atual] = await Promise.allSettled([
        listarProdutos(),
        token ? obterAssinatura(token) : Promise.resolve({ data: null }),
      ]);

      if (cat.status === "fulfilled") {
        setProdutos(cat.value.data);
        produtosRef.current = cat.value.data;
      }
      if (atual.status === "fulfilled") setAssinatura(atual.value.data);

      // Recarga silenciosa NÃO pode apagar o que já estava bom.
      //
      // O cenário é o mais provável de todos: a pessoa volta do gateway com a
      // rede ainda cambaleando, o reload falha, e o catálogo que já estava na
      // tela some — no lugar dele, "Deu ruim aqui". Só vira erro quando não há
      // nada para mostrar.
      const falhouOCatalogo = cat.status === "rejected";
      setErro(falhouOCatalogo && (!silencioso || produtosRef.current.length === 0));
      setLoading(false);
    },
    [token]
  );

  // Recarrega ao focar a tela E ao o aplicativo voltar a ficar visível.
  //
  // O segundo é o que fecha o ciclo do pagamento, e o primeiro sozinho NÃO
  // fecha: sair para o navegador não desfoca a tela — ela continua no topo da
  // pilha de navegação —, então `useFocusEffect` não dispara de novo na volta.
  // Quem pagou voltaria vendo "Destrave sua evolução".
  //
  // `AppState` cobre os dois ambientes: no react-native-web ele é implementado
  // sobre `visibilitychange`, então voltar para a aba vale o mesmo que voltar
  // do Chrome no Android. É o padrão que `ConversaScreen` já usa.
  useFocusEffect(
    useCallback(() => {
      const atualizar = () => {
        void carregar(true);
        // `refreshUser` lança quando a rede cai, e aqui ninguém o espera —
        // sem o catch vira unhandled rejection.
        void refreshUser().catch(() => {});
      };
      atualizar();
      const sub = AppState.addEventListener("change", (estado) => {
        if (estado === "active") atualizar();
      });
      return () => sub.remove();
    }, [carregar, refreshUser])
  );

  async function assinar(p: ProdutoDoCatalogo) {
    if (!token) return;
    setAbrindo(p.produto);
    try {
      const r = await abrirCheckout(token, p.produto, ciclo);
      await irParaPagamento(r.data.urlDeCheckout);
      // Só DEPOIS de ter aberto. Ligar o aviso antes deixaria a pessoa olhando
      // um "terminando o pagamento" sem que nada tivesse aberto.
      setEsperandoPagamento(true);
    } catch (e) {
      notify("Não deu para abrir o pagamento", (e as Error).message);
    } finally {
      setAbrindo(null);
    }
  }

  function pedirCancelamento() {
    const ate = comoData(assinatura?.validoAte ?? null);
    confirmDialog(
      "Cancelar a renovação?",
      ate
        ? `Você continua com tudo até ${ate}. Depois disso, sua conta volta para o plano grátis e seus dados continuam aqui.`
        : "Você continua com o que já pagou até o fim do período. Depois disso, sua conta volta para o plano grátis.",
      () => void cancelar(),
      // No Android o outro botão é "Cancelar", que aqui significa DESISTIR.
      // Dois botões começando com a mesma palavra e querendo dizer o oposto.
      "Parar de renovar"
    );
  }

  async function cancelar() {
    if (!token) return;
    setCancelando(true);
    try {
      const r = await cancelarAssinatura(token);
      setAssinatura(r.data);
      // FORA do que o `catch` observa, e de propósito: um tropeço de rede aqui
      // — com o cancelamento já feito no servidor — mostraria "Não deu para
      // cancelar" em cima de um cartão que já diz "Cancelada", e a pessoa
      // tentaria de novo.
      void refreshUser().catch(() => {});
      notify(
        "Renovação cancelada",
        r.data.validoAte
          ? `Seu acesso continua até ${comoData(r.data.validoAte)}.`
          : "Seu acesso continua até o fim do período pago."
      );
    } catch (e) {
      notify("Não deu para cancelar", (e as Error).message);
    } finally {
      setCancelando(false);
    }
  }

  if (loading) {
    return (
      <Screen scroll underHeader>
        <SkeletonLista />
      </Screen>
    );
  }

  if (erro) {
    return (
      <Screen underHeader>
        <ErrorState onRetry={() => void carregar()} />
      </Screen>
    );
  }

  const ehPro = (user?.plan ?? (user?.tier === "premium" ? "pro" : "free")) !== "free";
  const temAssinatura = assinatura !== null;
  // Pro sem assinatura: cortesia, fundador, ou alguém pagando para acompanhar.
  // A tela não afirma qual — ela não sabe, e chutar seria pior que não dizer.
  const proSemAssinatura = ehPro && !temAssinatura;
  // Só quem está com a assinatura EM DIA não precisa dos planos na tela.
  //
  // O inadimplente precisa mais que todo mundo: a cobrança dele falhou, e sem
  // um caminho de volta ao pagamento a tela lhe diria "confira seu cartão" sem
  // oferecer onde. Era o pior estado da tela justamente para quem está
  // tentando continuar pagando.
  const podeAssinar = !temAssinatura || assinatura.status !== "ativa";

  const devendo = assinatura?.status === "inadimplente";
  const cancelada = assinatura?.status === "cancelada";

  const paraMim = produtos.find((p) => !PARA_PROFISSIONAL.includes(p.produto)) ?? null;
  const paraProfissionais = produtos.filter((p) => PARA_PROFISSIONAL.includes(p.produto));

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.lg }}>
      {temAssinatura ? (
        <AssinaturaAtualCard
          assinatura={assinatura}
          cancelando={cancelando}
          onCancelar={pedirCancelamento}
        />
      ) : null}

      {proSemAssinatura ? (
        <Card level={2} style={{ gap: spacing.xs }}>
          <Txt variant="titleCard">Seu acesso completo está ativo</Txt>
          <Txt variant="body" color={colors.text2}>
            {user?.isFounder
              ? `Você é fundador do ${MARCA} — tudo liberado, sem pagar nada.`
              : "Você já tem tudo liberado. Não precisa assinar."}
          </Txt>
        </Card>
      ) : null}

      {esperandoPagamento && podeAssinar ? (
        <Card level={2} style={{ gap: spacing.sm }}>
          <Txt variant="titleCard">Terminando o pagamento</Txt>
          <Txt variant="body" color={colors.text2}>
            Abrimos a página de pagamento fora do app. Quando terminar, volte aqui — se não
            aparecer sozinho, toque abaixo.
          </Txt>
          <Button
            title="Já paguei, atualizar"
            variant="secondary"
            onPress={() => {
              void carregar(true);
              void refreshUser().catch(() => {});
            }}
          />
          <TouchableOpacity
            onPress={() => setEsperandoPagamento(false)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {/* Quem desistiu do pagamento não pode ficar preso a este aviso. */}
            <Txt variant="label" color={colors.text3} style={{ textAlign: "center" }}>
              Desisti por agora
            </Txt>
          </TouchableOpacity>
        </Card>
      ) : null}

      {!podeAssinar ? null : (
        <>
          <View style={{ gap: spacing.xs }}>
            <Txt variant="titleScreen">
              {devendo
                ? "Retomar o pagamento"
                : cancelada
                  ? "Mudou de ideia?"
                  : proSemAssinatura
                    ? "Quer o painel profissional?"
                    : "Destrave sua evolução"}
            </Txt>
            <Txt variant="body" color={colors.text2}>
              {devendo
                ? "Escolha o plano de novo para cadastrar outro cartão. O que você já pagou continua valendo."
                : cancelada
                  ? "Reative quando quiser. Os dias que você já pagou não se perdem."
                  : proSemAssinatura
                    ? "Assine para atender outras pessoas dentro do app."
                    : "No grátis você registra tudo e a IA monta seu plano. O Pro é o que mostra para onde você está indo."}
            </Txt>
          </View>

          <SeletorDeCiclo
            ciclo={ciclo}
            onChange={setCiclo}
            mesesGratis={paraMim?.mesesGratisNoAnual ?? 0}
          />

          {/* O Pro primeiro e sozinho: é o único que serve para todo mundo, e
              empilhar quatro cartões iguais faria a escolha de 90% das pessoas
              competir com três que não são para elas. */}
          {paraMim && !proSemAssinatura ? (
            <PlanoCard
              produto={paraMim}
              ciclo={ciclo}
              destaque
              carregando={abrindo === paraMim.produto}
              desabilitado={abrindo !== null}
              onAssinar={() => void assinar(paraMim)}
            />
          ) : null}

          {paraProfissionais.length > 0 ? (
            <View style={{ gap: spacing.xs, marginTop: spacing.md }}>
              <Txt variant="titleSection">
                {proSemAssinatura ? "Planos com painel" : "Você acompanha outras pessoas?"}
              </Txt>
              <Txt variant="body" color={colors.text2}>
                Quem você acompanha ganha o Pro enquanto durar o acompanhamento.
              </Txt>
            </View>
          ) : null}

          {paraProfissionais.map((p) => (
            <PlanoCard
              key={p.produto}
              produto={p}
              ciclo={ciclo}
              destaque={false}
              carregando={abrindo === p.produto}
              desabilitado={abrindo !== null}
              onAssinar={() => void assinar(p)}
            />
          ))}

          <Txt variant="caption" color={colors.text3} style={{ textAlign: "center" }}>
            Cobrança no cartão, renovada automaticamente. Você cancela quando quiser, aqui
            mesmo, e continua com o que já pagou até o fim do período.
          </Txt>
        </>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------- pedaços

function SeletorDeCiclo({
  ciclo,
  onChange,
  mesesGratis,
}: {
  ciclo: Ciclo;
  onChange: (c: Ciclo) => void;
  mesesGratis: number;
}) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
      <Chip label="Mensal" active={ciclo === "mensal"} onPress={() => onChange("mensal")} />
      <Chip
        // O número vem do servidor: escrito aqui, viraria mentira no dia em que
        // alguém mexesse no preço sem lembrar do texto.
        label={mesesGratis > 0 ? `Anual · ${mesesGratis} meses grátis` : "Anual"}
        active={ciclo === "anual"}
        onPress={() => onChange("anual")}
      />
    </View>
  );
}

function PlanoCard({
  produto,
  ciclo,
  destaque,
  carregando,
  desabilitado,
  onAssinar,
}: {
  produto: ProdutoDoCatalogo;
  ciclo: Ciclo;
  destaque: boolean;
  carregando: boolean;
  desabilitado: boolean;
  onAssinar: () => void;
}) {
  const preco = produto.precoFormatado[ciclo];
  const porMes =
    ciclo === "anual"
      ? `${(produto.precoCentavos.anual / 12 / 100).toFixed(2).replace(".", ",")}`
      : null;

  return (
    <Card
      level={destaque ? 3 : 2}
      style={[
        { gap: spacing.md },
        destaque ? { borderColor: colors.lime, borderWidth: 1 } : null,
      ]}
    >
      <View style={{ gap: spacing.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Txt variant="titleCard">{produto.nome}</Txt>
          {destaque ? (
            <View
              style={{
                backgroundColor: colors.limeSoft,
                borderRadius: radius.full,
                paddingVertical: 2,
                paddingHorizontal: spacing.sm,
              }}
            >
              <Txt variant="caption" color={colors.limeBright}>
                mais escolhido
              </Txt>
            </View>
          ) : null}
        </View>
        <Txt variant="body" color={colors.text2}>
          {produto.resumo}
        </Txt>
      </View>

      <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs }}>
        <Txt variant="metricMd">{preco}</Txt>
        <Txt variant="body" color={colors.text2}>
          {ciclo === "anual" ? "/ano" : "/mês"}
        </Txt>
      </View>
      {porMes ? (
        <Txt variant="caption" color={colors.text3} style={{ marginTop: -spacing.sm }}>
          Equivale a R$ {porMes} por mês
        </Txt>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        {/* `?? []` porque o servidor pode ser mais VELHO que este aplicativo.
            O campo é novo; contra uma versão anterior da API ele vem ausente, e
            um `.map` em `undefined` derrubaria a tela inteira em vez de mostrar
            um cartão sem a lista. */}
        {(produto.beneficios ?? []).map((b) => (
          <View key={b} style={{ flexDirection: "row", gap: spacing.sm }}>
            <Txt color={colors.lime} style={{ fontSize: 15, fontWeight: "800" }}>
              ✓
            </Txt>
            <Txt variant="body" style={{ flex: 1 }}>
              {b}
            </Txt>
          </View>
        ))}
      </View>

      <Button
        title={`Assinar ${produto.nome}`}
        onPress={onAssinar}
        loading={carregando}
        disabled={desabilitado && !carregando}
        variant={destaque ? "primary" : "secondary"}
        size="lg"
      />
    </Card>
  );
}

function AssinaturaAtualCard({
  assinatura,
  cancelando,
  onCancelar,
}: {
  assinatura: AssinaturaAtual;
  cancelando: boolean;
  onCancelar: () => void;
}) {
  const vale = comoData(assinatura.validoAte);
  const cancelada = assinatura.status === "cancelada";
  const devendo = assinatura.status === "inadimplente";

  return (
    <Card level={3} style={{ gap: spacing.md, borderColor: colors.lime, borderWidth: 1 }}>
      <View style={{ gap: spacing.xs }}>
        <Txt variant="label" color={colors.text2}>
          Sua assinatura
        </Txt>
        <Txt variant="titleScreen">{assinatura.nome}</Txt>
        <Txt variant="body" color={colors.text2}>
          {assinatura.valorFormatado} · {assinatura.ciclo} · {STATUS_LEGIVEL[assinatura.status]}
        </Txt>
      </View>

      {devendo ? (
        <Txt variant="body" color={colors.warning}>
          A última cobrança não passou. Confira seu cartão — seu acesso continua por alguns dias.
        </Txt>
      ) : cancelada ? (
        <Txt variant="body" color={colors.text2}>
          {vale
            ? `A renovação está cancelada. Você continua com tudo até ${vale}.`
            : "A renovação está cancelada. Você continua com tudo até o fim do período pago."}
        </Txt>
      ) : vale ? (
        <Txt variant="body" color={colors.text2}>
          Renova em {vale}.
        </Txt>
      ) : null}

      {cancelada ? null : (
        <TouchableOpacity
          onPress={onCancelar}
          disabled={cancelando}
          activeOpacity={0.7}
          // Texto pequeno e sozinho no fim do cartão: sem isto o alvo de toque
          // fica menor que o mínimo confortável.
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {cancelando ? <ActivityIndicator size="small" color={colors.danger} /> : null}
            {/* Vermelho porque é a regra da casa para ação destrutiva — e esta
                cancela uma cobrança. Fica por último e pede confirmação. */}
            <Txt variant="label" color={colors.danger}>
              Cancelar renovação
            </Txt>
          </View>
        </TouchableOpacity>
      )}
    </Card>
  );
}
