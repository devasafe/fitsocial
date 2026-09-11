import React, { useCallback, useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { useContadores } from "../context/ContadoresContext";
import { Txt, Screen, ErrorState } from "../components/ui";
import { EmptyState } from "../components/EmptyState";
import { Avatar } from "../components/Avatar";
import { notify } from "../lib/notify";
import { listNotifications, markNotificationsRead, type NotificationItem } from "../api/notifications";
import { getPost } from "../api/social";
import { Skeleton } from "../components/Skeleton";
import { colors, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

// Bucket de dia para o cabeçalho de seção (itens já vêm do mais novo ao mais antigo).
function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays <= 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return "Mais antigas";
}

function groupByDay(items: NotificationItem[]): { label: string; items: NotificationItem[] }[] {
  const groups: { label: string; items: NotificationItem[] }[] = [];
  for (const n of items) {
    const label = dayBucket(n.atualizadaEm);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }
  return groups;
}

/** Aviso da plataforma não tem rosto: quem decidiu foi a moderação, não uma pessoa. */
function SeloDoSistema() {
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface3,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Txt variant="body">🛡</Txt>
    </View>
  );
}

export function NotificacoesScreen() {
  const { token } = useAuth();
  const { zerarNotificacoes } = useContadores();
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listNotifications(token!);
      setItems(res.data);
      setError(false);
      // Marca como lidas ao abrir. Aqui abrir É chegar ao conteúdo: a lista
      // inteira está na tela, diferente de uma aba que continua rolando.
      markNotificationsRead(token!)
        .then(zerarNotificacoes)
        .catch(() => {});
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token, zerarNotificacoes]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Toca na notificação → abre o alvo (post / perfil / desafio).
  async function openTarget(n: NotificationItem) {
    if (!n.targetId) return;
    if (n.targetKind === "challenge") {
      nav.navigate("DesafioDetail", { id: n.targetId });
    } else if (n.targetKind === "profile") {
      nav.navigate("UserProfile", { userId: n.targetId });
    } else if (n.targetKind === "post") {
      try {
        const post = await getPost(token!, n.targetId);
        nav.navigate("PostDetail", { post });
      } catch {
        notify("Post indisponível", "Não foi possível abrir esse post.");
      }
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.gutter, paddingTop: spacing.md, gap: spacing.sm }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={64} radius={14} />
        ))}
      </View>
    );
  }

  return (
    <Screen scroll underHeader contentStyle={{ gap: spacing.sm }}>
      {error && items.length === 0 ? (
        <ErrorState message="Não foi possível carregar as notificações." onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="Nada novo por aqui"
          description="Quando alguém curtir, comentar, te seguir ou entrar no seu desafio, aparece aqui."
        />
      ) : (
        groupByDay(items).map((group) => (
          <View key={group.label} style={{ gap: spacing.sm }}>
            <Txt variant="label" color={colors.text3} style={{ marginTop: spacing.sm }}>
              {group.label}
            </Txt>
            {group.items.map((n) => (
              <TouchableOpacity
                key={n.id}
                activeOpacity={n.targetId ? 0.7 : 1}
                disabled={!n.targetId}
                onPress={() => openTarget(n)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                  padding: spacing.md,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: n.read ? colors.surface : colors.limeFaint,
                }}
              >
                {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.lime }} /> : <View style={{ width: 8 }} />}
                {n.actor ? (
                  <Avatar uri={n.actor.avatarUrl} name={n.actor.name} size={36} />
                ) : (
                  <SeloDoSistema />
                )}
                <View style={{ flex: 1 }}>
                  <Txt variant="body">{n.text}</Txt>
                  <Txt variant="caption" color={colors.text3}>
                    {timeAgo(n.atualizadaEm)}
                  </Txt>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}
