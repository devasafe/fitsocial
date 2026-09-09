/** Estado da conta em uma palavra. A cor é a informação; o texto confirma. */
const CORES: Record<string, string> = {
  active: "var(--termica-2)",
  suspended: "var(--alerta)",
  banned: "var(--perigo)",
  excluido: "var(--texto-3)",
};

const ROTULOS: Record<string, string> = {
  active: "ativa",
  suspended: "suspensa",
  banned: "banida",
  excluido: "excluída",
};

export function Selo({ estado }: { estado: string }) {
  const cor = CORES[estado] ?? "var(--texto-3)";
  return (
    <span style={{ alignItems: "center", display: "inline-flex", gap: 6 }}>
      <i
        aria-hidden
        style={{ background: cor, borderRadius: 999, display: "block", height: 7, width: 7 }}
      />
      {ROTULOS[estado] ?? estado}
    </span>
  );
}
