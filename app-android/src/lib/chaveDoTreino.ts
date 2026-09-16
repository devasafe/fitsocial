import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIXO = "fitsocial.clientKey:";

/**
 * A chave que identifica este ENVIO de treino — não o conteúdo, o envio.
 *
 * Nasce quando o treino COMEÇA (a tela abre, a gravação de GPS inicia), nunca
 * quando a pessoa toca em salvar: começar acontece uma vez, salvar é o que se
 * repete. Se ela nascesse no clique, cada clique teria a sua, e dois cliques
 * continuariam virando dois treinos — a proteção seria só de fachada.
 *
 * Fica em `AsyncStorage`, sob uma chave derivada do `contexto` (o dia da
 * sessão do plano, o esporte da tela de registro…), e por isso sobrevive a um
 * recarregamento do app: se o processo reiniciar com o envio em andamento, a
 * tela pede a chave de novo para o MESMO contexto e recebe a mesma — é isso
 * que deixa o servidor reconhecer o duplo toque em "salvar" que acontece
 * depois de a tela travar e o processo recarregar (ver `acharRepeticao` em
 * `api/src/services/activities.ts`).
 */
export async function chaveDoTreino(contexto: string): Promise<string> {
  const storageKey = PREFIXO + contexto;
  const existente = await AsyncStorage.getItem(storageKey);
  if (existente) return existente;
  const nova = crypto.randomUUID();
  await AsyncStorage.setItem(storageKey, nova);
  return nova;
}

/**
 * Apaga a chave depois que o treino foi salvo com sucesso — no mesmo ponto em
 * que a tela limpa o rascunho, e pelo mesmo motivo: o envio terminou.
 */
export async function limparChaveDoTreino(contexto: string): Promise<void> {
  await AsyncStorage.removeItem(PREFIXO + contexto);
}
