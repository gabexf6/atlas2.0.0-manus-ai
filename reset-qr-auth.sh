#!/usr/bin/env bash
set -euo pipefail

AUTH_DIR="assets/auth/zapo"

if [[ ! -d "assets" || ! -d "src" ]]; then
  echo "Execute este script na raiz do Atlas."
  exit 1
fi

if [[ ! -d "$AUTH_DIR" ]]; then
  echo "A sessão Zapo já está limpa ou ainda não foi criada: $AUTH_DIR"
  exit 0
fi

read -r -p "Remover a sessão Zapo e exigir novo pareamento? (s/N): " confirm
case "$confirm" in
  [sS]|[sS][iI][mM])
    rm -rf "$AUTH_DIR"
    echo "Sessão Zapo removida. Execute npm start para parear novamente."
    ;;
  *)
    echo "Operação cancelada."
    ;;
esac
