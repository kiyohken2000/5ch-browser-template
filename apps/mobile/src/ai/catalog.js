/**
 * モバイルで使うモデル（§9-9）。デスクトップ版 `ai-models.json` のうち端末に載るものだけ。
 * URL と SHA256 は同じ。5GB 以上のモデルは置かない（§12-5）。
 *
 * RAM の段階は FeedOwn の実機実測による。iOS の `Device.totalMemory` は物理 RAM の
 * 約 90% を返すので、しきい値は各クラスのやや下に置く。
 */

export const RAM_TIER = {
  GB4: 3.5 * 1024 ** 3,
  GB6: 5.3 * 1024 ** 3,
  GB8: 7.0 * 1024 ** 3,
}

const RAM_LABEL = new Map([
  [RAM_TIER.GB4, '4'],
  [RAM_TIER.GB6, '6'],
  [RAM_TIER.GB8, '8'],
])

const HF = 'https://huggingface.co'

export const AI_MODELS = [
  {
    id: 'lfm2-5-1.2b-jp-q4km',
    name: 'LFM2.5 1.2B JP',
    note: '最軽量。日本語の要約向け',
    sizeBytes: 730894624,
    url: `${HF}/LiquidAI/LFM2.5-1.2B-JP-202606-GGUF/resolve/main/LFM2.5-1.2B-JP-202606-Q4_K_M.gguf`,
    sha256: '23d4d4060cb06463563f6e8644bbbc7d1cb0bfe4cf21d5edf3ccc6f515fd44bb',
    minRam: RAM_TIER.GB4,
    uses: ['general'],
  },
  {
    id: 'gemma3-1b-it-q4km',
    name: 'Gemma 3 1B',
    note: '軽量。要約に',
    sizeBytes: 806058272,
    url: `${HF}/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf`,
    sha256: '8270790f3ab69fdfe860b7b64008d9a19986d8df7e407bb018184caa08798ebd',
    minRam: RAM_TIER.GB4,
    // 曖昧 NG には使わない。確率が飽和して、ほとんどのレスを該当にする（実測）
    uses: ['general'],
  },
  {
    id: 'qwen35-2b-q4km',
    name: 'Qwen3.5 2B',
    note: '少し賢い。要約と曖昧 NG に',
    sizeBytes: 1280835840,
    url: `${HF}/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf`,
    sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
    minRam: RAM_TIER.GB4,
    uses: ['general', 'ng'],
  },
  {
    id: 'hy-mt2-1.8b-q4km',
    name: 'Hy-MT2 1.8B',
    note: '翻訳専用',
    sizeBytes: 1133080448,
    url: `${HF}/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf`,
    sha256: 'dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699',
    minRam: RAM_TIER.GB4,
    uses: ['translation'],
  },
  {
    id: 'qwen35-4b-q4km',
    name: 'Qwen3.5 4B',
    note: '高精度。8GB 以上の端末向け',
    sizeBytes: 2740937888,
    url: `${HF}/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf`,
    sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
    minRam: RAM_TIER.GB8,
    uses: ['general', 'ng'],
  },
]

export function findModel(id) {
  return AI_MODELS.find((m) => m.id === id) || null
}

/** 端末の RAM で動かせるか。分からない端末では動かさない（落ちるより安全）。 */
export function canRunOnDevice(model, ramBytes) {
  if (!model) return { ok: false, reason: 'モデルがありません' }
  if (ramBytes === null || ramBytes === undefined) {
    return { ok: false, reason: '端末のメモリ量が分かりません' }
  }
  if (ramBytes < model.minRam) {
    const need = RAM_LABEL.get(model.minRam)
    const have = (ramBytes / 1024 ** 3).toFixed(1)
    return {
      ok: false,
      reason: `${need}GB 以上のメモリが必要です（この端末: ${have}GB）`,
    }
  }
  return { ok: true }
}

export function formatModelSize(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
