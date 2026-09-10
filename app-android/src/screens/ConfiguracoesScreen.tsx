// Tudo que é ajuste da conta mora aqui, agrupado por assunto: Conta,
// Privacidade, Notificações e Sobre. Antes estava espalhado — privacidade só
// existia no diálogo pós-treino, e "Sair" era um botão solto no perfil, do lado
// de "Editar perfil", fácil de tocar sem querer.
//
// Sair desce para o fim de tudo e pede confirmação. É a ação mais destrutiva
// desta tela, então é a última e a única que pergunta.

import React, { useCallback, useState } from "react";
import { View, StyleSheet, Switch, Pressable } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import {
  getSettings,
  updateSettings,
  type Settings,
  type MudancaDeSettings,
  type PreferenciasDeNotificacao,
} from "../api/settings";
import { Screen, Txt, Card, ErrorState } from "../components/ui";
import { Skeleton } from "../components/Skeleton";
import { confirmDialog, notify } from "../lib/notify";
import { estadoDoPush, ligarPush, type EstadoDaPermissao } from "../lib/push";
import { EscolherPlataformaSheet } from "../components/EscolherPlataformaSheet";
import {
  getPlataforma,
  setPlataforma,
  NOME_DA_PLATAFORMA,
  type PlataformaDeVideo,
} from "../lib/plataformaDeVideo";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";
import app from "../../app.json";

type Nav = NativeStackNavigationProp<AppStackParams>;

export function ConfiguracoesScreen() {
  const nav = useNavigation<Nav>();
  const { user, token, logout, refreshUser } = useAuth();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [push, setPush] = useState<EstadoDaPermissao>("indisponivel");
  const [plataforma, setPlataformaLocal] = useState<PlataformaDeVideo | null>(null);
  const [trocandoPlataforma, setTrocandoPlataforma] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const { data } = await getSettings(token!);
      setSettings(data);
      setErro(null);
    } catch (err) {
      setErro((err as Error).message);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void carregar();
      // Reconferido a cada abertura: a pessoa pode ter mexido na permissão nas
      // Configurações do sistema, e a chave aqui precisa contar a verdade.
      void estadoDoPush().then(setPush);
      void getPlataforma().then(setPlataformaLocal);
    }, [carregar])
  );

  // O pedido de permissão sai daqui, e não da abertura do app: negado no iOS é
  // definitivo — não dá para perguntar de novo, só mandar a pessoa no sistema.
  async function mexerNoPush(ligar: boolean) {
    if (!ligar) {
      notify(
        "Desligue pelo sistema",
        "Para parar de receber no celular, desative as notificações do FitSocial nas configurações do aparelho."
      );
      return;
    }
    const resultado = await ligarPush(token!);
    setPush(resultado);
    if (resultado === "negada") {
      notify(
        "Permissão negada",
        "Você já recusou as notificações antes. Para liberar, ative o FitSocial nas configurações do aparelho."
      );
    }
  }

  // O switch responde na hora e desfaz se o servidor recusar. Esperar a rede
  // para mover um botão deixa a tela com cara de travada.
  async function salvar(mudanca: MudancaDeSettings, otimista: Settings) {
    const anterior = settings;
    setSettings(otimista);
    try {
      const { data } = await updateSettings(token!, mudanca);
      setSettings(data);
      // O perfil lê activitiesPublic do usuário em memória para saber se ainda
      // precisa fazer a pergunta pós-treino.
      if (mudanca.activitiesPublic !== undefined) await refreshUser();
    } catch (err) {
      setSettings(anterior);
      notify("Não deu para salvar", (err as Error).message);
    }
  }

  function salvarNotif(valor: boolean, chave: keyof PreferenciasDeNotificacao) {
    if (!settings) return;
    void salvar(
      { notificacoes: { [chave]: valor } },
      { ...settings, notificacoes: { ...settings.notificacoes, [chave]: valor } }
    );
  }

  function sair() {
    confirmDialog(
      "Sair da conta?",
      "Você vai precisar entrar de novo com e-mail e senha.",
      () => void logout(),
      "Sair"
    );
  }

  if (erro && !settings) {
    return (
      <Screen underHeader>
        <ErrorState message={erro} onRetry={() => void carregar()} />
      </Screen>
    );
  }

  const notif = settings?.notificacoes;

  return (
    <Screen scroll underHeader>
      <Secao titulo="Conta">
        <Linha
          titulo="Editar perfil"
          detalhe={user?.username ? `@${user.username}` : (user?.name ?? "")}
          onPress={() => nav.navigate("EditProfile")}
        />
        <Linha titulo="E-mail" detalhe={user?.email ?? ""} />
        <Linha titulo="Alterar senha" onPress={() => nav.navigate("AlterarSenha")} />
        <Linha
          titulo="Excluir minha conta"
          onPress={() => nav.navigate("ExcluirConta")}
          perigosa
          ultima
        />
      </Secao>

      <Secao
        titulo="Privacidade"
        nota="Vale para todo mundo que abrir seu perfil, inclusive quem não te segue."
      >
        {settings ? (
          <>
            <Chave
              titulo="Treinos públicos"
              descricao="Esporte, tempo e resultado aparecem no seu perfil."
              ligado={settings.activitiesPublic === true}
              aoMudar={(v) =>
                void salvar({ activitiesPublic: v }, { ...settings, activitiesPublic: v })
              }
            />
            <Chave
              titulo="Mostrar trajeto de GPS"
              descricao="O mapa do percurso mostra por onde você passou — inclusive de onde saiu."
              ligado={settings.routesPublic}
              aoMudar={(v) => void salvar({ routesPublic: v }, { ...settings, routesPublic: v })}
              ultima
            />
          </>
        ) : (
          <Carregando linhas={2} />
        )}
      </Secao>

      <Secao
        titulo="Notificações"
        nota={
          push === "indisponivel"
            ? "Receber no celular só funciona no aplicativo instalado."
            : undefined
        }
      >
        {push !== "indisponivel" ? (
          <Chave
            titulo="Receber neste celular"
            descricao="Permite que o FitSocial avise você mesmo com o app fechado."
            ligado={push === "concedida"}
            aoMudar={(v) => void mexerNoPush(v)}
          />
        ) : null}
        {notif ? (
          <>
            <Chave
              titulo="Novos posts"
              descricao="Quando alguém que você segue publica."
              ligado={notif.novosPosts}
              aoMudar={(v) => salvarNotif(v, "novosPosts")}
            />
            <Chave
              titulo="Interações"
              descricao="Curtidas, comentários e novos seguidores."
              ligado={notif.interacoes}
              aoMudar={(v) => salvarNotif(v, "interacoes")}
            />
            <Chave
              titulo="Desafios"
              descricao="Convites e resultados dos desafios que você participa."
              ligado={notif.desafios}
              aoMudar={(v) => salvarNotif(v, "desafios")}
            />
            <Chave
              titulo="Avisos do app"
              descricao="Novidades e recados importantes."
              ligado={notif.sistema}
              aoMudar={(v) => salvarNotif(v, "sistema")}
              ultima
            />
          </>
        ) : (
          <Carregando linhas={4} />
        )}
      </Secao>

      <Secao titulo="Treino">
        <Linha
          titulo="Vídeos de exercício"
          // Sem escolha ainda, o app pergunta no primeiro toque do play.
          detalhe={plataforma ? NOME_DA_PLATAFORMA[plataforma] : "Perguntar"}
          onPress={() => setTrocandoPlataforma(true)}
          ultima
        />
      </Secao>

      <Secao titulo="Sobre">
        <Linha titulo="Versão" detalhe={app.expo.version} ultima />
      </Secao>

      <EscolherPlataformaSheet
        visivel={trocandoPlataforma}
        atual={plataforma}
        aoFechar={() => setTrocandoPlataforma(false)}
        aoEscolher={(p) => {
          setPlataformaLocal(p);
          void setPlataforma(p);
        }}
      />

      <Pressable onPress={sair} style={styles.sair} accessibilityRole="button">
        <Txt variant="body" color={colors.danger}>
          Sair da conta
        </Txt>
      </Pressable>
    </Screen>
  );
}

// ---- Peças da tela ----

function Secao({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.secao}>
      <Txt variant="label" color={colors.text2} style={styles.secaoTitulo}>
        {titulo}
      </Txt>
      <Card level={2} style={styles.grupo}>
        {children}
      </Card>
      {nota ? (
        <Txt variant="caption" color={colors.text3} style={styles.nota}>
          {nota}
        </Txt>
      ) : null}
    </View>
  );
}

/** Linha de navegação ou de leitura. Sem `onPress`, é só informação. */
function Linha({
  titulo,
  detalhe,
  onPress,
  ultima,
  perigosa,
}: {
  titulo: string;
  detalhe?: string;
  onPress?: () => void;
  ultima?: boolean;
  /** Ação sem volta: sinalizada antes de a pessoa tocar, não depois. */
  perigosa?: boolean;
}) {
  const conteudo = (
    <View style={[styles.linha, ultima ? null : styles.divisoria]}>
      <Txt variant="body" color={perigosa ? colors.danger : colors.text}>
        {titulo}
      </Txt>
      <View style={styles.direita}>
        {detalhe ? (
          <Txt variant="body" color={colors.text2} numberOfLines={1}>
            {detalhe}
          </Txt>
        ) : null}
        {onPress ? (
          <Txt variant="body" color={colors.text3}>
            ›
          </Txt>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return conteudo;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {conteudo}
    </Pressable>
  );
}

function Chave({
  titulo,
  descricao,
  ligado,
  aoMudar,
  ultima,
}: {
  titulo: string;
  descricao: string;
  ligado: boolean;
  aoMudar: (valor: boolean) => void;
  ultima?: boolean;
}) {
  return (
    <View style={[styles.linha, styles.linhaChave, ultima ? null : styles.divisoria]}>
      <View style={styles.textoChave}>
        <Txt variant="body">{titulo}</Txt>
        <Txt variant="caption" color={colors.text3} style={styles.descricao}>
          {descricao}
        </Txt>
      </View>
      <Switch
        value={ligado}
        onValueChange={aoMudar}
        trackColor={{ false: colors.surface3, true: colors.limeDim }}
        thumbColor={ligado ? colors.lime : colors.text3}
        accessibilityLabel={titulo}
      />
    </View>
  );
}

function Carregando({ linhas }: { linhas: number }) {
  return (
    <View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
      {Array.from({ length: linhas }, (_, i) => (
        <Skeleton key={i} height={22} radius={radius.chip} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  secao: { marginBottom: spacing.lg },
  secaoTitulo: { marginBottom: spacing.xs, marginLeft: spacing.xs },
  grupo: { paddingVertical: 0 },
  nota: { marginTop: spacing.xs, marginLeft: spacing.xs },
  linha: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  linhaChave: { alignItems: "flex-start" },
  divisoria: { borderBottomWidth: 1, borderBottomColor: colors.line },
  direita: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  textoChave: { flex: 1, gap: 2 },
  descricao: { lineHeight: 17 },
  sair: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm },
});
