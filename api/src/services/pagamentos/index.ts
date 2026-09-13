import { env } from "../../config/env.js";
import { AsaasProvider } from "./asaas.js";
import type { IProvedorDePagamento } from "./provider.js";
import type { Provedor } from "../../models/Assinatura.js";

// A fábrica, no mesmo molde de `services/storage/index.ts` e `services/ai`.

let cached: IProvedorDePagamento | null = null;

/** O provedor configurado (singleton). Troque por env `PAYMENT_PROVIDER`. */
export function getProvedorDePagamento(): IProvedorDePagamento {
  if (cached) return cached;

  switch (env.paymentProvider) {
    case "asaas":
      if (!env.asaasApiKey) {
        throw new Error("PAYMENT_PROVIDER=asaas exige ASAAS_API_KEY");
      }
      cached = new AsaasProvider();
      break;
    default:
      throw new Error(`Provedor de pagamento desconhecido: ${env.paymentProvider}`);
  }
  return cached;
}

/**
 * Um provedor pelo NOME, e não o configurado.
 *
 * O webhook precisa disto: um evento que chega para uma assinatura antiga tem
 * de ser lido por quem a criou, mesmo que a configuração já tenha mudado de
 * gateway. É o mesmo motivo de a `Assinatura` carimbar o provedor.
 */
export function provedorPeloNome(nome: Provedor): IProvedorDePagamento | null {
  // O provedor injetado vale quando o nome bate — senão o webhook construiria
  // um provedor novo e ignoraria a injeção, e nenhum teste de webhook estaria
  // testando o que acha que testa.
  if (cached && cached.nome === nome) return cached;
  if (nome === "asaas") return new AsaasProvider();
  return null;
}

/** Permite injetar um provedor (mock nos testes) ou resetar (null). */
export function setProvedorDePagamento(provider: IProvedorDePagamento | null): void {
  cached = provider;
}
