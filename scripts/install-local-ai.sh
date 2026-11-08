#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
OS_NAME="$(uname -o 2>/dev/null || true)"
IS_TERMUX=0
if [ -n "${TERMUX_VERSION:-}" ] || [ "$OS_NAME" = "Android" ]; then IS_TERMUX=1; fi
case "${PREFIX:-}" in
  /data/data/com.termux/files/usr|/data/user/0/com.termux/files/usr) IS_TERMUX=1 ;;
esac
if [ "$IS_TERMUX" -eq 1 ]; then
  echo "Este instalador é para servidores Linux x64/ARM64; Termux nativo usa Android/Bionic." >&2
  echo "Nenhum modelo/runtime será baixado. Use o branch smollm3-3gb somente no servidor Linux após o upgrade." >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "Erro: Node.js 22.8 ou superior é necessário." >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "Erro: instale tar primeiro." >&2; exit 1; }
cd "$ROOT"
exec node scripts/prepare-local-ai.mjs
