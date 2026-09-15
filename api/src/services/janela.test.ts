import { describe, it, expect } from "vitest";
import { janelaPermitida, metaDaJanela, JANELA_DO_GRATIS } from "./janela.js";
import type { UserDoc } from "../models/User.js";

// `calcularPlan` le `user.email` (via isFounder) antes de olhar o plano: sem
// email o teste estoura com "Cannot read properties of undefined". Verificado
// rodando o entitlement de verdade, nao deduzido.
const comPlano = (plan: string) =>
  ({ plan, tier: "premium", email: "quem@paga.com" }) as unknown as UserDoc;
const gratis = () => ({ plan: "free", tier: "free", email: "gratis@teste.com" }) as unknown as UserDoc;

describe("Até onde o plano deixa enxergar", () => {
  it("quem paga pede o que quiser", () => {
    expect(janelaPermitida(comPlano("pro"), 365)).toBe(365);
  });

  it("o grátis é cortado, não recusado", () => {
    expect(janelaPermitida(gratis(), 90)).toBe(JANELA_DO_GRATIS);
  });

  it("zero significa tudo, e é o caso que mais precisa de corte", () => {
    expect(janelaPermitida(gratis(), 0)).toBe(JANELA_DO_GRATIS);
  });

  it("o meta só fala em corte quando houve corte", () => {
    expect(metaDaJanela(30, 30)).toEqual({ dias: 30 });
    expect(metaDaJanela(90, 7)).toEqual({ dias: 7, diasPedidos: 90, limitadoPor: "plano" });
  });
});
