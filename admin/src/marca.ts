/**
 * O nome do produto, num lugar so.
 *
 * Trocar o nome do painel e mudar esta linha, e as constantes equivalentes na
 * API (env.appName) e no app (app-android/marca.js). Sao tres porque os tres
 * Dockerfiles copiam so a propria pasta: um arquivo compartilhado na raiz do
 * repositorio nao existiria dentro do build.
 *
 * A chave "fitsocial.admin.token" do sessionStorage NAO acompanha: trocar
 * derruba a sessao de quem estiver com o painel aberto.
 */
export const MARCA = "FitSocial";
