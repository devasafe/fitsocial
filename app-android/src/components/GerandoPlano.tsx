// A tela de gerar o plano.
//
// É o momento mais importante do app — o primeiro plano — e a espera mais longa
// dele, uns trinta segundos. Spinner aqui desperdiça o único instante em que a
// pessoa está parada, olhando, esperando algo que ela pediu.
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

/** Quanto cada comando fica na tela. */
const PASSO_MS = 6500;
const REVELACAO_MS = 460;
const ASSENTAR_MS = 440;

export interface Origem {
  x: number;
  y: number;
}

export function GerandoPlano({
  visivel,
  origem,
  passos,
}: {
  visivel: boolean;
  /** Onde o dedo tocou. Sem isso, nasce do centro. */
  origem?: Origem | null;
  passos: readonly string[];
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
    Animated.timing(saida, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setMontado(false));
  }, [visivel, semMovimento, revelar, assentar, halo, texto, saida, montado]);

  // ---- Comandos descendo ----
  useEffect(() => {
    if (!visivel) return;
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
    }, PASSO_MS);
    return () => clearInterval(t);
  }, [visivel, passos.length, texto]);

  if (!montado) return null;

  const ultimo = passo === passos.length - 1;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
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
