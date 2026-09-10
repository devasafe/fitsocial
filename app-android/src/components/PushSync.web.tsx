// No navegador não há push (ainda). Importar expo-notifications aqui traria o
// módulo inteiro para o bundle web por nada — e é o bundle web que está no ar
// hoje em fit.satriz.club.
export function PushSync() {
  return null;
}
