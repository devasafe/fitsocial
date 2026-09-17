import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIXO = "fitsocial.clientKey:";

/**
 * Quanto tempo uma chave vale antes de a tela gerar outra em vez de reler a
 * guardada.
 *
 * Duas âncoras, não um número solto:
 * - Maior que o treino mais longo plausível — a chave nasce quando a tela
 *   abre e só é usada no salvar, que pode vir horas depois (uma sessão de
 *   CrossFit com rascunho, por exemplo).
 * - Menor que o intervalo entre duas sessões do MESMO contexto — manhã e
 *   noite do mesmo dia/esporte ficam a ~12h de distância.
 *
 * Seis horas cabe entre as duas. Existe por causa de um caso específico: a
 * tela salva com sucesso, o servidor já criou a atividade, e o processo morre
 * ANTES de `limparChaveDoTreino` rodar (a tela travando é o próprio motivo
 * desta frente existir). Sem prazo, a chave órfã ficaria valendo para sempre,
 * e o PRÓXIMO treino registrado nesse contexto seria engolido como repetição
 * do anterior — o novo conteúdo descartado em silêncio, o antigo devolvido no
 * lugar dele. O prazo limita essa janela a algumas horas em vez de deixá-la
 * aberta.
 *
 * (Segunda linha, não a única: o servidor também trata chave batendo com
 * conteúdo diferente como chave velha, não repetição, e grava o treino novo —
 * ver `acharRepeticao` em `api/src/services/activities.ts`. Esse conserto
 * cobre a classe inteira sem depender de acertar este número; o prazo aqui
 * continua valendo por cima, e por isso não é o mesmo raciocínio de "12h
 * entre sessões" que valeria só para o contexto do plano.)
 */
const VALIDADE_MS = 6 * 60 * 60 * 1000;

interface ChaveArmazenada {
  chave: string;
  criadaEm: number;
}

/**
 * Gera o identificador em si.
 *
 * `crypto.randomUUID()` quando existe. Quando não — alguns Android mais
 * antigos não expõem o global — cai num identificador próprio: o instante em
 * base 36 (cresce, quase não repete) mais duas fatias de `Math.random()`,
 * sempre acima dos 8 caracteres que o servidor exige (`z.string().min(8)`).
 *
 * Aleatoriedade fraca é aceitável aqui DE PROPÓSITO: a chave não é segredo,
 * é um identificador de ENVIO, e o índice que a usa no servidor é por PESSOA
 * (`{user, clientKey}`). Adivinhar a chave de outra conta não dá nada a
 * ninguém — enviar qualquer coisa em nome dela exige o TOKEN daquela conta,
 * não a chave. Não "endurecer" isto depois achando que é uma falha de
 * segurança: não é.
 */
function gerarChave(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

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
 * `api/src/services/activities.ts`). Passado `VALIDADE_MS`, a chave guardada
 * é descartada e outra nasce em seu lugar — ver o comentário lá em cima.
 *
 * NUNCA rejeita. `AsyncStorage` pode falhar (modo privado no navegador, cota
 * cheia) tanto quanto pode faltar `crypto.randomUUID` — e nos dois casos a
 * resposta é a mesma: devolve `undefined`, não uma exceção. A chave é
 * OPCIONAL (`clientKey?`); salvar o treino SEM ela é aceitável, porque o
 * servidor ainda protege pela impressão do conteúdo. Travar o salvamento por
 * causa da própria proteção contra duplicata seria pior que o problema que
 * ela resolve.
 */
export async function chaveDoTreino(contexto: string): Promise<string | undefined> {
  const storageKey = PREFIXO + contexto;
  try {
    const bruto = await AsyncStorage.getItem(storageKey);
    if (bruto) {
      try {
        const armazenada = JSON.parse(bruto) as ChaveArmazenada;
        if (Date.now() - armazenada.criadaEm < VALIDADE_MS) return armazenada.chave;
      } catch {
        // Formato antigo ou corrompido — cai para gerar uma nova abaixo, como
        // se a chave tivesse expirado.
      }
    }
    const nova: ChaveArmazenada = { chave: gerarChave(), criadaEm: Date.now() };
    await AsyncStorage.setItem(storageKey, JSON.stringify(nova));
    return nova.chave;
  } catch {
    return undefined;
  }
}

/**
 * Apaga a chave depois que o treino foi salvo — no mesmo ponto em que a tela
 * limpa o rascunho, e pelo mesmo motivo: o envio terminou.
 *
 * As telas chamam isto depois de QUALQUER resposta bem-sucedida, repetição ou
 * não — não só quando o servidor confirma `repetido`. É de propósito: se a
 * limpeza de uma tentativa anterior falhou (o mesmo travamento que motiva o
 * prazo acima), a resposta de repetição da tentativa seguinte já prova que a
 * chave tem dono no servidor, e limpar aqui fecha essa órfã antes que uma
 * TERCEIRA tentativa a herde.
 *
 * Também nunca rejeita: falhar ao limpar não pode derrubar a conclusão de um
 * treino que JÁ foi salvo. Na pior das hipóteses a chave fica órfã, e o prazo
 * de validade (ou a rede por impressão no servidor) cobre isso depois.
 */
export async function limparChaveDoTreino(contexto: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIXO + contexto);
  } catch {
    // Ver o comentário acima — intencional.
  }
}
