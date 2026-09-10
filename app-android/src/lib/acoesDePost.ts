import { useCallback, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { excluirPost as apiExcluir, type Post } from "../api/social";
import { confirmDialog, notify } from "./notify";

// As ações de post aparecem no feed, no explorar, no perfil e no detalhe. Sem
// isto, a mesma lógica de "quem pode o quê" estaria copiada em quatro telas —
// e uma delas ficaria para trás na próxima mudança.

export function useAcoesDePost(aoMudar: () => void) {
  const { user, token } = useAuth();
  const [denunciando, setDenunciando] = useState<string | null>(null);

  const meuPost = useCallback(
    (post: Post) => post.author.id === user?.id,
    [user]
  );

  const excluir = useCallback(
    (post: Post) => {
      confirmDialog(
        "Excluir publicação?",
        "Ela sai do feed e do seu perfil. Não dá para desfazer.",
        async () => {
          try {
            await apiExcluir(token!, post.id);
            aoMudar();
          } catch (err) {
            notify("Não deu para excluir", (err as Error).message);
          }
        },
        "Excluir"
      );
    },
    [token, aoMudar]
  );

  /** Props para o PostCard. Devolve só o que a pessoa pode fazer naquele post. */
  const propsDoCard = useCallback(
    (post: Post, aoEditar?: (p: Post) => void) =>
      meuPost(post)
        ? { onEditar: aoEditar, onExcluir: excluir }
        : { onDenunciar: (p: Post) => setDenunciando(p.id) },
    [meuPost, excluir]
  );

  return { propsDoCard, denunciando, fecharDenuncia: () => setDenunciando(null) };
}
