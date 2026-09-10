/**
 * O nome do produto, num lugar só.
 *
 * O valor mora em `app-android/marca.js` porque o carregador de configuração
 * do Expo (app.config.js) não consegue importar TypeScript — e o nome que
 * aparece embaixo do ícone no celular precisa sair do mesmo lugar que o resto.
 *
 * Trocar o nome do app é mudar aquela linha, e as constantes equivalentes na
 * API (env.appName) e no painel (admin/src/marca.ts). São três porque os três
 * Dockerfiles copiam só a própria pasta: um arquivo na raiz do repositório não
 * existiria dentro do build.
 *
 * O que NÃO muda junto, de propósito:
 *
 * - o package Android `club.satriz.fitsocial` — trocar faz quem já tem o app
 *   instalar um app SEPARADO, com os dados do antigo inacessíveis;
 * - o `slug` e o `scheme` do Expo — o slug amarra o projeto no EAS, o scheme
 *   amarra os links que já foram enviados por aí;
 * - as chaves "fitsocial.*" de AsyncStorage — trocar derruba a sessão de todo
 *   mundo e apaga os rascunhos salvos;
 * - o projeto no Firebase.
 *
 * Esses são identificadores, não nome. Quando o nome novo estiver decidido e
 * for hora da Play Store, a migração deles é um trabalho próprio.
 */
import { MARCA as NOME } from "../marca";

export const MARCA: string = NOME;
