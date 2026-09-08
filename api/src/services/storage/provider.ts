// Contrato genérico da camada de armazenamento de arquivos. Nenhuma outra parte
// do sistema sabe se as imagens vão para o disco local ou para um bucket S3 —
// trocar de destino é criar outra implementação e apontar o factory
// (services/storage/index.ts) para ela. Espelha o padrão de services/ai/.

export interface FileToSave {
  buffer: Buffer;
  contentType: string;
  /** Extensão com ponto, ex.: ".jpg". */
  ext: string;
}

export interface SavedFile {
  /** URL absoluta (ex.: S3) ou relativa iniciando em "/uploads/" (disco). */
  url: string;
}

export interface StorageProvider {
  /** Nome do provider (para logs/diagnóstico). */
  readonly name: string;
  save(file: FileToSave): Promise<SavedFile>;
}

/** Erro específico da camada de storage, para o middleware tratar. */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** Gera um nome/chave único e opaco para o arquivo. */
export function randomKey(ext: string): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
}
