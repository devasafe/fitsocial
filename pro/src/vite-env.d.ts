/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL da API. É build-time: o Vite inlina no bundle, então precisa estar
   *  marcada como Build Variable no Coolify — a mesma armadilha do Expo,
   *  documentada em docs/INFRA.md. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
