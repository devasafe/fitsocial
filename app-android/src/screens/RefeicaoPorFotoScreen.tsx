// Registrar uma refeição pela foto do prato.
//
// A IA estima; quem decide é a pessoa. Um modelo de visão reconhece "arroz
// branco" e chuta a porção pelo tamanho aparente — ele não pesa o prato, não
// sabe quanto de óleo foi na panela e não enxerga o que está embaixo. Por isso
// nada entra no diário antes de ela olhar.
//
// O que ela corrige aqui é a PORÇÃO, não cinco números soltos: "na verdade comi
// metade disso" é como se pensa sobre comida. Mudar as gramas reescala kcal e
// macros junto, porque a densidade do alimento não muda com o tamanho do prato.

import React, { useMemo, useState } from "react";
import { View, Image, TextInput, TouchableOpacity, Platform } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { analisarFoto, logFood, MEAL_LABEL, type ItemEstimado, type Meal } from "../api/nutrition";
import { Screen, Txt, Button, Card, Chip } from "../components/ui";
import { EsperaLonga, PASSOS } from "../components/Espera";
import { notify } from "../lib/notify";
import { colors, radius, spacing } from "../theme";
import type { AppStackParams } from "../navigation/types";

const MEALS: Meal[] = ["cafe", "almoco", "lanche", "janta"];

function hoje(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function refeicaoDoHorario(): Meal {
  const h = new Date().getHours();
  if (h < 11) return "cafe";
  if (h < 15) return "almoco";
  if (h < 18) return "lanche";
  return "janta";
}

/** Item na tela: guarda a estimativa original para reescalar sem acumular erro. */
interface ItemEditavel extends ItemEstimado {
  chave: string;
  /** Texto do campo de gramas — separado do número para o campo aceitar vazio. */
  gramasTexto: string;
  original: ItemEstimado;
}

function paraEditavel(item: ItemEstimado, i: number): ItemEditavel {
  return {
    ...item,
    chave: `${item.nome}-${i}`,
    gramasTexto: String(Math.round(item.gramas)),
    original: item,
  };
}

/** Reescala a partir da estimativa ORIGINAL, não do valor já reescalado — senão
 *  cada ajuste arrasta o arredondamento do anterior. */
function reescalar(item: ItemEditavel, gramas: number): ItemEditavel {
  const base = item.original;
  const fator = base.gramas > 0 ? gramas / base.gramas : 0;
  const r = (n: number) => Math.round(n * fator * 10) / 10;
  return {
    ...item,
    gramas,
    kcal: Math.round(base.kcal * fator),
    proteinaG: r(base.proteinaG),
    carboG: r(base.carboG),
    gorduraG: r(base.gorduraG),
  };
}

export function RefeicaoPorFotoScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const route = useRoute<RouteProp<AppStackParams, "RefeicaoPorFoto">>();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [meal, setMeal] = useState<Meal>(route.params?.meal ?? refeicaoDoHorario());
  const [foto, setFoto] = useState<string | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [itens, setItens] = useState<ItemEditavel[] | null>(null);
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const total = useMemo(
    () =>
      (itens ?? []).reduce(
        (acc, i) => ({
          kcal: acc.kcal + i.kcal,
          proteina: acc.proteina + i.proteinaG,
          carbo: acc.carbo + i.carboG,
          gordura: acc.gordura + i.gorduraG,
        }),
        { kcal: 0, proteina: 0, carbo: 0, gordura: 0 }
      ),
    [itens]
  );

  async function escolher(daCamera: boolean) {
    const permissao = daCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissao.granted) {
      notify(
        "Permissão necessária",
        daCamera ? "Autorize a câmera para fotografar o prato." : "Autorize o acesso às fotos."
      );
      return;
    }

    const r = daCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (r.canceled) return;

    const asset = r.assets[0];
    setFoto(asset.uri);
    void analisar(asset);
  }

  async function analisar(asset: ImagePicker.ImagePickerAsset) {
    setAnalisando(true);
    setItens(null);
    setObservacao("");
    try {
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(asset.uri)).blob();
        form.append("image", blob, asset.fileName ?? "prato.jpg");
      } else {
        form.append("image", {
          uri: asset.uri,
          name: asset.fileName ?? "prato.jpg",
          type: asset.mimeType ?? "image/jpeg",
        } as unknown as Blob);
      }

      const analise = await analisarFoto(token!, form);
      setItens(analise.itens.map(paraEditavel));
      setObservacao(analise.observacao);
    } catch (err) {
      notify("Não consegui analisar", (err as Error).message);
      setFoto(null);
    } finally {
      setAnalisando(false);
    }
  }

  function mudarGramas(chave: string, texto: string) {
    setItens((atual) =>
      (atual ?? []).map((i) =>
        i.chave === chave
          ? { ...reescalar(i, Number(texto.replace(",", ".")) || 0), gramasTexto: texto }
          : i
      )
    );
  }

  function mudarNome(chave: string, nome: string) {
    setItens((atual) => (atual ?? []).map((i) => (i.chave === chave ? { ...i, nome } : i)));
  }

  function remover(chave: string) {
    setItens((atual) => (atual ?? []).filter((i) => i.chave !== chave));
  }

  async function confirmar() {
    const validos = (itens ?? []).filter((i) => i.nome.trim() && i.kcal > 0);
    if (validos.length === 0) {
      notify("Nada para adicionar", "Ajuste as porções ou registre na mão.");
      return;
    }

    setSalvando(true);
    try {
      // Um registro por alimento, e não um só "almoço": assim a pessoa apaga
      // o arroz sem perder o frango, e o histórico de recentes fica útil.
      for (const i of validos) {
        await logFood(token!, {
          date: hoje(),
          meal,
          name: i.nome.trim(),
          kcal: i.kcal,
          proteinG: i.proteinaG,
          carbsG: i.carboG,
          fatG: i.gorduraG,
          gramas: i.gramas,
          origem: "foto",
        });
      }
      notify("Registrado", `${validos.length} ${validos.length === 1 ? "item" : "itens"} no ${MEAL_LABEL[meal].toLowerCase()}.`);
      nav.goBack();
    } catch (err) {
      notify("Não deu para registrar", (err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Screen scroll underHeader contentStyle={{ gap: spacing.card }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {MEALS.map((m) => (
            <Chip key={m} label={MEAL_LABEL[m]} active={meal === m} onPress={() => setMeal(m)} />
          ))}
        </View>

        {foto ? (
          <Image
            source={{ uri: foto }}
            style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.media, backgroundColor: colors.surface2 }}
          />
        ) : null}

        {!foto && !analisando ? (
          <Card level={2} style={{ gap: spacing.md }}>
            <Txt variant="titleCard">Fotografe o prato</Txt>
            <Txt variant="body" color={colors.text2}>
              A IA identifica os alimentos e estima as porções. Você confere antes de entrar no
              diário — ela olha a foto, não pesa a comida.
            </Txt>
            {Platform.OS !== "web" ? (
              <Button title="Tirar foto" onPress={() => void escolher(true)} size="lg" glow />
            ) : null}
            <Button
              title="Escolher da galeria"
              variant={Platform.OS === "web" ? "primary" : "secondary"}
              onPress={() => void escolher(false)}
            />
          </Card>
        ) : null}

        {analisando ? <EsperaLonga ativo passos={PASSOS.refeicao} /> : null}

        {itens && itens.length === 0 ? (
          <Card level={2} style={{ gap: spacing.sm }}>
            <Txt variant="titleCard">Não reconheci comida aqui</Txt>
            <Txt variant="body" color={colors.text2}>
              {observacao || "Tente uma foto de cima, com o prato inteiro visível."}
            </Txt>
            <Button title="Tentar outra foto" variant="secondary" onPress={() => setFoto(null)} />
          </Card>
        ) : null}

        {itens && itens.length > 0 ? (
          <>
            {observacao ? (
              <Card level={2}>
                <Txt variant="label" color={colors.warning}>
                  Confira
                </Txt>
                <Txt variant="body" color={colors.text2} style={{ marginTop: 2 }}>
                  {observacao}
                </Txt>
              </Card>
            ) : null}

            {itens.map((i) => (
              <Card key={i.chave} level={2} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <TextInput
                    value={i.nome}
                    onChangeText={(t) => mudarNome(i.chave, t)}
                    style={[entrada, { flex: 1 }]}
                    placeholderTextColor={colors.text3}
                  />
                  <TouchableOpacity onPress={() => remover(i.chave)} hitSlop={10}>
                    <Txt variant="titleCard" color={colors.text3}>
                      ✕
                    </Txt>
                  </TouchableOpacity>
                </View>

                <View style={{ gap: spacing.xs }}>
                  <Txt variant="label" color={colors.text2}>
                    Quanto você comeu (g)
                  </Txt>
                  <TextInput
                    value={i.gramasTexto}
                    onChangeText={(t) => mudarGramas(i.chave, t)}
                    keyboardType="numeric"
                    style={entrada}
                    placeholderTextColor={colors.text3}
                  />
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
                  <Txt variant="bodyStrong" tabular>
                    {i.kcal} kcal
                  </Txt>
                  <Txt variant="body" color={colors.text2} tabular>
                    P {i.proteinaG} g
                  </Txt>
                  <Txt variant="body" color={colors.text2} tabular>
                    C {i.carboG} g
                  </Txt>
                  <Txt variant="body" color={colors.text2} tabular>
                    G {i.gorduraG} g
                  </Txt>
                </View>

                {i.confianca !== "alta" ? (
                  <Txt variant="caption" color={colors.warning}>
                    {i.confianca === "baixa"
                      ? "Estimativa incerta — vale conferir a porção."
                      : "Porção estimada de olho."}
                  </Txt>
                ) : null}
              </Card>
            ))}
          </>
        ) : null}
      </Screen>

      {/* Fora da rolagem: a ação principal não pode depender de a pessoa
          descobrir que precisa rolar até o fim da lista. */}
      {itens && itens.length > 0 ? (
        <View
          style={{
            paddingHorizontal: spacing.gutter,
            paddingTop: spacing.md,
            paddingBottom: insets.bottom + spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.bg,
            gap: spacing.sm,
          }}
        >
          <Txt variant="body" color={colors.text2} tabular>
            {total.kcal} kcal · P {Math.round(total.proteina)} g · C {Math.round(total.carbo)} g · G{" "}
            {Math.round(total.gordura)} g
          </Txt>
          <Button
            title={`Adicionar ${itens.length} ${itens.length === 1 ? "item" : "itens"}`}
            onPress={() => void confirmar()}
            loading={salvando}
            size="lg"
            glow
          />
        </View>
      ) : null}
    </View>
  );
}

const entrada = {
  backgroundColor: colors.surface2,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: radius.chip,
  paddingHorizontal: spacing.md,
  paddingVertical: 10,
  color: colors.text,
  fontSize: 16,
} as const;
