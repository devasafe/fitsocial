import { env } from "../../config/env.js";
import { ConsoleMailer } from "./console.js";
import { ResendMailer } from "./resend.js";
import { MailError, type Mailer } from "./provider.js";

let cached: Mailer | null = null;

/**
 * O mailer configurado (singleton).
 *
 * Sem chave, cai no provider de console — o fluxo continua testável em
 * desenvolvimento, com o código aparecendo no terminal. Em produção isso é
 * recusado: um código de redefinição de senha no log da aplicação é uma porta
 * aberta para quem tiver acesso aos logs, e "funciona mas não envia" é pior que
 * um erro claro.
 */
export function getMailer(): Mailer {
  if (cached) return cached;

  if (env.resendApiKey) {
    cached = new ResendMailer(env.resendApiKey, env.mailFrom);
    return cached;
  }

  if (env.isProd) {
    throw new MailError(
      "Envio de e-mail não configurado: defina RESEND_API_KEY e MAIL_FROM."
    );
  }

  cached = new ConsoleMailer();
  return cached;
}

/** Permite injetar um mailer (ex.: mock nos testes) ou resetar (null). */
export function setMailer(mailer: Mailer | null): void {
  cached = mailer;
}

export { MailError } from "./provider.js";
export type { Mailer, Mensagem } from "./provider.js";
