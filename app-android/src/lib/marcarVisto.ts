// Quando dar o conteúdo por visto.
//
// A regra é a mesma nos dois casos: a marca cai quando a pessoa CHEGA ao
// conteúdo que era novo, nunca quando abre a aba. Marcar na abertura zeraria o
// badge de quem só passou o olho e voltou — e aí o badge deixa de significar
// "tem coisa que você não viu".
//
// A forma muda porque a lista muda: uma lista longa mede por item visível, uma
// lista curta mede por chegar ao fim.

import { useCallback, useMemo, useRef } from "react";
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ViewToken,
  LayoutChangeEvent,
} from "react-native";
import { useContadores } from "../context/ContadoresContext";
import type { Area } from "../api/readState";

/**
 * Lista longa (feed): visto quando o item mais antigo do lote novo aparece na
 * tela. Os novos vêm no topo, então ver o de índice `novos - 1` significa ter
 * passado por todos.
 *
 * `onViewableItemsChanged` não pode trocar de identidade entre renders — a
 * FlatList quebra se trocar. Por isso o callback vive num ref e lê o valor
 * atual de `novos` de outro ref, em vez de fechar sobre o estado.
 */
export function useMarcarAoVerNovos(area: Area, novos: number) {
  const { marcarVisto } = useContadores();
  const novosRef = useRef(novos);
  novosRef.current = novos;
  const marcarRef = useRef(marcarVisto);
  marcarRef.current = marcarVisto;

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const alvo = novosRef.current;
    if (alvo <= 0) return;
    const chegou = viewableItems.some((v) => (v.index ?? -1) >= alvo - 1);
    if (chegou) void marcarRef.current(area);
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    // Meio segundo separa "li" de "passei rolando".
    minimumViewTime: 500,
  }).current;

  return { onViewableItemsChanged, viewabilityConfig };
}

/**
 * Lista curta dentro de um ScrollView (desafios): visto quando a pessoa chega ao
 * fim da rolagem — ou quando não há rolagem nenhuma, porque aí a lista inteira
 * já está na tela e ela viu tudo que havia.
 */
export function useMarcarAoChegarAoFim(area: Area, ativo: boolean) {
  const { marcarVisto } = useContadores();
  const alturaVisivel = useRef(0);
  const alturaTotal = useRef(0);

  const marcar = useCallback(() => {
    if (ativo) void marcarVisto(area);
  }, [ativo, area, marcarVisto]);

  const conferirSeCabeInteira = useCallback(() => {
    if (alturaVisivel.current && alturaTotal.current) {
      // Uma folga de 24px evita que um resto de padding conte como "tem mais".
      if (alturaTotal.current <= alturaVisivel.current + 24) marcar();
    }
  }, [marcar]);

  return useMemo(
    () => ({
      onLayout: (e: LayoutChangeEvent) => {
        alturaVisivel.current = e.nativeEvent.layout.height;
        conferirSeCabeInteira();
      },
      onContentSizeChange: (_l: number, altura: number) => {
        alturaTotal.current = altura;
        conferirSeCabeInteira();
      },
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        const fim = contentOffset.y + layoutMeasurement.height >= contentSize.height - 40;
        if (fim) marcar();
      },
      scrollEventThrottle: 200,
    }),
    [marcar, conferirSeCabeInteira]
  );
}
