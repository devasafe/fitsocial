// O pagamento no navegador: mesma aba, sempre.
//
// Ver `checkout.ts` para o porquê de existirem dois arquivos. O resumo é que
// `window.open` depois de um `await` é pop-up bloqueado — e bloqueado em
// silêncio, porque ele devolve `null` em vez de lançar.
//
// Navegar na mesma aba não é bloqueável, e ainda resolve a volta de graça: o
// app recarrega inteiro quando a pessoa volta do gateway, então o estado da
// assinatura é buscado do zero, sem depender de nenhum evento de foco.

/** Manda o navegador para a página de pagamento. */
export function irParaPagamento(url: string): Promise<void> {
  window.location.assign(url);
  // A navegação já começou; esta Promise nunca chega a importar, porque a
  // página está saindo. Resolver é só para o tipo bater com o lado nativo.
  return Promise.resolve();
}
