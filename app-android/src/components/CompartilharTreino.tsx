// Levar o treino para o Instagram (ou para onde a pessoa quiser).
//
// O cartão é montado no servidor com a foto do post, o nome do treino, os
// exercícios, os números e — em corrida e pedal — o traçado do percurso. Aqui
// se escolhe o desenho, se confere o resultado e se escolhe o destino.
//
// A prévia é o cartão DE VERDADE, não um diagrama: a pessoa vai postar isso no
// perfil dela. Custa uma montagem por desenho olhado, e o servidor guarda o que
// já montou — olhar os três e voltar ao primeiro não monta nada de novo.
//
// Duas saídas, porque são dois desejos: Story é o caminho de um toque logo
// depois do treino; a bandeja do sistema cobre o feed do Instagram, o WhatsApp
// e o resto.

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Sheet } from "./Sheet";
import { Txt } from "./ui";
import { EsperaLonga } from "./Espera";
import { notify } from "../lib/notify";
import {
  gerarCartao,
  type FormatoDoCartao,
  type LayoutDoCartao,
} from "../api/social";
import {
  LAYOUTS_ESCOLHIVEIS,
  NOME_DO_LAYOUT,
  COMO_E_O_LAYOUT,
  getLayoutDoCartao,
  setLayoutDoCartao,
  type LayoutEscolhivel,
} from "../lib/layoutDoCartao";
import {
  abrirBandeja,
  abrirStoryDoInstagram,
  temCompartilhamentoNativo,
} from "../lib/compartilhar";
import { useAuth } from "../context/AuthContext";
import { colors, radius, spacing } from "../theme";

/**
 * A prévia é 9:16 como o story, para o recorte ser o que vai sair — e é alta
 * por natureza. Numa tela de 640px de altura, 300px de prévia empurrariam os
 * botões de compartilhar para fora do sheet, que não rola.
 *
 * Então ela toma um terço da tela, entre 150 e 300.
 */
function alturaDaPrevia(alturaDaTela: number): number {
  return Math.round(Math.min(300, Math.max(150, alturaDaTela * 0.34)));
}

export function CompartilharTreino({
  postId,
  temFoto,
  visivel,
  aoFechar,
}: {
  postId: string;
  /** Sem foto o cartão só tem um desenho possível, e escolher não faz sentido. */
  temFoto: boolean;
  visivel: boolean;
  aoFechar: () => void;
}) {
  const { token } = useAuth();
  const [layout, setLayout] = useState<LayoutEscolhivel>("foto");
  const [previa, setPrevia] = useState<string | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [falhouAPrevia, setFalhouAPrevia] = useState(false);
  const [ocupado, setOcupado] = useState<FormatoDoCartao | null>(null);

  // A escolha da vez passada. Quem já escolheu não escolhe de novo.
  useEffect(() => {
    if (!visivel) return;
    let vivo = true;
    void getLayoutDoCartao().then((l) => {
      if (vivo) setLayout(l);
    });
    return () => {
      vivo = false;
    };
  }, [visivel]);

  const montarPrevia = useCallback(
    async (qual: LayoutEscolhivel) => {
      setCarregandoPrevia(true);
      setFalhouAPrevia(false);
      try {
        const { url } = await gerarCartao(
          token!,
          postId,
          "story",
          qual as LayoutDoCartao,
        );
        setPrevia(url);
      } catch {
        // Sem prévia ainda dá para compartilhar: o botão monta o cartão de novo
        // e mostra o erro de verdade se ele voltar.
        setFalhouAPrevia(true);
        setPrevia(null);
      } finally {
        setCarregandoPrevia(false);
      }
    },
    [postId, token],
  );

  useEffect(() => {
    if (!visivel || ocupado) return;
    void montarPrevia(layout);
  }, [visivel, layout, montarPrevia]); // `ocupado` de fora: não remontar ao compartilhar

  function escolher(qual: LayoutEscolhivel) {
    if (qual === layout) return;
    setLayout(qual);
    void setLayoutDoCartao(qual);
  }

  async function compartilhar(formato: FormatoDoCartao, paraStory: boolean) {
    if (ocupado) return;
    setOcupado(formato);
    try {
      const { url } = await gerarCartao(
        token!,
        postId,
        formato,
        layout as LayoutDoCartao,
      );

      // Story primeiro; se o Instagram não estiver instalado, a bandeja
      // resolve em vez de a pessoa tocar e nada acontecer.
      const foi = paraStory ? await abrirStoryDoInstagram(url) : false;
      if (!foi) await abrirBandeja(url);

      aoFechar();
    } catch (err) {
      notify("Não deu para compartilhar", (err as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Sheet visivel={visivel} aoFechar={aoFechar}>
      {/* O Sheet nao tem margem lateral de proposito — cada folha decide a
          sua. Sem isto a borda do primeiro e do ultimo chip fica cortada
          contra a lateral da tela. */}
      <View style={{ paddingHorizontal: spacing.gutter }}>
        <Txt variant="titleSection">Compartilhar treino</Txt>

        {ocupado ? (
          <View style={{ marginTop: spacing.md }}>
            <EsperaLonga ativo passos={["Montando seu cartão…"]} />
          </View>
        ) : (
          <>
            {temFoto ? (
              <>
                <Txt
                  variant="body"
                  color={colors.text2}
                  style={{ marginTop: 4, marginBottom: spacing.md }}
                >
                  Escolha o desenho. Fica guardado para a próxima.
                </Txt>
                <View
                  style={{
                    flexDirection: "row",
                    gap: spacing.sm,
                    marginBottom: spacing.md,
                  }}
                >
                  {LAYOUTS_ESCOLHIVEIS.map((l) => (
                    <Chip
                      key={l}
                      rotulo={NOME_DO_LAYOUT[l]}
                      ativo={l === layout}
                      aoTocar={() => escolher(l)}
                    />
                  ))}
                </View>
              </>
            ) : (
              <Txt
                variant="body"
                color={colors.text2}
                style={{ marginTop: 4, marginBottom: spacing.md }}
              >
                Este post não tem foto, então o cartão sai só com os números.
              </Txt>
            )}

            <Previa
              url={previa}
              carregando={carregandoPrevia}
              falhou={falhouAPrevia}
            />

            {temFoto ? (
              <Txt
                variant="caption"
                color={colors.text3}
                style={{ textAlign: "center", marginTop: spacing.sm }}
              >
                {COMO_E_O_LAYOUT[layout]}
              </Txt>
            ) : null}

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {temCompartilhamentoNativo ? (
                <Opcao
                  titulo="Story do Instagram"
                  descricao="Abre o Instagram com a imagem pronta"
                  aoTocar={() => void compartilhar("story", true)}
                />
              ) : null}
              <Opcao
                titulo={
                  temCompartilhamentoNativo ? "Outro app" : "Baixar a imagem"
                }
                descricao={
                  temCompartilhamentoNativo
                    ? "Feed do Instagram, WhatsApp, o que você preferir"
                    : "No navegador o Instagram não recebe imagem por link"
                }
                aoTocar={() => void compartilhar("feed", false)}
              />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

/** A prévia, sempre no mesmo lugar e do mesmo tamanho: se a caixa mudasse de
 *  altura entre carregar e mostrar, a lista de botões pularia debaixo do dedo. */
function Previa({
  url,
  carregando,
  falhou,
}: {
  url: string | null;
  carregando: boolean;
  falhou: boolean;
}) {
  const altura = alturaDaPrevia(useWindowDimensions().height);

  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          width: Math.round((altura * 9) / 16),
          height: altura,
          borderRadius: radius.media,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {url ? (
          <Image
            source={{ uri: url }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : falhou ? (
          <Txt
            variant="caption"
            color={colors.text3}
            style={{ textAlign: "center", paddingHorizontal: spacing.md }}
          >
            Não deu para montar a prévia. Dá para compartilhar mesmo assim.
          </Txt>
        ) : null}

        {/* Sobre a prévia antiga enquanto a nova vem: trocar de desenho não
            apaga o que já estava na tela. */}
        {carregando ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(14,19,16,0.72)",
            }}
          >
            <ActivityIndicator color={colors.lime} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Opcao({
  titulo,
  descricao,
  aoTocar,
}: {
  titulo: string;
  descricao: string;
  aoTocar: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={aoTocar}
      activeOpacity={0.8}
      style={{
        backgroundColor: colors.surface2,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        // Alvo confortável: isto é tocado com o celular na mão, depois do treino.
        minHeight: 64,
        justifyContent: "center",
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.s12,
      }}
    >
      <Txt variant="titleCard">{titulo}</Txt>
      <Txt variant="caption" color={colors.text2} style={{ marginTop: 2 }}>
        {descricao}
      </Txt>
    </TouchableOpacity>
  );
}

function Chip({
  rotulo,
  ativo,
  aoTocar,
}: {
  rotulo: string;
  ativo: boolean;
  aoTocar: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={aoTocar}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: ativo }}
      style={{
        flexGrow: 1,
        flexShrink: 1,
        // Sem base zero: `flex: 1` em três chips espreme o rótulo mais longo
        // até ele quebrar no meio da palavra.
        flexBasis: "auto",
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.sm,
        borderRadius: radius.media,
        borderWidth: 1,
        borderColor: ativo ? colors.lime : colors.line,
        backgroundColor: ativo ? colors.limeSoft : colors.surface,
      }}
    >
      <Txt variant="label" color={ativo ? colors.lime : colors.text2}>
        {rotulo}
      </Txt>
    </TouchableOpacity>
  );
}
