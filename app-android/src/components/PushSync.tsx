// Mantém o registro de push vivo e faz o toque na notificação abrir o lugar
// certo. Não desenha nada.
//
// Vive dentro do NavigationContainer de propósito: sem acesso à navegação, um
// push só traria a pessoa para a tela inicial, e ela teria que caçar sozinha o
// comentário que a trouxe até aqui.

import { useEffect, useRef } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { useAuth } from "../context/AuthContext";
import { useContadores } from "../context/ContadoresContext";
import { reconfirmarPush } from "../lib/push";
import { getPost } from "../api/social";
import type { AppStackParams } from "../navigation/types";

type Destino = { tela?: string; postId?: string };

export function PushSync() {
  const { token } = useAuth();
  const { refrescar } = useContadores();
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // O token do Expo muda sozinho (reinstalação, restauro de backup). Um token
  // velho no servidor é push saindo para o nada, então reconfirma a cada
  // abertura de quem já autorizou.
  useEffect(() => {
    if (token) void reconfirmarPush(token);
  }, [token]);

  useEffect(() => {
    const aoTocar = Notifications.addNotificationResponseReceivedListener((resposta) => {
      const dados = (resposta.notification.request.content.data ?? {}) as Destino;
      void abrir(dados);
    });

    // Chegou com o app aberto: o badge precisa acompanhar, senão o número na
    // aba fica atrasado em relação ao aviso que a pessoa acabou de ver.
    const aoReceber = Notifications.addNotificationReceivedListener(() => {
      void refrescar();
    });

    return () => {
      aoTocar.remove();
      aoReceber.remove();
    };

    async function abrir(dados: Destino) {
      const auth = tokenRef.current;
      if (!auth) return;
      if (dados.tela === "post" && dados.postId) {
        try {
          nav.navigate("PostDetail", { post: await getPost(auth, dados.postId) });
        } catch {
          // Apagado entre o envio e o toque. Levar para o Feed é melhor do que
          // abrir uma tela de erro sobre algo que não existe mais.
          nav.navigate("Tabs");
        }
        return;
      }
      nav.navigate("Tabs");
    }
  }, [nav, refrescar]);

  return null;
}
