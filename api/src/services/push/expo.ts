import { env } from "../../config/env.js";

// O transporte, e só ele. Quem decide o que mandar e para quem é o serviço de
// cima — aqui só entra "estas mensagens, para estes tokens".
//
// Isolado de propósito: trocar o Expo Push por FCM direto (ou por web push)
// depois deve ser reescrever este arquivo, não caçar chamadas pelo projeto.

const ENDPOINT = "https://exp.host/--/api/v2/push/send";
/** O serviço do Expo aceita no máximo 100 mensagens por requisição. */
const LOTE = 100;
const PRAZO_MS = 10_000;

export interface MensagemPush {
  to: string;
  title: string;
  body: string;
  /** Vai junto para o app abrir no lugar certo ao tocar. */
  data?: Record<string, string>;
  badge?: number;
}

export interface ResultadoDoEnvio {
  entregues: number;
  /** Tokens que o serviço disse não existir mais — o chamador deve removê-los. */
  invalidos: string[];
}

interface RespostaExpo {
  data?: { status: string; message?: string; details?: { error?: string } }[];
}

function lotes<T>(itens: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

export async function enviarParaExpo(mensagens: MensagemPush[]): Promise<ResultadoDoEnvio> {
  const resultado: ResultadoDoEnvio = { entregues: 0, invalidos: [] };
  if (!mensagens.length) return resultado;

  for (const lote of lotes(mensagens, LOTE)) {
    try {
      const resposta = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // Opcional. Sem ele o envio funciona, mas com limite mais apertado e
          // sem proteção contra alguém que descubra os tokens.
          ...(env.expoAccessToken ? { Authorization: `Bearer ${env.expoAccessToken}` } : {}),
        },
        body: JSON.stringify(lote),
        signal: AbortSignal.timeout(PRAZO_MS),
      });

      if (!resposta.ok) {
        console.warn(`[push] Expo respondeu ${resposta.status} para um lote de ${lote.length}`);
        continue;
      }

      const corpo = (await resposta.json()) as RespostaExpo;
      corpo.data?.forEach((item, i) => {
        if (item.status === "ok") {
          resultado.entregues += 1;
          return;
        }
        // O app foi desinstalado ou o token foi revogado. Insistir nele é
        // desperdício garantido, e o Expo pune quem insiste.
        if (item.details?.error === "DeviceNotRegistered") {
          resultado.invalidos.push(lote[i].to);
        } else {
          console.warn(`[push] recusado (${item.details?.error ?? item.status}): ${item.message ?? ""}`);
        }
      });
    } catch (err) {
      // Push é acessório: nunca derruba a ação que o originou.
      console.warn(`[push] lote falhou: ${(err as Error).message}`);
    }
  }

  return resultado;
}
