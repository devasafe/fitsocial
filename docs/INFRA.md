# FitSocial — Infraestrutura (Coolify)

> Operação do que está no ar. Arquitetura de software: [`ARQUITETURA.md`](./ARQUITETURA.md).
> **Nenhum segredo mora aqui.** Senhas e chaves ficam nas env do Coolify e no gerenciador
> de senhas do Asafe. Rotação: [`SECURITY.md`](./SECURITY.md).

Migração de Render + Vercel + Atlas para a VPS executada em **09/09/2026**.

## Mapa

```
                     Traefik (Coolify) — HTTPS automático
                                │
   ┌───────────────┬────────────┴───────┬──────────────────┐
fit.satriz.club  fitapi.satriz.club  fitcdn.satriz.club  fitminio.satriz.club
  [ web ]          [ api ]            [ minio :9000 ]     [ console :9001 ]
 Expo estático    Express :4000          objetos            administração
   + Caddy             │                    ▲
                       │  rede docker       │ http://minio-fitsocial:9000
                       ├────────────────────┘
                       │
              mongodb-fitsocial:27017  ← volume persistente, sem porta pública
```

| Recurso | Nome no Coolify | Como é buildado |
|---|---|---|
| API | `FITSOCIAL BACKEND` | Dockerfile, base `/api`, porta 4000 |
| Web | `FITSOCIAL FRONTEND` | Dockerfile, base `/app-android`, porta 3000 |
| Storage | `minio-fitsocial` | Dockerfile inline sobre `minio/minio` |
| Banco | `mongodb-fitsocial` | MongoDB 7 gerenciado pelo Coolify |
| Painel | `FITSOCIAL ADMIN` | Dockerfile, base `/admin`, porta 3000 |

Projeto `FitSocial`, environment `production`, servidor `Satriz Club`.
Deploy é por push na branch `main` do repositório `devasafe/fitsocial`.

## Armadilhas (custaram tempo; não repita)

1. **`custom_docker_run_options` com `-v` é ignorado.** O Coolify aceita o campo, salva o
   valor e **não monta nada**. O MinIO rodou sem volume e perdeu bucket, policy e credencial
   no primeiro restart. Volume só vale se declarado como *persistent storage* do recurso.
   Depois de criar, **prove com um restart** antes de confiar.

2. **`start_command` não é aplicado em app de imagem Docker.** A imagem `minio/minio` exige
   o subcomando `server`; sem ele o container imprime o help e morre. Solução: Dockerfile
   inline com `CMD` explícito.

3. **A porta no domínio some do FQDN, mas define o roteamento.** Ao salvar
   `https://fitcdn.satriz.club:9000`, o painel exibe o domínio sem a porta — porém é assim
   que o Traefik aprende qual porta serve cada domínio. Sem a porta, todos os domínios do
   recurso caem na primeira. Confira nas labels, não no campo FQDN.

4. **O healthcheck roda dentro do container e precisa de `curl`.** Imagens slim/alpine não
   trazem. Sem ele o deploy é revertido mesmo com a aplicação de pé — por isso os dois
   Dockerfiles instalam `curl`.

5. **Cada variável tem um par produção/preview.** A listagem mostrar duas entradas da mesma
   chave é o normal; não é duplicata para limpar.

6. **`EXPO_PUBLIC_API_URL` é build-time.** O Expo inlina o valor no bundle. Tem que estar
   marcada como *build variable*, senão a web compila apontando para `localhost` e falha
   em silêncio — a página carrega, só nenhuma chamada funciona.
   **`VITE_API_URL` do painel tem exatamente o mesmo comportamento.** Mesma armadilha,
   mesmo sintoma, duas vezes.

7. **`CORS_ORIGIN` agora é lista.** Com o painel no ar são duas origens; esquecer a
   segunda dá erro de CORS no navegador sem nada aparecer no log da API:
   `CORS_ORIGIN=https://fit.satriz.club,https://admin.fit.satriz.club`

## Trocar para um domínio próprio

`satriz.club` é provisório. Para migrar, nenhum código muda:

1. DNS: `A` para o IP da VPS, **proxy desligado** na Cloudflare (com a nuvem laranja o
   Let's Encrypt não emite). Depois de emitido, dá para religar com SSL *Full (strict)*.
2. Trocar o domínio de cada recurso no Coolify.
3. Atualizar as env: `CORS_ORIGIN` e `MEDIA_PUBLIC_BASE_URL` na API,
   `EXPO_PUBLIC_API_URL` na web (build variable), `MINIO_SERVER_URL` e
   `MINIO_BROWSER_REDIRECT_URL` no MinIO.
4. Redeployar a web — o domínio novo só entra no bundle num build novo.

## Backup

Backup diário do Mongo às 4h, configurado no próprio recurso. **Sem o Atlas, o backup é
responsabilidade nossa**: confirme periodicamente que os arquivos estão sendo gerados, e
tente uma restauração de verdade pelo menos uma vez — backup nunca restaurado não conta.

## Painel administrativo

Fica em `admin.fit.satriz.club`, separado do app. Quem entra precisa de duas coisas:
o papel `admin` no usuário **e** uma sessão criada pelo próprio painel. O token de 30 dias
do aplicativo é recusado ali de propósito — perder o celular não pode significar perder o
painel. A sessão do painel dura 12 horas.

O primeiro admin nasce por linha de comando, dentro do container da API:

```bash
npm run admin:grant -- --email=voce@exemplo.com     # promove
npm run admin:grant -- --email=voce@exemplo.com --revoke   # rebaixa
```

O script se recusa a criar um segundo admin sem `--force`, e a rebaixar o último admin sem
`--force` — sem admin nenhum, só a linha de comando devolve o acesso. Toda ação
administrativa fica registrada em `AdminAudit`, com o e-mail mascarado.

## Rotina

- **Logs**: aba Logs do recurso no Coolify.
- **Console do MinIO**: `fitminio.satriz.club`, com as credenciais root (não são as que a
  API usa — ela tem chave própria, restrita ao bucket `fotos`).
- **Acesso ao Mongo de fora**: por padrão fechado. Para manutenção, abra `is_public`
  temporariamente e **feche ao terminar**.

## Backup do Mongo — verificado em 09/09/2026

O backup do `mongodb-fitsocial` (`0 4 * * *`, diário às 04:00) **funciona**. Provado
acelerando o agendamento para `* * * * *` pela API do Coolify e conferindo as execuções:
5 rodadas, todas `success`, produzindo `mongo-dump-fitsocial-<epoch>.tar.gz` de ~27 KB.
O agendamento foi restaurado em seguida.

Duas armadilhas encontradas no caminho:

- `GET /api/v1/databases/{uuid}/backups/{backup_uuid}` **não traz** `executions`. Só a
  listagem (`.../backups`) traz. Consultar o endpoint de detalhe faz parecer que nada
  rodou.
- A listagem parece ignorar o `uuid` do banco: pedir os backups do `drop_marketplace`
  devolveu o backup do FitSocial. O painel é a fonte de verdade sobre qual backup é de
  qual banco.

### O que ainda não está resolvido

- **`save_s3: false`** — a cópia fica na mesma VPS que o banco. Se a máquina morrer, o
  backup morre junto. Mandar para o MinIO local **não** resolve: mesmo servidor, mesmo
  incêndio. Precisa de um destino fora daqui (R2, S3, Backblaze).
- **`missing_backup_notification_days: 0`** — se o backup parar de rodar, ninguém fica
  sabendo.
- **Restauração nunca ensaiada.** Sabemos que o arquivo é gerado; não sabemos que ele
  volta. Exige baixar um `.tar.gz` pelo painel e rodar `mongorestore` contra um Mongo
  descartável.
