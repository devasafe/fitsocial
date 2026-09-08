# FitSocial — Segurança e segredos

## Estado atual (verificado)

- `.env` está no `.gitignore` e **não é rastreado** pelo git.
- Não há literais de segredo em arquivos versionados (o `api/.env.example` traz apenas chaves
  vazias e placeholders).
- **Conclusão**: nenhum segredo está no histórico do git. Não há emergência de "segredo
  commitado".

Porém, a senha do usuário do MongoDB Atlas e a `GEMINI_API_KEY` **foram expostas em conversa
de chat** durante o desenvolvimento. Chave que passou por um canal não confiável deve ser
considerada comprometida. Rotacionar é prudente antes do lançamento.

## Checklist de rotação (ação manual do Asafe)

Estes passos exigem acesso a consoles externos — só você pode executá-los. Marque conforme faz:

- [ ] **MongoDB Atlas**: criar/rotacionar a senha do usuário do banco (Database Access →
      editar usuário → nova senha). Atualizar a `MONGODB_URI` na Render.
- [ ] **Google AI Studio**: gerar uma **nova** `GEMINI_API_KEY`
      (https://aistudio.google.com/apikey) e revogar a antiga. Atualizar na Render.
- [ ] **JWT_SECRET**: se o valor de produção já circulou em chat, gerar um novo segredo longo
      e aleatório e atualizar na Render. (Efeito colateral: desloga todo mundo — aceitável
      pré-lançamento.)
- [ ] Confirmar que `api/.env` local continua **fora do git** (`git status` não deve listá-lo).

## Regras permanentes

- Segredo só por variável de ambiente. Nunca no código, nunca em log, nunca em commit.
- Não logar token, senha, e-mail completo, coordenada geográfica nem dado de saúde.
- **Se encontrar um segredo no histórico do git, parar e avisar** antes de qualquer outra ação.
- Uploads de imagem: remover **EXIF** no processamento (fotos de celular carregam GPS) —
  aplicar quando o pipeline de upload/storage for construído (Fase 1).
- Autorização checada em toda rota (dono / seguidor / público / admin), com teste que prove.
- Antes do lançamento: restringir `CORS_ORIGIN` ao domínio real do app (hoje é `*`).
