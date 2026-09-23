import { AppState } from "react-native";
import { enviarEventos, type NomeDeEvento, type PropsDeEvento, type EventoEnviado } from "../api/eventos";

/**
 * Por onde a pessoa passou — enfileirado aqui e mandado em lote.
 *
 * Três regras que valem mais que o resto deste arquivo:
 *
 * 1. **Nunca lança e nunca espera.** Telemetria que quebra a tela que está
 *    medindo é pior que não ter telemetria. Todo caminho de erro termina em
 *    descarte silencioso.
 * 2. **Uma requisição por tela aberta seria absurdo.** Por isso a fila, com
 *    envio por tamanho, por tempo, e quando o app vai para segundo plano —
 *    que é justamente quando as sessões que interessam terminam.
 * 3. **A fila tem teto.** Sem rede, ela para de crescer e descarta o mais
 *    antigo: medir o percurso não vale ocupar memória de quem está treinando.
 */

const TETO_DA_FILA = 100;
const LOTE = 20;
const ESPERA_MS = 5_000;

let token: string | null = null;
let fila: EventoEnviado[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let ouvindoAppState = false;

/** O `AuthProvider` chama isto quando a sessão abre ou fecha. */
export function definirTokenDeEventos(novo: string | null): void {
  token = novo;
  // Sair da conta descarta o que estava na fila: são eventos de quem saiu, e
  // mandá-los com o token seguinte os atribuiria à pessoa errada.
  if (!novo) {
    fila = [];
    limparTimer();
  }
}

function limparTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function esvaziar(): Promise<void> {
  limparTimer();
  if (!token || fila.length === 0) return;

  const lote = fila;
  fila = [];
  try {
    await enviarEventos(token, lote);
  } catch {
    // Descarta. Reenfileirar criaria uma fila que só cresce quando a rede está
    // ruim — e o lote perdido não muda nenhuma decisão que este dado serve.
  }
}

function agendar(): void {
  if (timer) return;
  timer = setTimeout(() => {
    void esvaziar();
  }, ESPERA_MS);
}

function ouvirSegundoPlano(): void {
  if (ouvindoAppState) return;
  ouvindoAppState = true;
  AppState.addEventListener("change", (estado) => {
    if (estado !== "active") void esvaziar();
  });
}

/** Marca uma passagem. Chamar e seguir em frente — não devolve nada de útil. */
export function registrarEvento(nome: NomeDeEvento, props?: PropsDeEvento): void {
  try {
    if (!token) return;
    ouvirSegundoPlano();

    fila.push(props ? { nome, props } : { nome });
    if (fila.length > TETO_DA_FILA) fila = fila.slice(-TETO_DA_FILA);

    if (fila.length >= LOTE) void esvaziar();
    else agendar();
  } catch {
    // Ver a regra 1 no topo: daqui não sai exceção, aconteça o que acontecer.
  }
}
