/** Um número em destaque com o que ele significa embaixo. O rótulo explica
 *  a unidade; o apoio, a ressalva — "de 9 contas", "medindo desde ontem". */
export function Cartao({
  valor,
  rotulo,
  apoio,
  destaque = false,
}: {
  valor: string | number;
  rotulo: string;
  apoio?: string;
  destaque?: boolean;
}) {
  return (
    <div className="cartao">
      <div className="num" style={{ fontSize: 30, color: destaque ? "var(--lime)" : undefined }}>
        {valor}
      </div>
      <div style={{ color: "var(--texto-2)", marginTop: 2 }}>{rotulo}</div>
      {apoio && <div className="aviso" style={{ marginTop: 4 }}>{apoio}</div>}
    </div>
  );
}
