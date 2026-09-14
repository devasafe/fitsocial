import type { UsuarioAdmin } from "../api";

// O plano da conta, com a origem dele.
//
// Antes a coluna dizia só "premium" ou "grátis", e isso escondia as duas
// perguntas que o painel existe para responder: QUAL plano a pessoa tem, e se
// ela está PAGANDO. Um treinador, um fundador, um aluno bancado pelo coach e
// alguém com assinatura no cartão apareciam todos com a mesma palavra.

/**
 * A cor diz se entra dinheiro.
 *
 * Verde para quem paga, âmbar para quem precisa de atenção (a cobrança falhou),
 * cinza para o acesso que a casa dá — cortesia, fundador, patrocínio. É o que
 * permite varrer a lista com o olho e ver a receita.
 */
const CORES: Record<string, string> = {
  gratis: "var(--texto-3)",
  assinatura: "var(--lime)",
  inadimplente: "var(--alerta)",
  cortesia: "var(--texto-2)",
  fundador: "var(--texto-2)",
  cupom: "var(--texto-2)",
  profissional: "var(--texto-2)",
  patrocinio: "var(--texto-2)",
  legado: "var(--texto-2)",
};

const ORIGENS: Record<string, string> = {
  gratis: "",
  assinatura: "pagando",
  inadimplente: "pagamento falhou",
  cortesia: "cortesia",
  fundador: "fundador",
  cupom: "cupom",
  profissional: "profissional",
  patrocinio: "bancado",
  legado: "antigo",
};

/** Lê os campos novos e cai para o binário antigo se o servidor for anterior. */
export function planoDe(u: UsuarioAdmin): { rotulo: string; origem: string; cor: string } {
  const origem = u.origemDoPlano ?? (u.tierEfetivo === "premium" ? "legado" : "gratis");
  return {
    rotulo: u.rotuloDoPlano ?? (u.tierEfetivo === "premium" ? "Pro" : "Grátis"),
    origem: ORIGENS[origem] ?? origem,
    cor: CORES[origem] ?? "var(--texto-2)",
  };
}

export function Plano({ u, compacto }: { u: UsuarioAdmin; compacto?: boolean }) {
  const { rotulo, origem, cor } = planoDe(u);
  return (
    <span style={{ alignItems: "center", display: "inline-flex", gap: 6 }}>
      <span style={{ color: cor }}>{rotulo}</span>
      {origem && !compacto ? (
        <span className="aviso" style={{ color: "var(--texto-3)" }}>
          {origem}
        </span>
      ) : null}
    </span>
  );
}
