#!/usr/bin/env bash
# [N23] 曖昧 NG の判定器 (ゼロショット NLI 分類器) を GGUF に変換する。
#
# 変換元: MoritzLaurer/bge-m3-zeroshot-v2.0 (MIT, XLMRobertaForSequenceClassification,
#         XLM-RoBERTa-large 568M, 多言語, id2label = {0: entailment, 1: not_entailment})
# 出力:   <outdir>/bge-m3-zeroshot-v2.0-f16.gguf と -Q4_K_M.gguf、それぞれの sha256
#
# GGUF が公開されていないため自前で変換する。llama.cpp の conversion/bert.py が
# XLMRobertaForSequenceClassification に対応しており、config.json の id2label が
# そのまま GGUF の bert.classifier.output_labels になる (= ロード時に n_cls_out=2)。
#
#   bash scripts/convert_nli_model.sh [outdir]
#
# 必要なもの: python3, git, cmake + C++ コンパイラ (llama-quantize のビルド用)。
# llama-quantize が PATH にあればビルドを飛ばす。
# 所要: ダウンロード 1.1 GB + ビルド数分。作業ディレクトリは outdir/work。
set -euo pipefail

OUT_DIR="${1:-out/nli-model}"
# 変換元のリビジョンを固定する。重みが差し替わると sha256 が変わるため。
SRC_REPO="MoritzLaurer/bge-m3-zeroshot-v2.0"
SRC_REV="9abf1c8aaeb82a2447809c20753ed0b106b76652"
# 変換に使った llama.cpp。conversion/ パッケージ分割後のツリーが必要。
LLAMA_REF="master"

mkdir -p "$OUT_DIR"
WORK="$OUT_DIR/work"
mkdir -p "$WORK"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
WORK="$(cd "$WORK" && pwd)"

echo "============================================"
echo " NLI 判定器の GGUF 変換"
echo "   src   : $SRC_REPO @ ${SRC_REV:0:12}"
echo "   outdir: $OUT_DIR"
echo "============================================"

# --- 1. Python 環境 -----------------------------------------------------------
VENV="$WORK/venv"
if [ ! -x "$VENV/Scripts/python.exe" ] && [ ! -x "$VENV/bin/python" ]; then
  echo "[1/5] venv を作る"
  python -m venv "$VENV"
else
  echo "[1/5] venv は既にある"
fi
if [ -x "$VENV/Scripts/python.exe" ]; then PY="$VENV/Scripts/python.exe"; else PY="$VENV/bin/python"; fi
# convert_hf_to_gguf.py が torch を無条件に import する。CPU ホイールで足りる。
"$PY" -m pip install -q --disable-pip-version-check torch --index-url https://download.pytorch.org/whl/cpu
"$PY" -m pip install -q --disable-pip-version-check safetensors sentencepiece protobuf transformers

# --- 2. llama.cpp ------------------------------------------------------------
LC="$WORK/llama.cpp"
if [ ! -d "$LC/.git" ]; then
  echo "[2/5] llama.cpp を取得する"
  # tools/ui の下にとても深いパスがあり、Windows では MAX_PATH でチェックアウトが
  # 途中で死ぬ (vendor/ が作られないまま configure が失敗する)。longpaths を先に立てる。
  git init -q "$LC"
  git -C "$LC" config core.longpaths true
  git -C "$LC" remote add origin https://github.com/ggml-org/llama.cpp
  git -C "$LC" fetch -q --depth 1 origin "$LLAMA_REF"
  git -C "$LC" checkout -q FETCH_HEAD
else
  echo "[2/5] llama.cpp は既にある"
fi
echo "      llama.cpp: $(git -C "$LC" rev-parse --short HEAD)"

# --- 3. 重みの取得 -----------------------------------------------------------
SRC="$WORK/hf"
mkdir -p "$SRC"
echo "[3/5] 重みとトークナイザを取得する"
for f in config.json model.safetensors sentencepiece.bpe.model special_tokens_map.json tokenizer.json tokenizer_config.json; do
  if [ -s "$SRC/$f" ]; then
    echo "      skip $f"
    continue
  fi
  echo "      get  $f"
  curl -fsSL -o "$SRC/$f" "https://huggingface.co/$SRC_REPO/resolve/$SRC_REV/$f"
done

# --- 4. F16 GGUF -------------------------------------------------------------
F16="$OUT_DIR/bge-m3-zeroshot-v2.0-f16.gguf"
if [ -s "$F16" ]; then
  echo "[4/5] F16 は既にある"
else
  echo "[4/5] F16 GGUF に変換する"
  "$PY" "$LC/convert_hf_to_gguf.py" "$SRC" --outfile "$F16" --outtype f16
fi

# --- 5. Q4_K_M ---------------------------------------------------------------
Q4="$OUT_DIR/bge-m3-zeroshot-v2.0-Q4_K_M.gguf"
QUANT="$(command -v llama-quantize || true)"
if [ -z "$QUANT" ]; then
  QUANT="$(find "$LC/build" -name 'llama-quantize*' -type f -perm -u+x 2>/dev/null | head -1 || true)"
fi
if [ -z "$QUANT" ]; then
  echo "[5/5] llama-quantize をビルドする"
  cmake -S "$LC" -B "$LC/build" -DCMAKE_BUILD_TYPE=Release \
    -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF -DGGML_VULKAN=OFF
  cmake --build "$LC/build" --target llama-quantize --config Release -j "${JOBS:-6}"
  QUANT="$(find "$LC/build" -name 'llama-quantize*' -type f -perm -u+x | head -1)"
fi
echo "[5/5] Q4_K_M に量子化する ($QUANT)"
if [ -s "$Q4" ]; then
  echo "      Q4_K_M は既にある"
else
  "$QUANT" "$F16" "$Q4" Q4_K_M
fi

echo
echo "============================================"
for f in "$F16" "$Q4"; do
  echo "$(basename "$f")"
  echo "  size   $(wc -c < "$f")"
  echo "  sha256 $(sha256sum "$f" | cut -d' ' -f1)"
done
echo "============================================"
echo "ai-models.json には Q4_K_M の url / sizeBytes / sha256 を書く。"
