// Contrato genérico de envio de e-mail. Nenhuma outra parte do sistema sabe se
// a mensagem sai pela Resend, por SMTP ou pelo console — trocar de destino é
// escrever outra implementação e apontar o factory. Espelha services/ai/ e
// services/storage/.

export interface Mensagem {
  para: string;
  assunto: string;
  /** Corpo em texto puro. Cliente de e-mail nenhum recusa texto. */
  texto: string;
  /** Versão em HTML, quando vale a pena. Opcional de propósito. */
  html?: string;
}

export interface Mailer {
  readonly name: string;
  enviar(mensagem: Mensagem): Promise<void>;
}

/** Erro específico da camada de e-mail, para a rota distinguir de erro de dados. */
export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailError";
  }
}
