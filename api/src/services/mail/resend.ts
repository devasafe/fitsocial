import { env } from "../../config/env.js";
import { MailError, type Mailer, type Mensagem } from "./provider.js";

/**
 * Envio pela Resend, por HTTP puro — sem SDK, como o resto do projeto faz com a
 * IA. A conta precisa ter o domínio verificado para o remetente valer.
 */
export class ResendMailer implements Mailer {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly remetente: string
  ) {}

  async enviar(m: Mensagem): Promise<void> {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.remetente,
        to: [m.para],
        subject: m.assunto,
        text: m.texto,
        ...(m.html ? { html: m.html } : {}),
      }),
      // Sem prazo, uma API lenta trava a requisição de quem pediu o código.
      signal: AbortSignal.timeout(env.mailTimeoutMs),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      // A mensagem da Resend costuma dizer exatamente o que está errado
      // (domínio não verificado, remetente inválido) — vale preservar no log.
      throw new MailError(`Resend respondeu ${resposta.status}: ${corpo.slice(0, 200)}`);
    }
  }
}
