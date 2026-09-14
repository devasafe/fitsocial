import { Linking } from "react-native";

// Levar a pessoa para a página de pagamento do gateway.
//
// Existe como par `.ts` / `.web.ts` (o padrão do projeto — ver `push.web.ts` e
// `compartilhar.web.ts`) porque o certo a fazer é **oposto** nos dois lados, e
// não porque um deles importe módulo nativo:
//
// - No celular, abrir o navegador de fora é o que se quer: o app continua vivo
//   atrás, e voltar dele é um gesto só.
// - No navegador, abrir OUTRA ABA é o caminho errado. `Linking.openURL` vira
//   `window.open(url, "_blank")` no react-native-web, e pop-up disparado fora
//   do gesto do toque é bloqueado por padrão no Safari e na maior parte das
//   vezes no Chrome. Pior: `window.open` bloqueado devolve `null` sem lançar,
//   então a Promise RESOLVE e o app acha que abriu — a pessoa fica olhando um
//   aviso de "terminando o pagamento" sem que nada tenha aberto.

/** Abre o pagamento no navegador do sistema. Lança se não der. */
export async function irParaPagamento(url: string): Promise<void> {
  await Linking.openURL(url);
}
