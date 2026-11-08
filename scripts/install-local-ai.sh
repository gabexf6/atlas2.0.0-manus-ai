#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
MODEL_DIR="$ROOT/models"
BIN_DIR="$ROOT/bin"
MODEL_FILE="$MODEL_DIR/Qwen_Qwen3-0.6B-Q3_K_S.gguf"
MODEL_PART="$MODEL_FILE.part"
MODEL_URL="https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q3_K_S.gguf"
LLAMA_TAG="b12110"
LLAMA_BASE="https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG"
MIN_MODEL_BYTES=350000000
MAX_MODEL_BYTES=420000000

command -v curl >/dev/null 2>&1 || { echo "Erro: instale curl primeiro." >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "Erro: instale tar primeiro." >&2; exit 1; }

OS_NAME="$(uname -o 2>/dev/null || true)"
IS_TERMUX=0
if [ -n "${TERMUX_VERSION:-}" ] || [ "$OS_NAME" = "Android" ]; then IS_TERMUX=1; fi
case "${PREFIX:-}" in
  /data/data/com.termux/files/usr|/data/user/0/com.termux/files/usr) IS_TERMUX=1 ;;
esac
if [ "$IS_TERMUX" -eq 1 ]; then
  echo "Este instalador é para servidores Linux com glibc; Termux nativo usa Android/Bionic e não pode executar o pacote Ubuntu ARM64." >&2
  echo "Nenhum runtime nem modelo será baixado. Para testar llama.cpp no Termux, siga o build Android oficial: https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md" >&2
  echo "Rode este instalador no servidor Linux do Atlas; o teste no Termux não determina a compatibilidade do host." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64) ARCHIVE="llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz" ;;
  aarch64|arm64) ARCHIVE="llama-${LLAMA_TAG}-bin-ubuntu-arm64.tar.gz" ;;
  *)
    echo "Arquitetura não suportada: $(uname -m). Compatíveis: x86_64 e aarch64." >&2
    exit 1
    ;;
esac

mkdir -p "$MODEL_DIR" "$BIN_DIR"
AVAILABLE_KB="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
NEED_KB=0
MODEL_BYTES=0
if [ -s "$MODEL_FILE" ]; then MODEL_BYTES="$(stat -c '%s' "$MODEL_FILE" 2>/dev/null || wc -c < "$MODEL_FILE")"; fi
PART_BYTES=0
if [ -s "$MODEL_PART" ]; then PART_BYTES="$(stat -c '%s' "$MODEL_PART" 2>/dev/null || wc -c < "$MODEL_PART")"; fi
if { [ "$MODEL_BYTES" -lt "$MIN_MODEL_BYTES" ] || [ "$MODEL_BYTES" -gt "$MAX_MODEL_BYTES" ]; } && \
   { [ "$PART_BYTES" -lt "$MIN_MODEL_BYTES" ] || [ "$PART_BYTES" -gt "$MAX_MODEL_BYTES" ]; }; then
  NEED_KB=$((NEED_KB + 410000))
fi
[ -x "$BIN_DIR/llama-server" ] || NEED_KB=$((NEED_KB + 70000))
if [ "$AVAILABLE_KB" -lt "$NEED_KB" ]; then
  echo "Espaço insuficiente. Disponível: ${AVAILABLE_KB} KB; necessário estimado: ${NEED_KB} KB." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "$ROOT/.atlas-ai-install.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [ ! -x "$BIN_DIR/llama-server" ]; then
  echo "Baixando runtime CPU oficial do llama.cpp ($LLAMA_TAG, $ARCHIVE)..."
  curl --fail --location --retry 3 --retry-delay 2 --connect-timeout 20 \
    "$LLAMA_BASE/$ARCHIVE" -o "$TMP_DIR/llama-runtime.tar.gz"
  mkdir -p "$TMP_DIR/runtime"
  tar -xzf "$TMP_DIR/llama-runtime.tar.gz" -C "$TMP_DIR/runtime"
  SERVER_SOURCE="$(find "$TMP_DIR/runtime" -type f -name llama-server -perm -u+x -print -quit)"
  if [ -z "$SERVER_SOURCE" ]; then
    echo "O pacote oficial não contém um executável llama-server; nada foi instalado." >&2
    exit 1
  fi

  RUNTIME_DEST="$BIN_DIR/llama-$LLAMA_TAG"
  rm -rf "$RUNTIME_DEST"
  mv "$TMP_DIR/runtime" "$RUNTIME_DEST"
  SERVER_SOURCE="$(find "$RUNTIME_DEST" -type f -name llama-server -perm -u+x -print -quit)"
  printf '#!/usr/bin/env sh\nexec "%s" "$@"\n' "$SERVER_SOURCE" > "$BIN_DIR/llama-server"
  chmod 755 "$BIN_DIR/llama-server"
  if ! "$BIN_DIR/llama-server" --version >"$TMP_DIR/llama-version.log" 2>&1; then
    cat "$TMP_DIR/llama-version.log" >&2 || true
    rm -f "$BIN_DIR/llama-server"
    echo "O binário CPU baixado não iniciou nesta distribuição. A mensagem acima indica a causa; confira arquitetura, glibc e bibliotecas do sistema." >&2
    exit 1
  fi
else
  echo "Runtime llama-server já existe; mantendo o arquivo atual."
fi

if [ "$MODEL_BYTES" -ge "$MIN_MODEL_BYTES" ] && [ "$MODEL_BYTES" -le "$MAX_MODEL_BYTES" ]; then
  echo "GGUF existente e dentro do tamanho esperado; mantendo."
elif [ "$PART_BYTES" -ge "$MIN_MODEL_BYTES" ] && [ "$PART_BYTES" -le "$MAX_MODEL_BYTES" ]; then
  mv "$MODEL_PART" "$MODEL_FILE"
  MODEL_BYTES="$PART_BYTES"
  echo "Concluindo instalação de um GGUF que já estava baixado."
else
  if [ "$PART_BYTES" -gt "$MAX_MODEL_BYTES" ]; then rm -f "$MODEL_PART"; fi
  echo "Baixando Qwen3-0.6B GGUF Q3_K_S (~390 MB). A transferência pode demorar..."
  curl --fail --location --retry 3 --retry-delay 2 --connect-timeout 20 \
    --continue-at - "$MODEL_URL" -o "$MODEL_PART"
  MODEL_BYTES="$(stat -c '%s' "$MODEL_PART" 2>/dev/null || wc -c < "$MODEL_PART")"
  if [ "$MODEL_BYTES" -lt "$MIN_MODEL_BYTES" ] || [ "$MODEL_BYTES" -gt "$MAX_MODEL_BYTES" ]; then
    echo "Tamanho inesperado do GGUF ($MODEL_BYTES bytes); arquivo não instalado." >&2
    exit 1
  fi
  mv "$MODEL_PART" "$MODEL_FILE"
fi

MODEL_BYTES="$(stat -c '%s' "$MODEL_FILE" 2>/dev/null || wc -c < "$MODEL_FILE")"
printf '\nInstalação concluída. Runtime: %s\nModelo: %s (%s bytes)\n' \
  "$BIN_DIR/llama-server" "$MODEL_FILE" "$MODEL_BYTES"
printf 'O Atlas carrega o modelo somente no primeiro pedido de IA e o descarrega após 2 minutos sem uso.\n'
printf 'A configuração padrão usa contexto 1024, 1 thread e 1 slot.\n'
