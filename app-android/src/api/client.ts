import { API_BASE_URL } from "../config";

export interface ApiError {
  error: string;
  details?: { path: string; message: string }[];
}

/** Erro de API que carrega o status HTTP, para o app reagir a casos específicos. */
export class ApiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiHttpError";
  }
}

/** Cliente HTTP fino: injeta o token, envia/recebe JSON e normaliza erros. */
export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<T> {
  const { method = "GET", body, token } = options;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch só lança em falha de rede (offline, servidor fora do ar, etc.).
    throw new ApiHttpError(0, "Sem conexão com o servidor. Verifique sua internet.");
  }

  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;

  if (!res.ok) {
    const message = (data as ApiError).error ?? "Erro inesperado. Tente novamente.";
    throw new ApiHttpError(res.status, message);
  }

  return data as T;
}
