import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, TouchableOpacity } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Txt, Screen, Card, ErrorState } from "../components/ui";
import { Avatar } from "../components/Avatar";
import { ActivityInteractions } from "../components/ActivityInteractions";
import { RouteMap } from "../components/RouteMap";
import { MenuSheet, type AcaoDoMenu } from "../components/MenuSheet";
import { useAuth } from "../context/AuthContext";
import { getActivity, apagarAtividade, type Activity } from "../api/activities";
import { confirmDialog, notify } from "../lib/notify";
import { colors, spacing, sportColor } from "../theme";
import { DetalheDoTreino } from "../components/crossfit/DetalheDoTreino";
import {
  blocoPrincipal,
  resultadoEmTexto,
  rotuloDaEscala,
} from "../lib/crossfitResumo";
import { sportLabel } from "../lib/sportLabel";
import { clock, type GeoPoint } from "../lib/geo";
import type { AppStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParams, "ActivityDetail">;

interface Payload {
  points?: GeoPoint[];
  splits?: { km: number; timeSec: number }[];
  exercises?: { name: string; sets: { weightKg?: number; reps?: number | null }[] }[];
  name?: string;
  scoreType?: string;
  level?: string;
  resultTimeSec?: number | null;
  resultRounds?: number | null;
  resultReps?: number | null;
  resultLoadKg?: number | null;
  activityName?: string;
  description?: string | null;
  modality?: string;
  sessionType?: string;
  movements?: { name: string; loadKg?: number | null; reps?: number | null; timeSec?: number | null }[];
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * O que a confirmação de apagar diz sobre o post ligado — só o que é
 * verdade, sem número inventado (Tarefa 7, Passo 3).
 *
 * Sem post: nem menciona post. Com post sem interação: diz que ele some
 * junto, sem números. Com interação: nomeia comentários e curtidas — só os
 * que existem, nunca "0 comentários".
 */
function fraseDoPost(post: Activity["post"]): string | null {
  if (!post) return null;
  const { commentCount, likeCount } = post;
  if (commentCount === 0 && likeCount === 0) {
    return "O post deste treino também será apagado.";
  }
  const partes: string[] = [];
  if (commentCount > 0) {
    partes.push(`${commentCount} ${commentCount === 1 ? "comentário" : "comentários"}`);
  }
  if (likeCount > 0) {
    partes.push(`${likeCount} ${likeCount === 1 ? "curtida" : "curtidas"}`);
  }
  return `O post deste treino, com ${partes.join(" e ")}, também será apagado.`;
}

/** Descreve o que acontece — nunca julga (docs/VISAO.md). Nada de "tem
 *  certeza que quer perder seu progresso?": só o fato, e a pessoa decide. */
function mensagemDeApagar(a: Activity): string {
  const doPost = fraseDoPost(a.post ?? null);
  return [doPost, "O treino é apagado de vez — não dá para desfazer."].filter(Boolean).join(" ");
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
      <Txt variant="label" color={colors.text2}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" tabular>
        {value}
      </Txt>
    </View>
  );
}

export function ActivityDetailScreen({ route, navigation }: Props) {
  const { token, user } = useAuth();
  const passed = route.params.activity ?? null;
  const activityId = route.params.activityId;
  const [fetched, setFetched] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(!passed && !!activityId);
  const [error, setError] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [apagando, setApagando] = useState(false);

  useEffect(() => {
    if (passed || !activityId) return;
    let alive = true;
    setLoading(true);
    getActivity(token!, activityId)
      .then((res) => alive && (setFetched(res), setError(false)))
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [passed, activityId, token]);

  const a = passed ?? fetched;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }
  if (error || !a) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", paddingHorizontal: spacing.gutter }}>
        <ErrorState message="Não foi possível abrir este treino." />
      </View>
    );
  }

  const p = (a.payload ?? {}) as Payload;
  const metcon = blocoPrincipal(a.crossfit);
  const m = a.metrics ?? {};
  const stroke = sportColor(a.sportId);
  const when = new Date(a.startedAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Quem pode editar/apagar. `owner` só falta quando a tela recebeu a
  // atividade JÁ PRONTA de uma lista que só mostra as próprias (Minhas
  // Atividades — `listActivities` filtra por dono) — aí não há dúvida.
  // Quando `owner` vem (sempre que buscamos por id), ele é quem decide,
  // mesmo abrindo o PRÓPRIO treino por id.
  // Sem `owner` no objeto, assume-se que o treino é da própria pessoa — e isso
  // SÓ vale porque a única tela que passa a atividade pronta por parâmetro
  // (`MinhasAtividadesScreen`) lista apenas as próprias. Quem chega de fora vem
  // por id e recebe o `owner` do servidor.
  //
  // Acrescentar uma tela que passe atividade de TERCEIRO por parâmetro exige
  // mudar esta linha: o menu de editar/apagar apareceria para quem não pode.
  // O servidor ainda recusa com 404 (nunca 403, para não confirmar que o treino
  // existe), então não há exposição de dado — mas a tela mentiria sobre o que a
  // pessoa pode fazer, que é o tipo de erro que só se descobre usando.
  const souDono = a.owner ? a.owner.id === user?.id : true;

  /**
   * Depois de apagar, esta tela está mostrando um treino que não existe
   * mais — precisa sair. `goBack()` normalmente devolve para a lista de
   * origem, que já se recarrega sozinha ao ganhar foco de novo (Minhas
   * Atividades, Perfil, Feed, Histórico — todas com `useFocusEffect`), então
   * o treino apagado não fica fantasma nelas.
   *
   * Exceção: se a origem foi o DETALHE DE UM POST (abrir o treino a partir
   * do card compartilhado), esse post também acabou de ser apagado junto —
   * voltar para ele mostraria uma publicação que não existe mais. Pula mais
   * uma tela nesse caso.
   */
  // Capturado num `const` à parte: dentro das funções abaixo (declaradas, e
  // por isso hoisted) o TypeScript não confia que `a` continua não-nulo no
  // momento em que forem chamadas — mesmo sabendo, aqui, que é sempre o caso.
  const atividade: Activity = a;

  function voltarAposApagar() {
    const rotas = navigation.getState()?.routes ?? [];
    const anterior = rotas[rotas.length - 2]?.name;
    // pop(2) sai desta tela E do detalhe do post — precisa de mais uma tela
    // abaixo dos dois para pousar nela (na prática, sempre tem: "Tabs" é a
    // raiz da pilha do app).
    if (anterior === "PostDetail" && rotas.length >= 3) {
      navigation.pop(2);
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate("Tabs");
    }
  }

  function apagar() {
    confirmDialog("Apagar este treino?", mensagemDeApagar(atividade), async () => {
      setApagando(true);
      try {
        await apagarAtividade(token!, atividade.id);
        voltarAposApagar();
      } catch (err) {
        notify("Não deu para apagar", (err as Error).message);
      } finally {
        setApagando(false);
      }
    }, "Apagar");
  }

  const acoesDoMenu: AcaoDoMenu[] = souDono
    ? [
        { chave: "editar", rotulo: "Editar treino", aoTocar: () => navigation.navigate("EditarTreino", { activity: atividade }) },
        { chave: "apagar", rotulo: "Apagar treino", perigosa: true, aoTocar: apagar },
      ]
    : [];

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
      {/* Dono do treino (ao ver de outra pessoa) */}
      {a.owner ? (
        <TouchableOpacity
          onPress={() => navigation.navigate("UserProfile", { userId: a.owner!.id })}
          activeOpacity={0.7}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
        >
          <Avatar uri={a.owner.avatarUrl} name={a.owner.name} size={36} />
          <View>
            <Txt variant="bodyStrong">{a.owner.name}</Txt>
            {a.owner.username ? (
              <Txt variant="caption" color={colors.text3}>
                @{a.owner.username}
              </Txt>
            ) : null}
          </View>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: stroke }} />
          <View style={{ flexShrink: 1 }}>
            <Txt variant="titleScreen">{a.title?.trim() || sportLabel(a.sportId)}</Txt>
            <Txt variant="caption" color={colors.text3}>
              {when}
            </Txt>
          </View>
        </View>
        {souDono ? (
          <TouchableOpacity
            onPress={() => setMenuAberto(true)}
            disabled={apagando}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ paddingHorizontal: spacing.sm, paddingVertical: 2 }}
            accessibilityLabel="Opções do treino"
          >
            <Txt variant="titleCard" color={colors.text3}>
              ···
            </Txt>
          </TouchableOpacity>
        ) : null}
      </View>
      <MenuSheet visivel={menuAberto} aoFechar={() => setMenuAberto(false)} acoes={acoesDoMenu} />

      {a.kind === "endurance" && p.points && p.points.length >= 2 ? (
        <RouteMap points={p.points} sportId={a.sportId} height={240} />
      ) : null}

      {/* Métricas por formato */}
      <Card level={2}>
        {a.kind === "endurance" ? (
          <>
            <StatRow label="Distância" value={`${(m.distanceKm ?? 0).toFixed(2)} km`} />
            <StatRow label="Tempo" value={clock(a.durationSec)} />
            <StatRow label="Ritmo médio" value={m.avgPaceSecPerKm ? `${mmss(m.avgPaceSecPerKm)} /km` : "—"} />
            {m.elevationGainM ? <StatRow label="Elevação" value={`${Math.round(m.elevationGainM)} m`} /> : null}
          </>
        ) : a.kind === "strength" ? (
          <>
            <StatRow label="Volume total" value={`${Math.round(m.volumeTotalKg ?? 0)} kg`} />
            <StatRow label="Séries válidas" value={`${m.seriesValidas ?? 0}`} />
            <StatRow label="Duração" value={clock(a.durationSec)} />
          </>
        ) : a.kind === "wod" ? (
          <>
            {/* Vem dos blocos normalizados, não do payload cru: assim o mesmo
                código serve para o formato antigo e para o novo. */}
            {metcon ? (
              <>
                <StatRow label="WOD" value={metcon.nome?.trim() || metcon.modo} />
                <StatRow label="Escala" value={rotuloDaEscala(metcon.escala?.nivel)} />
                {resultadoEmTexto(metcon.resultado) ? (
                  <StatRow
                    label={metcon.resultado?.capado ? "Resultado (no cap)" : "Resultado"}
                    value={resultadoEmTexto(metcon.resultado)}
                  />
                ) : null}
              </>
            ) : null}
            {(m.volumeTotalKg ?? 0) > 0 ? (
              <StatRow label="Volume de força" value={`${Math.round(m.volumeTotalKg as number)} kg`} />
            ) : null}
            {a.durationSec > 0 ? <StatRow label="Duração" value={clock(a.durationSec)} /> : null}
            {a.perceivedEffort ? <StatRow label="Esforço" value={`${a.perceivedEffort}/10`} /> : null}
          </>
        ) : (
          <>
            <StatRow label="Duração" value={`${m.minutes ?? Math.round(a.durationSec / 60)} min`} />
            {p.activityName ? <StatRow label="Atividade" value={p.activityName} /> : null}
            {p.sessionType ? <StatRow label="Tipo" value={p.sessionType} /> : null}
          </>
        )}
      </Card>

      {/* O treino inteiro, bloco a bloco, na ordem em que aconteceu. */}
      {a.kind === "wod" && a.crossfit ? <DetalheDoTreino wod={a.crossfit} /> : null}

      {/* Splits (endurance) */}
      {p.splits && p.splits.length > 0 ? (
        <Card>
          <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
            Parciais por km
          </Txt>
          {p.splits.map((s) => (
            <StatRow key={s.km} label={`Km ${s.km}`} value={mmss(s.timeSec)} />
          ))}
        </Card>
      ) : null}

      {/* Exercícios (strength) */}
      {p.exercises && p.exercises.length > 0 ? (
        <Card>
          <Txt variant="titleCard" style={{ marginBottom: spacing.sm }}>
            Exercícios
          </Txt>
          {p.exercises.map((ex, i) => (
            <View key={i} style={{ paddingVertical: 6 }}>
              <Txt variant="bodyStrong">{ex.name}</Txt>
              <Txt variant="label" color={colors.text2}>
                {ex.sets.map((s) => `${s.weightKg ?? 0}kg×${s.reps ?? 0}`).join("  ·  ")}
              </Txt>
            </View>
          ))}
        </Card>
      ) : null}

      {a.notes ? (
        <Card>
          <Txt variant="body" color={colors.text2}>
            {a.notes}
          </Txt>
        </Card>
      ) : null}

      {/* Curtir / comentar (quando o treino foi compartilhado) */}
      {a.post ? (
        <ActivityInteractions
          postId={a.post.id}
          initialLiked={a.post.likedByMe}
          initialLikeCount={a.post.likeCount}
        />
      ) : null}
    </Screen>
  );
}
