import React, { useCallback, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { Txt, Screen, Card } from "../components/ui";
import { Avatar } from "../components/Avatar";
import { listNotifications, markNotificationsRead, type NotificationItem } from "../api/notifications";
import { colors, spacing } from "../theme";

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

export function NotificacoesScreen() {
  const { token } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const res = await listNotifications(token!);
          if (alive) setItems(res.data);
          // Marca como lidas ao abrir (limpa o contador na Home).
          markNotificationsRead(token!).catch(() => {});
        } catch {
          if (alive) setItems([]);
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [token])
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  return (
    <Screen scroll contentStyle={{ gap: spacing.sm }}>
      {items.length === 0 ? (
        <Card level={2} style={{ marginTop: spacing.md }}>
          <Txt variant="titleCard">Nada novo por aqui</Txt>
          <Txt variant="body" color={colors.text2} style={{ marginTop: spacing.sm }}>
            Quando alguém curtir, comentar, te seguir ou entrar no seu desafio, aparece aqui.
          </Txt>
        </Card>
      ) : (
        items.map((n) => (
          <View
            key={n.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: n.read ? colors.surface : "rgba(200,250,75,0.06)",
            }}
          >
            {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.lime }} /> : <View style={{ width: 8 }} />}
            <Avatar name={n.actor.name} size={36} />
            <View style={{ flex: 1 }}>
              <Txt variant="body">{n.text}</Txt>
              <Txt variant="caption" color={colors.text3}>
                {timeAgo(n.createdAt)}
              </Txt>
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}
