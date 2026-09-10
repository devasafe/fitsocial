import React, { useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { notify } from "../lib/notify";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../context/AuthContext";
import { createPost } from "../api/social";
import { uploadImage } from "../api/uploads";
import type { Activity } from "../api/activities";
import { Button, Txt } from "../components/ui";
import { PASSOS } from "../components/Espera";
import { useCena, COBERTURA_MS, esperar } from "../components/CenaContext";
import { sportLabel } from "../lib/sportLabel";
import { legendaSugerida } from "../lib/crossfitResumo";
import { colors, radius, spacing, sportColor, type as typeScale } from "../theme";
import type { AppStackParams } from "../navigation/types";

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
// Prévia enxuta do treino anexado no compositor.
function workoutTitle(a: Activity): string {
  const pl = (a.payload ?? {}) as { name?: string; activityName?: string };
  if (a.kind === "wod" && pl.name) return pl.name;
  if (a.kind === "generic" && pl.activityName) return pl.activityName;
  return a.title?.trim() || sportLabel(a.sportId);
}
function workoutStats(a: Activity): string[] {
  const m = a.metrics ?? {};
  const out: string[] = [];
  if (a.kind === "strength" && m.volumeTotalKg) out.push(`${Math.round(m.volumeTotalKg)} kg`);
  if (a.kind === "endurance" && m.distanceKm) out.push(`${Math.round(m.distanceKm * 100) / 100} km`);
  if (a.durationSec) out.push(mmss(a.durationSec));
  return out;
}

export function CreatePostScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const route = useRoute<RouteProp<AppStackParams, "CreatePost">>();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const cena = useCena();
  const fromWorkout = route.params?.activity; // veio de um treino finalizado
  const [attached, setAttached] = useState<Activity | null>(fromWorkout ?? null);
  // O texto de um treino de CrossFit já vem pronto — e editável. Escrever do
  // zero "Fran, 5:32, RX, Back Squat 100 kg" logo depois de treinar é o tipo de
  // trabalho que o app tem os dados para poupar.
  const [text, setText] = useState(
    fromWorkout?.crossfit ? legendaSugerida(fromWorkout.crossfit, fromWorkout.perceivedEffort) : ""
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const canPost = !!(text.trim() || imageUrl || attached);

  function done() {
    // Veio do fluxo de treino → volta pra navegação principal; senão volta atrás.
    if (fromWorkout) nav.navigate("Tabs");
    else nav.goBack();
  }

  async function pickImage() {
    // Em nativo, pede permissão da galeria (no web não é necessário).
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        notify("Permissão necessária", "Autorize o acesso às fotos para adicionar uma imagem.");
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const form = new FormData();
      if (Platform.OS === "web") {
        // No web, o uri é blob/data URL: converte para blob antes de enviar.
        const blob = await (await fetch(asset.uri)).blob();
        form.append("image", blob, asset.fileName ?? "foto.jpg");
      } else {
        form.append("image", {
          uri: asset.uri,
          name: asset.fileName ?? "foto.jpg",
          type: asset.mimeType ?? "image/jpeg",
        } as unknown as Blob);
      }
      const { url } = await uploadImage(token!, form);
      setImageUrl(url);
    } catch (err) {
      notify("Não foi possível enviar a foto", (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handlePost(evento?: { nativeEvent: { pageX: number; pageY: number } }) {
    if (!canPost) return;
    setSaving(true);
    cena.abrir({
      passos: PASSOS.publicando,
      origem: evento
        ? { x: evento.nativeEvent.pageX, y: evento.nativeEvent.pageY }
        : null,
    });

    try {
      // O mínimo de espera é da CENA, não da rede: se o post voltar em 200ms,
      // a troca de tela aconteceria com a gota ainda crescendo e a pessoa veria
      // o compositor sumir por baixo dela.
      const [{ post }] = await Promise.all([
        createPost(token!, {
          text: text.trim() || undefined,
          imageUrl: imageUrl ?? undefined,
          activityId: attached?.id,
        }),
        esperar(COBERTURA_MS),
      ]);

      // Publicar termina VENDO o que foi publicado.
      //
      // reset em vez de empilhar: voltar do post tem que levar para a navegação
      // principal. Empilhando, o botão voltar traria de volta o compositor com
      // o texto que acabou de virar post — e um segundo "Publicar" ali criaria
      // uma publicação duplicada.
      nav.reset({
        index: 1,
        routes: [{ name: "Tabs" }, { name: "PostDetail", params: { post } }],
      });

      // O post monta por baixo do lime; só então o verde abre nele.
      await esperar(360);
      cena.fechar();
    } catch (err) {
      cena.fechar();
      notify("Não foi possível postar", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.rolagem}
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        <Txt variant="titleScreen" style={styles.title}>
          {attached ? "Compartilhar treino" : "Compartilhe sua evolução"}
        </Txt>

        {/* Treino anexado (quando veio de um registro) — pode remover */}
        {attached ? (
          <View style={styles.workoutCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sportColor(attached.sportId) }} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{workoutTitle(attached)}</Txt>
                {workoutStats(attached).length ? (
                  <Txt variant="caption" color={colors.text2} tabular>
                    {workoutStats(attached).join(" · ")}
                  </Txt>
                ) : null}
              </View>
            </View>
            <TouchableOpacity onPress={() => setAttached(null)} hitSlop={8}>
              <Txt variant="label" color={colors.text3}>
                Remover
              </Txt>
            </TouchableOpacity>
          </View>
        ) : null}

        <Txt variant="label" color={colors.text2} style={styles.label}>
          {attached ? "Escreva algo (opcional)" : "O que você quer compartilhar?"}
        </Txt>
        <TextInput
          style={styles.textArea}
          value={text}
          onChangeText={setText}
          placeholder="Conte como foi o treino, como se sentiu… (opcional)"
          placeholderTextColor={colors.text3}
          multiline
          autoFocus={!attached}
        />

        {imageUrl ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: imageUrl }} style={styles.preview} />
            <TouchableOpacity style={styles.removeBtn} onPress={() => setImageUrl(null)} activeOpacity={0.7}>
              <Txt variant="bodyStrong" color={colors.danger}>
                Remover foto
              </Txt>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.pickBtn} onPress={pickImage} disabled={uploading} activeOpacity={0.7}>
            {uploading ? (
              <ActivityIndicator color={colors.lime} />
            ) : (
              <Txt variant="bodyStrong" color={colors.text2}>
                Adicionar foto
              </Txt>
            )}
          </TouchableOpacity>
        )}

      </ScrollView>

      {/* O botão vive FORA da rolagem, colado no rodapé. Dentro dela, ele
          desceria junto com a prévia da foto e sumiria da tela — que era
          exatamente o problema. A ação principal não pode depender de a
          pessoa descobrir que precisa rolar. */}
      <View style={[styles.rodape, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          title="Publicar"
          size="lg"
          onPress={(e) => handlePost(e)}
          loading={saving}
          disabled={!canPost || uploading}
          glow
        />
        {fromWorkout ? (
          <TouchableOpacity onPress={done} activeOpacity={0.7} style={styles.agoraNao}>
            <Txt variant="label" color={colors.text2}>
              Agora não
            </Txt>
          </TouchableOpacity>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  rolagem: { flex: 1 },
  // `flexGrow` e não `flex`: o conteúdo ocupa a tela quando é curto e cresce
  // livremente quando é longo. Com `flex: 1` ele seria espremido na altura da
  // tela, que é o que fazia o conteúdo transbordar sem rolar.
  inner: { flexGrow: 1, padding: spacing.gutter },
  title: { marginTop: spacing.sm, marginBottom: spacing.lg },
  workoutCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  label: { marginBottom: spacing.sm },
  textArea: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: spacing.md,
    color: colors.text,
    fontFamily: typeScale.body.fontFamily,
    fontSize: 16,
    minHeight: 140,
    textAlignVertical: "top",
  },
  pickBtn: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderStyle: "dashed",
    borderRadius: radius.card,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  previewWrap: { marginTop: spacing.md },
  preview: { width: "100%", height: 260, borderRadius: radius.media, backgroundColor: colors.surface2 },
  removeBtn: { alignSelf: "center", paddingVertical: spacing.s12 },
  rodape: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  agoraNao: { paddingVertical: spacing.md, alignItems: "center" },
});
