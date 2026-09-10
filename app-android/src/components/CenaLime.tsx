// A cena: a gota lime que toma a tela nos momentos que importam.
//
// Nasceu para a geração do plano — o instante mais importante do app e a espera
// mais longa dele, uns trinta segundos. Spinner ali desperdiça o único momento
// em que a pessoa está parada, olhando, esperando algo que ela mesma pediu.
//
// Serve também para começar um treino e para publicar. Mas o TEMPO muda, e isso
// não é detalhe: a cena existe para preencher espera, não para criar espera. Em
// ação rápida ela é passagem (uma frase, some sozinha); em ação longa ela é
// companhia (comandos que avançam enquanto dura). Usar a versão longa numa ação
// instantânea transformaria velocidade em lentidão.
//
// A gota nasce EXATAMENTE onde o dedo tocou e cresce até tomar a tela. Isso não
// é enfeite: amarra o efeito à causa. Você tocou ali, e o mundo cresceu daquele
// ponto.
//
// O lime dura meio segundo e assenta.
//
//   0 ─── 460ms ────────── 900ms ──────────────── fim
//   gota   tela toda        assenta no verde-tinta  comandos
//   nasce  vira LIME        com halo lime           descendo
//
// Tela inteira de #C8FA4B por trinta segundos, à noite, depois do treino, é um
// flash na cara — e briga com a identidade, que usa lime como acento, não como
// fundo. Flash é um instante; se durar, vira desconforto. É o mesmo motivo de
// gastar a ousadia num lugar só: esta é A cena do app, e todo o resto fica
// quieto.

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  View,
  useWindowDimensions,
  AccessibilityInfo,
  Easing,
  StyleSheet,
} from "react-native";
import { Txt } from "./ui";
import { colors, spacing } from "../theme";

/** Quanto cada comando fica na tela, quando há mais de um. */
const PASSO_MS_PADRAO = 6500;
const REVELACAO_MS = 460;
const ASSENTAR_MS = 440;

export interface Origem {
  x: number;
  y: number;
}

export function CenaLime({
  visivel,
  origem,
  passos,
  passoMs = PASSO_MS_PADRAO,
  aoPedirSaida,
}: {
  visivel: boolean;
  /** Onde o dedo tocou. Sem isso, nasce do centro. */
  origem?: Origem | null;
  /** Uma frase só = passagem. Várias = companhia numa espera longa. */
  passos: readonly string[];
  passoMs?: number;
  /** Voltar durante a cena. Sem isso o Modal engole o botão no Android. */
  aoPedirSaida?: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [montado, setMontado] = useState(false);
  const [passo, setPasso] = useState(0);
  const [semMovimento, setSemMovimento] = useState(false);

  const revelar = useRef(new Animated.Value(0)).current;
  const assentar = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const texto = useRef(new Animated.Value(0)).current;
  const saida = useRef(new Animated.Value(1)).current;
  const animacaoDeSaida = useRef<Animated.CompositeAnimation | null>(null);

  // O raio que cobre a tela a partir de um ponto qualquer é a distância até o
  // canto mais distante. Sem isso, tocar perto da borda deixaria um canto sem
  // pintar.
  const cx = origem?.x ?? width / 2;
  const cy = origem?.y ?? height / 2;
  const raio = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(width - cx, cy),
    Math.hypot(cx, height - cy),
    Math.hypot(width - cx, height - cy)
  );

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setSemMovimento)
      .catch(() => setSemMovimento(false));
  }, []);

  // ---- Entrada e saída ----
  useEffect(() => {
    if (visivel) {
      setMontado(true);
      setPasso(0);
      // Reabrir dentro dos 300ms da saída: sem parar a animação em curso, o
      // callback dela ainda desmonta o Modal que acabou de reabrir, e a cena
      // pisca.
      animacaoDeSaida.current?.stop();
      animacaoDeSaida.current = null;
      saida.setValue(1);

      if (semMovimento) {
        // Quem pediu menos movimento recebe o resultado, não a jornada.
        revelar.setValue(1);
        assentar.setValue(1);
        texto.setValue(1);
        return;
      }

      revelar.setValue(0);
      assentar.setValue(0);
      texto.setValue(0);

      Animated.sequence([
        Animated.timing(revelar, {
          toValue: 1,
          duration: REVELACAO_MS,
          // Sai rápido e freia no fim: é o que faz parecer que a tinta tem
          // peso, em vez de um retângulo trocando de cor.
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(assentar, {
          toValue: 1,
          duration: ASSENTAR_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.timing(texto, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }).start();
      });

      // O halo respira devagar: é o "ainda estou trabalhando" sem spinner.
      const respiro = Animated.loop(
        Animated.sequence([
          Animated.timing(halo, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(halo, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      );
      respiro.start();
      return () => respiro.stop();
    }

    if (!montado) return;
    const fim = Animated.timing(saida, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    });
    animacaoDeSaida.current = fim;
    fim.start(({ finished }) => {
      if (finished) setMontado(false);
    });
  }, [visivel, semMovimento, revelar, assentar, halo, texto, saida, montado]);

  // ---- Comandos descendo ----
  useEffect(() => {
    // Passagem tem uma frase só: não há o que avançar.
    if (!visivel || passos.length < 2) return;
    const t = setInterval(() => {
      setPasso((i) => {
        // Trava no último: voltar ao primeiro faria parecer que recomeçou.
        if (i >= passos.length - 1) return i;
        // Sai por baixo, o próximo entra por cima.
        Animated.sequence([
          Animated.timing(texto, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(texto, { toValue: 1, duration: 320, useNativeDriver: true }),
        ]).start();
        return i + 1;
      });
    }, passoMs);
    return () => clearInterval(t);
  }, [visivel, passos.length, passoMs, texto]);

  if (!montado) return null;

  // Frase única é sempre destaque: ela É a mensagem, não uma etapa.
  const ultimo = passo === passos.length - 1;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={aoPedirSaida}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: saida }]}>
        {/* A gota */}
        <Animated.View
          style={{
            position: "absolute",
            left: cx - raio,
            top: cy - raio,
            width: raio * 2,
            height: raio * 2,
            borderRadius: raio,
            backgroundColor: colors.lime,
            transform: [{ scale: revelar }],
          }}
        />

        {/* O verde-tinta que assenta por cima do lime */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: assentar }]}
        />

        {/* Halo: o lime que sobra, respirando devagar */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: width / 2 - raio * 0.55,
            top: height / 2 - raio * 0.55,
            width: raio * 1.1,
            height: raio * 1.1,
            borderRadius: raio,
            backgroundColor: colors.lime,
            opacity: Animated.multiply(
              assentar,
              halo.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.11] })
            ),
            transform: [
              { scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) },
            ],
          }}
        />

        {/* Os comandos */}
        <View style={styles.centro}>
          <Animated.View
            style={{
              opacity: texto,
              transform: [
                {
                  translateY: texto.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-14, 0],
                  }),
                },
              ],
            }}
          >
            <Txt
              variant={ultimo ? "titleScreen" : "titleSection"}
              color={ultimo ? colors.lime : colors.text}
              style={styles.comando}
            >
              {passos[passo] ?? passos[0]}
            </Txt>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  centro: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  comando: { textAlign: "center" },
});
