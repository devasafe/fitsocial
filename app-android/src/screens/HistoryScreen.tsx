import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, TouchableOpacity, useWindowDimensions } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AppStackParams } from "../navigation/types";
import { useAuth } from "../context/AuthContext";
import {
  JANELAS,
  METRICAS,
  METRICAS_CARDIO,
  formatarCardio,
  listarCardio,
  listarExercicios,
  listarGrupos,
  rotuloDaJanela,
  rotuloDaMetrica,
  rotuloDaMetricaCardio,
  serieDeCardio,
  serieDoExercicio,
  type EsporteNaLista,
  type ExercicioNaLista,
  type GrupoTreinado,
  type Janela,
  type JanelaAplicada,
  type Metrica,
  type MetricaCardio,
  type PontoDoExercicio,
} from "../api/evolucao";
import { LineChart } from "../components/LineChart";
import { RadarChart } from "../components/RadarChart";
import { Txt, Card, Chip, SectionHeader, ErrorState } from "../components/ui";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import { abreviarMusculo } from "../lib/musculos";
import { colors, spacing } from "../theme";

/** Número curto: 3.240 vira "3,2 mil" para não estourar o eixo. */
function curto(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(".", ",")} mil`;
  return String(v % 1 ? Math.round(v * 10) / 10 : v).replace(".", ",");
}

function formatarValor(v: number, metrica: Metrica): string {
  switch (metrica) {
    case "carga_max":
    case "rm_estimado":
      return `${curto(v)}kg`;
    case "volume":
      return `${curto(v)}kg`;
    default:
      return curto(v);
  }
}

export function HistoryScreen({ embedded }: { embedded?: boolean } = {}) {
  const nav = useNavigation<NativeStackNavigationProp<AppStackParams>>();
  const { token } = useAuth();
  const { width } = useWindowDimensions();

  const [mode, setMode] = useState<"strength" | "cardio">("strength");
  const [janela, setJanela] = useState<Janela>(90);
  /** O que o servidor DEIXOU ver. No grátis, sete dias — e a tela precisa
   *  dizer isso, senão afirma "1 ano" sobre uma semana de dado. */
  const [janelaAplicada, setJanelaAplicada] = useState<JanelaAplicada | null>(null);

  const [exercicios, setExercicios] = useState<ExercicioNaLista[]>([]);
  const [grupos, setGrupos] = useState<GrupoTreinado[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [metrica, setMetrica] = useState<Metrica>("carga_max");
  const [serie, setSerie] = useState<PontoDoExercicio[]>([]);
  const [carregandoSerie, setCarregandoSerie] = useState(false);

  const [cardio, setCardio] = useState<EsporteNaLista[]>([]);
  const [cardioSel, setCardioSel] = useState<string | null>(null);
  const [metricaCardio, setMetricaCardio] = useState<MetricaCardio>("pace");
  /**
   * Os pontos e o `menorEhMelhor` vêm da MESMA resposta e moram no mesmo
   * estado: em dois `useState` separados, um `.catch` que atualizasse só um
   * deixaria a inversão do eixo valendo para a métrica anterior.
   */
  const [curvaCardio, setCurvaCardio] = useState<{
    pontos: PontoDoExercicio[];
    menorEhMelhor: boolean;
  }>({ pontos: [], menorEhMelhor: false });
  const [carregandoCardio, setCarregandoCardio] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  /**
   * Erros separados por modo, e separados de "não tem nada".
   *
   * Uma falha de rede caindo no estado vazio faz a tela AFIRMAR sobre a vida da
   * pessoa: "nenhuma corrida nesta janela" para quem correu ontem. E um erro
   * compartilhado entre os modos derrubava a aba de cardio por causa de uma
   * falha na musculação, com os dados de cardio já carregados na memória.
   */
  const [erroCardio, setErroCardio] = useState(false);
  const [erroSerie, setErroSerie] = useState(false);
  const [erroSerieCardio, setErroSerieCardio] = useState(false);

  // O slug numa ref para o `load` poder compará-lo sem virar dependência —
  // entrar na lista de deps recriaria o `load` a cada troca de exercício e
  // recarregaria a tela inteira por nada.
  const slugAtual = useRef<string | null>(null);
  slugAtual.current = slug;

  const esporteAtualRef = useRef<string | null>(null);
  esporteAtualRef.current = cardioSel;

  const load = useCallback(async () => {
    // Separados: uma aba não pode apagar a outra. Buscar musculação e cardio
    // com `Promise.all` fazia o cardio falhando esvaziar a musculação inteira.
    const [forca, cardioRes] = await Promise.allSettled([
      Promise.all([listarExercicios(token!, janela), listarGrupos(token!, janela)]),
      listarCardio(token!, janela),
    ]);

    if (forca.status === "fulfilled") {
      const [forcaRes, gruposDaJanela] = forca.value;
      const lista = forcaRes.itens;
      setJanelaAplicada(forcaRes.janela);
      setExercicios(lista);
      setGrupos(gruposDaJanela);
      // Mantém o exercício escolhido quando ele continua existindo na janela
      // nova — trocar de janela não deveria trocar o assunto da tela.
      const escolhido =
        slugAtual.current && lista.some((e) => e.slug === slugAtual.current)
          ? slugAtual.current
          : (lista[0]?.slug ?? null);
      // Se o exercício vai mudar, o gráfico já entra em carregamento aqui:
      // senão o cabeçalho mostraria o exercício novo por alguns quadros com a
      // curva do anterior desenhada embaixo.
      if (escolhido !== slugAtual.current) setCarregandoSerie(true);
      setSlug(escolhido);
    }

    if (cardioRes.status === "fulfilled") {
      const esportes = cardioRes.value.itens;
      // Também daqui: se a busca da força falhar, o aviso do corte não pode
      // sumir junto — o rodapé voltaria a dizer "1 ano" sobre sete dias.
      setJanelaAplicada(cardioRes.value.janela);
      setCardio(esportes);
      // Mantém o esporte escolhido quando ele continua existindo na janela
      // nova — a mesma regra da musculação, e pelo mesmo motivo.
      const escolhido =
        esporteAtualRef.current && esportes.some((e) => e.sportId === esporteAtualRef.current)
          ? esporteAtualRef.current
          : (esportes[0]?.sportId ?? null);
      // Mesmo cuidado do slug: sem isto, o card mostraria o nome e a distância
      // do esporte novo com a curva do anterior ainda desenhada embaixo.
      if (escolhido !== esporteAtualRef.current) setCarregandoCardio(true);
      setCardioSel(escolhido);
    } else {
      // A lista da janela ANTERIOR não pode ficar na tela: o chip diria "30
      // dias" com os esportes de "1 ano" e a curva de 30. Melhor não ter nada
      // e dizer que falhou.
      setCardio([]);
      setCardioSel(null);
    }

    setError(forca.status === "rejected");
    setErroCardio(cardioRes.status === "rejected");
    setLoading(false);
  }, [token, janela]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // A série é buscada à parte: trocar de métrica ou de exercício não deveria
  // recarregar a lista inteira nem o radar.
  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      // Só o modo visível busca: a tela tem duas curvas e trocar de janela
      // disparava as duas, sendo que uma delas está fora da tela.
      if (!slug || mode !== "strength") {
        if (!slug) setSerie([]);
        return;
      }
      setCarregandoSerie(true);
      setErroSerie(false);
      serieDoExercicio(token!, slug, janela, metrica)
        .then((pontos) => vivo && setSerie(pontos))
        .catch(() => {
          if (!vivo) return;
          // Falha de rede NÃO é "sem dados desta métrica": uma é sobre a
          // conexão, a outra é uma afirmação sobre o treino da pessoa.
          setSerie([]);
          setErroSerie(true);
        })
        .finally(() => vivo && setCarregandoSerie(false));
      return () => {
        vivo = false;
      };
    }, [token, slug, janela, metrica, mode])
  );

  // A curva do cardio, também à parte: trocar de métrica não recarrega a lista.
  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      if (!cardioSel || mode !== "cardio") {
        if (!cardioSel) setCurvaCardio({ pontos: [], menorEhMelhor: false });
        return;
      }
      setCarregandoCardio(true);
      setErroSerieCardio(false);
      serieDeCardio(token!, cardioSel, janela, metricaCardio)
        .then((r) => vivo && setCurvaCardio(r))
        .catch(() => {
          if (!vivo) return;
          setCurvaCardio({ pontos: [], menorEhMelhor: false });
          setErroSerieCardio(true);
        })
        .finally(() => vivo && setCarregandoCardio(false));
      return () => {
        vivo = false;
      };
    }, [token, cardioSel, janela, metricaCardio, mode])
  );

  const atual = useMemo(() => exercicios.find((e) => e.slug === slug) ?? null, [exercicios, slug]);

  const cardioAtual = useMemo(
    () => cardio.find((e) => e.sportId === cardioSel) ?? null,
    [cardio, cardioSel]
  );

  // Esteira sem marcar quilômetro não tem pace — e pace é a métrica padrão.
  // Sem isto, o chip do esporte aparece, a pessoa toca e lê "sem dados desta
  // métrica", que soa como defeito. Só desvia do PADRÃO: uma escolha explícita
  // de distância ou duração não é mexida.
  useEffect(() => {
    if (metricaCardio === "pace" && cardioAtual && cardioAtual.melhorPace === 0) {
      setMetricaCardio("duracao");
    }
  }, [cardioAtual, metricaCardio]);

  const pontosDoCardio = useMemo(
    () => curvaCardio.pontos.map((p) => ({ date: p.data, value: p.valor, ehPR: p.ehPR })),
    [curvaCardio]
  );

  // Estável entre renders: o gráfico recalcula as coordenadas quando `points`
  // muda de identidade, e um array novo a cada render significava refazer a
  // conta a cada quadro do arrasto do dedo.
  const pontosDoGrafico = useMemo(
    () => serie.map((p) => ({ date: p.data, value: p.valor, ehPR: p.ehPR })),
    [serie]
  );

  // Máx de 460px de largura para o gráfico (bom no web e no celular).
  const chartWidth = Math.min(width - spacing.gutter * 2 - spacing.md * 2, 460);
  const radarSize = Math.min(chartWidth, 320);

  const treinouAlgo = grupos.some((g) => g.series > 0);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          paddingHorizontal: spacing.gutter,
          paddingTop: spacing.md,
          gap: spacing.card,
        }}
      >
        <Skeleton width="45%" height={22} />
        <Skeleton height={40} radius={12} />
        <SkeletonCard lines={3} height={200} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!embedded && (
        <Txt variant="titleScreen">{mode === "strength" ? "Evolução de carga" : "Evolução de cardio"}</Txt>
      )}

      <View style={styles.toggle}>
        <Chip label="Musculação" active={mode === "strength"} onPress={() => setMode("strength")} />
        <Chip label="Cardio" active={mode === "cardio"} onPress={() => setMode("cardio")} />
      </View>

      <>
          {/* Janela: é ela que define o que "evoluir" quer dizer aqui. Vale para
              os dois modos — o cardio não tinha janela nenhuma e mostrava a
              vida inteira, que é o mesmo que não responder "como estou indo". */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {JANELAS.map((d) => (
              <Chip
                key={d}
                label={
                  janelaAplicada?.limitadoPeloPlano ? `${rotuloDaJanela(d)} 🔒` : rotuloDaJanela(d)
                }
                active={janela === d}
                onPress={() => setJanela(d)}
              />
            ))}
          </ScrollView>

          {/* O corte dito com todas as letras. Sem isto, a tela mostrava sete
              dias com o chip "1 ano" aceso, e a pessoa concluía que o
              aplicativo tinha perdido o histórico dela. */}
          {janelaAplicada?.limitadoPeloPlano && (
            <TouchableOpacity
              onPress={() => nav.navigate("Subscription")}
              activeOpacity={0.85}
            >
              <Card level={1}>
                <Txt variant="bodyStrong">
                  Você está vendo os últimos {janelaAplicada.dias} dias
                </Txt>
                <Txt variant="caption" color={colors.text2} style={{ marginTop: 2 }}>
                  As janelas maiores fazem parte do Pro. Seu histórico continua todo aqui.
                </Txt>
                <Txt variant="label" color={colors.lime} style={{ marginTop: spacing.s8 }}>
                  Conhecer o Pro ›
                </Txt>
              </Card>
            </TouchableOpacity>
          )}

          {/* O erro é de UM modo, não da tela: a musculação falhando não pode
              apagar um cardio que já está carregado na memória. */}
          {mode === "strength" && error && (
            <ErrorState
              message="Não foi possível carregar sua evolução."
              onRetry={() => {
                setLoading(true);
                load();
              }}
            />
          )}

          {mode === "strength" && !error && (
            <>
              {exercicios.length === 0 ? (
                <Card level={1}>
                  <Txt variant="body" color={colors.text2}>
                    Nenhum treino de força com carga nesta janela. Registre seus treinos para
                    acompanhar aqui a evolução de cada exercício.
                  </Txt>
                </Card>
              ) : (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    {exercicios.map((e) => (
                      <Chip
                        key={e.slug}
                        label={e.nome}
                        active={slug === e.slug}
                        onPress={() => setSlug(e.slug)}
                      />
                    ))}
                  </ScrollView>

                  {atual && (
                    <Card level={1}>
                      <View style={styles.headlineRow}>
                        <Txt variant="titleCard">{atual.nome}</Txt>
                        {atual.delta !== null && (
                          <Txt
                            variant="bodyStrong"
                            tabular
                            color={atual.delta >= 0 ? colors.lime : colors.text3}
                          >
                            {`${atual.delta >= 0 ? "+" : "−"}${curto(Math.abs(atual.delta))} kg`}
                          </Txt>
                        )}
                      </View>

                      <View style={styles.metricRow}>
                        <Txt variant="metricLg" tabular>
                          {curto(atual.ultimo)}
                          <Txt variant="label" color={colors.text2}> kg</Txt>
                        </Txt>
                      </View>
                      <Txt variant="caption" color={colors.text3}>
                        Melhor: {curto(atual.melhor)} kg · {atual.vezes}{" "}
                        {atual.vezes === 1 ? "treino" : "treinos"} nesta janela
                      </Txt>

                      {/* Métrica: carga não é a única forma de evoluir — quem
                          não subiu peso pode ter subido volume. */}
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chips}
                        style={{ marginTop: spacing.s8 }}
                      >
                        {METRICAS.map((m) => (
                          <Chip
                            key={m}
                            label={rotuloDaMetrica(m)}
                            active={metrica === m}
                            onPress={() => setMetrica(m)}
                          />
                        ))}
                      </ScrollView>

                      {carregandoSerie ? (
                        <Skeleton height={200} radius={12} />
                      ) : erroSerie ? (
                        <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                          Não foi possível carregar a curva. Toque em outra métrica e volte para
                          tentar de novo.
                        </Txt>
                      ) : serie.length > 1 ? (
                        <View style={{ marginTop: spacing.s16 }}>
                          <LineChart
                            points={pontosDoGrafico}
                            width={chartWidth}
                            formatValue={(v) => formatarValor(v, metrica)}
                          />
                          {serie.some((p) => p.ehPR) && (
                            <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                              O ponto destacado é um recorde seu.
                            </Txt>
                          )}
                        </View>
                      ) : (
                        <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                          {serie.length === 1
                            ? "Registre este exercício mais vezes para ver a curva."
                            : "Sem dados desta métrica neste exercício."}
                        </Txt>
                      )}
                    </Card>
                  )}

                  {/* Radar: onde você treina, e onde não treina. */}
                  {treinouAlgo && (
                    <Card level={1}>
                      <SectionHeader title="Onde você treina" />
                      <RadarChart
                        eixos={grupos.map((g) => ({ rotulo: abreviarMusculo(g.grupo), valor: g.series }))}
                        size={radarSize}
                      />
                      <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                        Séries por grupo muscular {janelaAplicada?.limitadoPeloPlano
                          ? `nos últimos ${janelaAplicada.dias} dias`
                          : rotuloDaJanela(janela).toLowerCase() === "tudo"
                            ? "em todo o seu histórico"
                            : `nos últimos ${rotuloDaJanela(janela).toLowerCase()}`}
                        . A comparação é com você mesmo.
                      </Txt>
                    </Card>
                  )}
                </>
              )}
            </>
          )}

          {mode === "cardio" && erroCardio && (
            <ErrorState
              message="Não foi possível carregar seu cardio."
              onRetry={() => {
                setLoading(true);
                load();
              }}
            />
          )}

          {mode === "cardio" &&
            !erroCardio &&
            (cardio.length === 0 ? (
              <Card level={1}>
                <Txt variant="body" color={colors.text2}>
                  Nenhuma corrida, pedalada ou nado nesta janela. Registre um treino de cardio
                  para acompanhar aqui a sua evolução.
                </Txt>
              </Card>
            ) : (
              <>
                {/* Esporte: aqui se compara corrida com corrida, e não um
                    exercício com outro — a unidade do cardio é o esporte. */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {cardio.map((e) => (
                    <Chip
                      key={e.sportId}
                      label={e.nome}
                      active={cardioSel === e.sportId}
                      onPress={() => setCardioSel(e.sportId)}
                    />
                  ))}
                </ScrollView>

                {cardioAtual && (
                  <Card level={1} sport={cardioAtual.sportId}>
                    <View style={styles.headlineRow}>
                      <Txt variant="titleCard">{cardioAtual.nome}</Txt>
                      {cardioAtual.delta !== null && (
                        <Txt
                          variant="bodyStrong"
                          tabular
                          color={cardioAtual.delta >= 0 ? colors.lime : colors.text3}
                        >
                          {/* O rótulo "Pace" não é enfeite: na musculação o
                              delta e o número grande são a mesma grandeza (kg)
                              e o olho aprende a lê-los juntos. Aqui o delta é
                              pace e o número grande é distância — sem dizer
                              qual é qual, ele aprende errado. E o sinal é
                              invertido de propósito: melhora no pace é tempo a
                              MENOS, e o chip de força ao lado usa o mesmo "−"
                              com o significado oposto. */}
                          {`Pace ${cardioAtual.delta >= 0 ? "−" : "+"}${formatarCardio(
                            Math.abs(cardioAtual.delta),
                            "pace"
                          )}/km`}
                        </Txt>
                      )}
                    </View>

                    <View style={styles.metricRow}>
                      <Txt variant="metricLg" tabular>
                        {curto(cardioAtual.distanciaKm)}
                        <Txt variant="label" color={colors.text2}> km</Txt>
                      </Txt>
                    </View>
                    <Txt variant="caption" color={colors.text3}>
                      {cardioAtual.melhorPace > 0
                        ? `Melhor pace: ${formatarCardio(cardioAtual.melhorPace, "pace")}/km · `
                        : ""}
                      {cardioAtual.vezes} {cardioAtual.vezes === 1 ? "sessão" : "sessões"} nesta janela
                    </Txt>

                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.chips}
                      style={{ marginTop: spacing.s8 }}
                    >
                      {METRICAS_CARDIO.map((m) => (
                        <Chip
                          key={m}
                          label={rotuloDaMetricaCardio(m)}
                          active={metricaCardio === m}
                          onPress={() => setMetricaCardio(m)}
                        />
                      ))}
                    </ScrollView>

                    {carregandoCardio ? (
                      <Skeleton height={200} radius={12} />
                    ) : erroSerieCardio ? (
                      // Falhar em carregar a curva não é a pessoa não ter
                      // corrido: são quatro métricas agora, e cada chip é uma
                      // requisição — este caminho ficou frequente.
                      <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                        Não foi possível carregar a curva. Toque em outra métrica e volte para
                        tentar de novo.
                      </Txt>
                    ) : curvaCardio.pontos.length > 1 ? (
                      <View style={{ marginTop: spacing.s16 }}>
                        <LineChart
                          points={pontosDoCardio}
                          width={chartWidth}
                          formatValue={(v) => formatarCardio(v, metricaCardio)}
                          // Correr mais rápido é um pace MENOR: sem inverter,
                          // melhorar desenhava uma linha descendo.
                          menorEhMelhor={curvaCardio.menorEhMelhor}
                        />
                        {curvaCardio.pontos.some((p) => p.ehPR) && (
                          <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                            O ponto destacado é um recorde seu.
                          </Txt>
                        )}
                      </View>
                    ) : (
                      <Txt variant="caption" color={colors.text3} style={{ marginTop: spacing.s8 }}>
                        {curvaCardio.pontos.length === 1
                          ? "Registre este esporte mais vezes para ver a curva."
                          : "Sem dados desta métrica neste esporte."}
                      </Txt>
                    )}
                  </Card>
                )}
              </>
            ))}
      </>
      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.gutter, gap: spacing.card },
  toggle: { flexDirection: "row", gap: spacing.s8 },
  chips: { gap: spacing.s8, paddingVertical: spacing.xs },
  headlineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metricRow: { marginTop: spacing.s8, marginBottom: 2 },
});
