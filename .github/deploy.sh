#!/usr/bin/env bash
# Dispara o deploy de uma app no Coolify e ESPERA o resultado.
#
# Disparar e seguir em frente não serve: a API devolve "queued" na hora, e um
# build que falha deixa o container antigo servindo 200 em /health. Sem esperar
# e conferir o commit, o workflow ficaria verde enquanto a produção continuava
# com o código velho — que é exatamente a confusão que este arquivo existe para
# acabar.
#
# O parse é com `jq`, e não com grep, por um motivo concreto: a resposta traz um
# campo `logs` que é uma string de JSON com os passos do build DENTRO dela, e lá
# aparecem outros `"status"`. Um `grep | tail -1` pega o do log em vez do
# deployment, e aí o CI aprova um deploy que falhou.
#
# Uso: ./.github/deploy.sh <uuid> "<nome legivel>"

set -euo pipefail

uuid="${1:?uuid da aplicacao}"
nome="${2:-$uuid}"
base="${COOLIFY:-https://deploy.satriz.club}"
esperado="${GITHUB_SHA:-}"

: "${COOLIFY_TOKEN:?defina o secret COOLIFY_TOKEN no repositorio}"
command -v jq >/dev/null || { echo "::error::jq nao encontrado no runner"; exit 1; }

api() {
  curl -sS --max-time 60 -H "Authorization: Bearer $COOLIFY_TOKEN" -H "Accept: application/json" "$@"
}

echo "::group::$nome — disparando"
resposta=$(api -X POST "$base/api/v1/deploy?uuid=$uuid")
echo "$resposta"
echo "::endgroup::"

deployment=$(printf '%s' "$resposta" | jq -r '.deployments[0].deployment_uuid // empty')
if [ -z "$deployment" ]; then
  echo "::error::$nome — o Coolify nao devolveu deployment_uuid. Token invalido, sem permissao, ou uuid errado."
  exit 1
fi
echo "$nome — deployment $deployment"

# 40 minutos de teto: o export do Expo é lento, mas não é infinito.
status=""
for _ in $(seq 1 160); do
  detalhe=$(api "$base/api/v1/deployments/$deployment")
  status=$(printf '%s' "$detalhe" | jq -r '.status // empty')

  case "$status" in
    finished)
      commit=$(printf '%s' "$detalhe" | jq -r '.commit // empty')
      echo "$nome — finished, commit $commit"
      # A prova de que subiu o que ESTE push mandou, e não um build anterior que
      # estava na fila. "HEAD" aparece enquanto o Coolify ainda não resolveu o
      # commit, e nesse caso não há o que comparar.
      if [ -n "$esperado" ] && [ -n "$commit" ] && [ "$commit" != "HEAD" ] && [ "$commit" != "$esperado" ]; then
        echo "::error::$nome — subiu o commit $commit, e este push e $esperado"
        exit 1
      fi
      exit 0
      ;;
    failed|cancelled-by-user)
      echo "::error::$nome — deploy terminou como '$status'. Log em $base"
      exit 1
      ;;
    "")
      echo "::warning::$nome — resposta sem status; tentando de novo"
      ;;
  esac
  sleep 15
done

echo "::error::$nome — passou de 40 minutos sem terminar (ultimo status: '${status:-desconhecido}')"
exit 1
