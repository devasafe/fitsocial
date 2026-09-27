// Quem seguir.
//
// Existe porque o feed "Seguindo" nasce vazio para todo mundo: o app nunca
// levou ninguém a seguir ninguém. Aparece justamente onde o vazio dói — dentro
// do feed sem posts —, em vez de virar mais uma tela que ninguém abre.
//
// Cada linha traz o MOTIVO ("4 treinos nas últimas semanas"): sem ele é uma
// lista de desconhecidos, e seguir desconhecido sem razão é o que faz a pessoa
// ignorar a seção inteira.
import React, { useCallback, useEffect, useState } from "react";
import { View, TouchableOpacity, Image } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { Txt, Button } from "./ui";
import { getSugestoes, followUser, type Sugestao } from "../api/social";
import { colors, spacing, radius } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function QuemSeguir() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [pessoas, setPessoas] = useState<Sugestao[] | null>(null);
  const [seguindo, setSeguindo] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!token) return;
    // Falha calada: sugestão é convite, não conteúdo. Servidor antigo não tem a
    // rota, e uma seção a menos é melhor que um erro na cara de quem abriu o
    // feed.
    getSugestoes(token)
      .then((r) => setPessoas(r.data))
      .catch(() => setPessoas([]));
  }, [token]);

  const seguir = useCallback(
    async (id: string) => {
      // Otimista: o toque responde na hora. Se falhar, volta — seguir alguém
      // não é operação que mereça travar a tela esperando a rede.
      setSeguindo((s) => ({ ...s, [id]: true }));
      try {
        await followUser(token!, id);
      } catch {
        setSeguindo((s) => ({ ...s, [id]: false }));
      }
    },
    [token]
  );

  if (!pessoas || pessoas.length === 0) return null;

  return (
    <View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
      <Txt variant="titleSection">Quem seguir</Txt>
      <Txt variant="body" color={colors.text2} style={{ marginBottom: spacing.xs }}>
        Gente que está treinando agora.
      </Txt>

      {pessoas.map((p) => (
        <View
          key={p.id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radius.chip,
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <TouchableOpacity
            onPress={() => nav.navigate("UserProfile", { userId: p.id })}
            activeOpacity={0.7}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 }}
          >
            {p.avatarUrl ? (
              <Image
                source={{ uri: p.avatarUrl }}
                style={{ width: 40, height: 40, borderRadius: 20 }}
              />
            ) : (
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: colors.surface3,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Txt variant="bodyStrong" color={colors.text2}>
                  {p.name.slice(0, 1).toUpperCase()}
                </Txt>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {p.name}
              </Txt>
              <Txt variant="caption" color={colors.text3} numberOfLines={1}>
                {p.motivo}
              </Txt>
            </View>
          </TouchableOpacity>

          <Button
            title={seguindo[p.id] ? "Seguindo" : "Seguir"}
            variant={seguindo[p.id] ? "ghost" : "secondary"}
            onPress={() => void seguir(p.id)}
            disabled={seguindo[p.id]}
          />
        </View>
      ))}
    </View>
  );
}
