import type { Mailer, Mensagem } from "./provider.js";

/**
 * Escreve o e-mail no log em vez de enviar.
 *
 * É o provider de desenvolvimento: sem chave configurada, o fluxo inteiro de
 * "esqueci a senha" continua testável — o código aparece no terminal. Em
 * produção isso seria péssimo (o código de redefinição no log), então o factory
 * recusa usá-lo quando NODE_ENV é production.
 */
export class ConsoleMailer implements Mailer {
  readonly name = "console";

  async enviar(m: Mensagem): Promise<void> {
    console.info(
      `\n[mail] (não enviado — provider de desenvolvimento)\n` +
        `  para: ${m.para}\n  assunto: ${m.assunto}\n${m.texto}\n`
    );
  }
}
