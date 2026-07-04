import { API_BASE_URL } from "../config";

/** Envia um FormData com o campo "image" e retorna a URL pública da imagem. */
export async function uploadImage(token: string, form: FormData): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/uploads`, {
    method: "POST",
    // NÃO definir Content-Type: o fetch monta o boundary do multipart sozinho.
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Falha no upload da imagem");
  return data as { url: string };
}
