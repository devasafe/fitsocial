import { env } from "../../config/env.js";
import { MailError, type Mailer, type Mensagem } from "./provider.js";

/**
 * Envio pelo Brevo, por HTTP puro — sem SDK, como o resto do projeto.
 *
 * HTTP e não SMTP pelo mesmo motivo que levou o Drop a essa escolha: hospedagem
 * costuma bloquear porta de saída de SMTP, e a 443 nunca é bloqueada.
 *
 * Atenção operacional: a conta tem allowlist de IP. Se o servidor mudar de
 * endereço, o envio passa a responder 401 com "unrecognised IP address" — e o
 * sintoma aparece como "o código não chega", não como erro de rede.
 */
export class BrevoMailer implements Mailer {
  readonly name = "brevo";

  constructor(
    private readonly apiKey: string,
    private readonly remetenteEmail: string,
    private readonly remetenteNome: string
  ) {}

  async enviar(m: Mensagem): Promise<void> {
    const resposta = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: this.remetenteNome, email: this.remetenteEmail },
        to: [{ email: m.para }],
        subject: m.assunto,
        textContent: m.texto,
        ...(m.html ? { htmlContent: m.html } : {}),
      }),
      // Sem prazo, uma API lenta trava a requisição de quem pediu o código.
      signal: AbortSignal.timeout(env.mailTimeoutMs),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      // A mensagem do Brevo diz exatamente o que está errado (remetente não
      // verificado, IP não autorizado, crédito acabado) — vale preservar.
      throw new MailError(`Brevo respondeu ${resposta.status}: ${corpo.slice(0, 200)}`);
    }
  }
}
