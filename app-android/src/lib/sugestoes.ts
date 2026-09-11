// O que VOCÊ já digitou, oferecido de volta.
//
// Não existe catálogo de movimentos, e não deveria existir: cada box escreve
// diferente, e quem chama de "BJO" nunca vai achar "Burpee Box Jump Over" numa
// lista global. O acervo que importa é o seu, e ele se enche sozinho.
//
// Guarda modo e nome de movimento SEPARADOS: "AMRAP 8'" não é sugestão de
// movimento, e "Thruster" não é sugestão de modo. Misturar os dois faria as
// duas listas piorarem juntas.
//
// Ordena por frequência, com desempate pelo mais recente — quem faz Fran toda
// semana quer Fran em cima, mas quem acabou de descobrir Rope Climb também
// quer achar de novo amanhã.
//
// Mora no aparelho, como a plataforma de vídeo: é sobre o que você escreve, não
// sobre quem você é. Trocar de celular recomeça o acervo, e tudo bem.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type TipoDeSugestao = "modo" | "movimento";

const CHAVES: Record<TipoDeSugestao, string> = {
  modo: "fitsocial.sugestoes.modo",
  movimento: "fitsocial.sugestoes.movimento",
};

/** Quantas guardar. Acima disso a lista deixa de ser acervo e vira arquivo. */
const TETO = 120;

interface Registro {
  valor: string;
  usos: number;
  quando: number;
}

/** Compara ignorando caixa e acento, mas guarda como foi escrito. */
function chave(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

async function ler(tipo: TipoDeSugestao): Promise<Registro[]> {
  try {
    const cru = await AsyncStorage.getItem(CHAVES[tipo]);
    const lista = cru ? (JSON.parse(cru) as Registro[]) : [];
    return Array.isArray(lista) ? lista.filter((r) => r?.valor) : [];
  } catch {
    // Storage indisponível ou JSON corrompido: sem sugestão é pior que com,
    // mas melhor que a tela não abrir.
    return [];
  }
}

async function gravar(tipo: TipoDeSugestao, lista: Registro[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVES[tipo], JSON.stringify(lista.slice(0, TETO)));
  } catch {
    /* a sugestão desta vez se perde; o treino não */
  }
}

function ordenar(lista: Registro[]): Registro[] {
  return [...lista].sort((a, b) => b.usos - a.usos || b.quando - a.quando);
}

/** Registra um uso. Chamado ao SALVAR, não a cada tecla. */
export async function anotar(tipo: TipoDeSugestao, valores: string[]): Promise<void> {
  const limpos = valores.map((v) => v.trim()).filter(Boolean);
  if (!limpos.length) return;

  const lista = await ler(tipo);
  const porChave = new Map(lista.map((r) => [chave(r.valor), r]));

  for (const valor of limpos) {
    const k = chave(valor);
    const atual = porChave.get(k);
    // O valor fica como foi escrito DA ÚLTIMA VEZ: se a pessoa corrigiu a
    // grafia, é a correção que ela quer ver sugerida.
    porChave.set(k, { valor, usos: (atual?.usos ?? 0) + 1, quando: Date.now() });
  }

  await gravar(tipo, ordenar([...porChave.values()]));
}

/**
 * As sugestões para o que está sendo digitado.
 *
 * Com o campo vazio devolve as mais usadas; com texto, as que começam ou
 * contêm — nessa ordem, porque quem digita "th" quer "Thruster" antes de
 * "Front Squat com Thruster".
 */
export async function sugerir(
  tipo: TipoDeSugestao,
  digitado: string,
  maximo = 6
): Promise<string[]> {
  const lista = ordenar(await ler(tipo));
  const q = chave(digitado);
  if (!q) return lista.slice(0, maximo).map((r) => r.valor);

  const comeca: string[] = [];
  const contem: string[] = [];
  for (const r of lista) {
    const k = chave(r.valor);
    // Não sugerir exatamente o que já está escrito: é ruído sob o dedo.
    if (k === q) continue;
    if (k.startsWith(q)) comeca.push(r.valor);
    else if (k.includes(q)) contem.push(r.valor);
  }

  return [...comeca, ...contem].slice(0, maximo);
}

/** Tudo que um treino ensina, numa chamada só. */
export async function anotarTreino(modos: string[], movimentos: string[]): Promise<void> {
  await Promise.all([anotar("modo", modos), anotar("movimento", movimentos)]);
}

/** Só para teste e para um futuro "limpar sugestões" nas preferências. */
export async function esquecer(tipo: TipoDeSugestao): Promise<void> {
  try {
    await AsyncStorage.removeItem(CHAVES[tipo]);
  } catch {
    /* nada a fazer */
  }
}
