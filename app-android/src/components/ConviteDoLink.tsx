import { useEffect } from "react";
import { Linking } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { codigoDoLink, guardarConvite, lerConvitePendente } from "../lib/convitePendente";
import type { AppStackParams } from "../navigation/types";

/**
 * O link de convite, de onde quer que ele venha.
 *
 * Duas metades, e as duas são necessárias:
 *
 * 1. Guardar o código assim que a URL chega — inclusive quando ainda não há
 *    conta. O caso principal do link é o aluno que nunca ouviu falar do app:
 *    ele abre, cai no cadastro, e o convite se perderia no caminho, deixando a
 *    pessoa dentro de um aplicativo sem saber por que instalou.
 *
 * 2. Consumir o código guardado quando a pessoa finalmente chega — depois do
 *    registro, do nome de usuário e do onboarding.
 *
 * Fica num componente, e não numa configuração de `linking`, porque o
 * NavigationContainer trocaria de árvore no meio do cadastro e mapear todas as
 * rotas do app para URLs seria um preço alto por uma única rota profunda.
 */
export function ConviteDoLink({ ativo }: { ativo: boolean }) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();

  // Metade 1: toda URL que chega, a qualquer momento.
  useEffect(() => {
    let vivo = true;

    const tratar = (url: string | null) => {
      if (!url || !vivo) return;
      const code = codigoDoLink(url);
      if (code) void guardarConvite(code);
    };

    void Linking.getInitialURL().then(tratar);
    const sub = Linking.addEventListener("url", (e) => tratar(e.url));
    return () => {
      vivo = false;
      sub.remove();
    };
  }, []);

  // Metade 2: só quando a pessoa já pode ver a tela de aceite.
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;

    void lerConvitePendente().then((code) => {
      // Quem limpa é a tela de aceite, ao aceitar ou ao recusar: limpar aqui
      // faria o convite sumir se o app fosse fechado antes de responder.
      if (vivo && code) nav.navigate("AceitarConvite", { code });
    });

    return () => {
      vivo = false;
    };
  }, [ativo, nav]);

  return null;
}
