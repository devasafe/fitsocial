// Busca de pessoas — 2º vetor de descoberta (além do Explorar). Digita nome/@,
// segue direto da lista ou abre o perfil.
import React, { useEffect, useRef, useState } from "react";
import { View, TextInput, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { searchUsers, type SearchUser } from "../api/social";
import { Txt } from "../components/ui";
import { Avatar } from "../components/Avatar";
import { FollowButton } from "../components/FollowButton";
import { colors, spacing, radius } from "../theme";
import type { AppStackParams } from "../navigation/types";

export function BuscarPessoasScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0);

  // Busca com debounce; ignora respostas fora de ordem via contador de sequência.
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const { users } = await searchUsers(token!, term);
        if (id === seq.current) {
          setResults(users);
          setSearched(true);
        }
      } catch {
        if (id === seq.current) setResults([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, token]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.gutter }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Buscar por nome ou @usuário"
          placeholderTextColor={colors.text3}
          autoCapitalize="none"
          autoFocus
          style={{
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.chip,
            paddingHorizontal: spacing.md,
            paddingVertical: 12,
            color: colors.text,
            fontSize: 16,
          }}
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: spacing.gutter, gap: spacing.sm, paddingBottom: spacing.xl }}
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingTop: spacing.lg, alignItems: "center" }}>
              <ActivityIndicator color={colors.lime} />
            </View>
          ) : (
            <Txt variant="body" color={colors.text2} style={{ textAlign: "center", marginTop: spacing.lg }}>
              {searched ? "Ninguém encontrado. Tente outro nome." : "Busque por nome ou @usuário para encontrar gente."}
            </Txt>
          )
        }
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              padding: spacing.sm,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
            }}
          >
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 }}
              activeOpacity={0.7}
              onPress={() => nav.navigate("UserProfile", { userId: item.id })}
            >
              <Avatar uri={item.avatarUrl} name={item.name} size={40} />
              <View style={{ flex: 1 }}>
                <Txt variant="titleCard">{item.name}</Txt>
                {item.username ? (
                  <Txt variant="caption" color={colors.text3}>
                    @{item.username}
                  </Txt>
                ) : null}
              </View>
            </TouchableOpacity>
            <FollowButton userId={item.id} initialFollowing={item.isFollowing} />
          </View>
        )}
      />
    </View>
  );
}
