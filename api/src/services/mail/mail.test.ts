import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getMailer, setMailer, MailError } from "./index.js";
import { BrevoMailer } from "./brevo.js";
import { env } from "../../config/env.js";

const original = { brevo: env.brevoApiKey, resend: env.resendApiKey, prod: env.isProd };

beforeEach(() => setMailer(null));

afterEach(() => {
  setMailer(null);
  Object.assign(env, { brevoApiKey: original.brevo, resendApiKey: original.resend, isProd: original.prod });
  vi.unstubAllGlobals();
});

describe("Escolha do provider", () => {
  it("prefere o Brevo quando as duas chaves existem", () => {
    Object.assign(env, { brevoApiKey: "b", resendApiKey: "r" });
    // É o provider que a casa já usa, com IP da VPS já autorizado lá.
    expect(getMailer().name).toBe("brevo");
  });

  it("cai na Resend quando só ela está configurada", () => {
    Object.assign(env, { brevoApiKey: "", resendApiKey: "r" });
    expect(getMailer().name).toBe("resend");
  });

  it("usa o console em desenvolvimento, sem chave nenhuma", () => {
    Object.assign(env, { brevoApiKey: "", resendApiKey: "", isProd: false });
    expect(getMailer().name).toBe("console");
  });

  it("RECUSA subir em produção sem chave", () => {
    Object.assign(env, { brevoApiKey: "", resendApiKey: "", isProd: true });
    // Código de redefinição de senha no log da aplicação é porta aberta, e
    // "funciona mas não envia" é pior que um erro claro.
    expect(() => getMailer()).toThrow(MailError);
  });
});

describe("Envio pelo Brevo", () => {
  it("manda texto e HTML, com remetente e destinatário certos", async () => {
    const chamadas: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      chamadas.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 201, text: async () => "" };
    });

    await new BrevoMailer("chave", "nao-responda@satriz.club", "FitSocial").enviar({
      para: "pessoa@teste.com",
      assunto: "123456 é seu código",
      texto: "código: 123456",
      html: "<p>123456</p>",
    });

    expect(chamadas[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(chamadas[0].body).toMatchObject({
      sender: { name: "FitSocial", email: "nao-responda@satriz.club" },
      to: [{ email: "pessoa@teste.com" }],
      textContent: "código: 123456",
    });
  });

  it("transforma recusa do Brevo em MailError com o motivo", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 401,
      text: async () => '{"message":"unrecognised IP address 1.2.3.4","code":"unauthorized"}',
    }));

    const envio = new BrevoMailer("chave", "x@y.com", "FitSocial").enviar({
      para: "a@b.com",
      assunto: "s",
      texto: "t",
    });

    // O sintoma de IP não autorizado é "o código não chega". A mensagem do
    // Brevo é o que aponta a causa — perdê-la custaria horas de investigação.
    await expect(envio).rejects.toThrow(/unrecognised IP/);
  });
});
