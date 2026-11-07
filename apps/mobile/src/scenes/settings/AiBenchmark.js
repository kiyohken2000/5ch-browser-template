/**
 * AI のベンチマーク。画面の組み立ては FeedOwn の Benchmark に揃える。
 * 端末 → 測るモデル（チェックで複数選ぶ）→ 実行 → 結果（コピー / 消去）の順に並ぶ。
 * AI の設定画面から開く。
 */

import * as Clipboard from 'expo-clipboard'
import * as Device from 'expo-device'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { runBenchmark, stopBenchmark } from 'ai/benchmark'
import { AI_MODELS, findModel, formatModelSize } from 'ai/catalog'
import { isModelInstalled } from 'ai/download'
import { benchmarkReportText, benchmarkScore } from 'lib/benchmarkScore'
import { KEYS, load, save } from 'lib/storage'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'

function resultLines(r) {
  const lines = [`読み込み ${(r.loadMs / 1000).toFixed(1)} 秒`]
  if (r.summary) {
    lines.push(
      `要約 ${(r.summary.totalMs / 1000).toFixed(1)} 秒: 入力 ${
        r.summary.promptPerSec
      } t/s（${r.summary.promptTokens} トークン）、生成 ${
        r.summary.predictedPerSec
      } t/s`,
    )
  }
  if (r.translation) {
    lines.push(
      `翻訳 ${(r.translation.totalMs / 1000).toFixed(1)} 秒: 生成 ${
        r.translation.predictedPerSec
      } t/s`,
    )
  }
  if (r.judge) {
    lines.push(
      `曖昧 NG ${r.judge.correct}/${r.judge.total} 正解、1 件 ${r.judge.msPerItem} ms`,
      `確率の平均: 該当 ${r.judge.meanA} / 非該当 ${r.judge.meanB}、幅 ${
        r.judge.spread
      }${r.judge.usable ? '' : '（見分けられていない）'}`,
    )
  }
  if (r.stopped) lines.push('途中で止めました')
  return lines
}

function Info({ label, value, theme }) {
  return (
    <View style={styles.infoRow}>
      <Text style={{ color: theme.textDim, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: 13 }}>{value}</Text>
    </View>
  )
}

export default function AiBenchmark() {
  const theme = useEmberTheme()
  const [installed, setInstalled] = useState([])
  const [checked, setChecked] = useState(new Set())
  const [results, setResults] = useState({})
  const [running, setRunning] = useState(null)
  const [phase, setPhase] = useState('')
  const cancelled = useRef(false)

  const ram = Device.totalMemory
    ? `${(Device.totalMemory / 1024 ** 3).toFixed(1)} GB`
    : '不明'
  const device = {
    model: Device.modelName || '不明',
    os: `${Device.osName || ''} ${Device.osVersion || ''}`.trim() || '不明',
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const flags = await Promise.all(AI_MODELS.map(isModelInstalled))
      const saved = await load(KEYS.aiBenchmark, {})
      if (!alive) return
      setInstalled(AI_MODELS.filter((_, i) => flags[i]))
      setResults(saved && typeof saved === 'object' ? saved : {})
    })().catch((e) =>
      console.warn(`[benchmark] 読み込みに失敗: ${e?.message || e}`),
    )
    return () => {
      alive = false
      cancelled.current = true
      // 画面を離れたら止める
      stopBenchmark()
    }
  }, [])

  const toggle = (id) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const persist = (next) => {
    save(KEYS.aiBenchmark, next).then((ok) => {
      if (!ok) console.warn('[benchmark] 結果の保存に失敗した')
    })
  }

  const runAll = useCallback(async () => {
    cancelled.current = false
    const targets = installed.filter((m) => checked.has(m.id))
    for (const model of targets) {
      if (cancelled.current) break
      setRunning(model.id)
      setPhase(`${model.name}: モデルを読み込んでいます`)
      try {
        // 順に測る。同時に載せるとメモリが足りない
        // eslint-disable-next-line no-await-in-loop
        const result = await runBenchmark(model, (text) =>
          setPhase(`${model.name}: ${text}`),
        )
        setResults((prev) => {
          const next = { ...prev, [model.id]: result }
          persist(next)
          return next
        })
        if (result.stopped) break
      } catch (e) {
        console.warn(`[benchmark] 失敗: ${model.id}: ${e?.message || e}`)
        showToast({ title: `${model.name} を測れませんでした` })
      }
    }
    setRunning(null)
    setPhase('')
  }, [installed, checked])

  const stop = () => {
    cancelled.current = true
    stopBenchmark()
  }

  const resultIds = Object.keys(results).filter((id) => findModel(id))

  const copyAll = useCallback(async () => {
    const text = benchmarkReportText(
      `${device.model} / ${device.os} / RAM ${ram}`,
      resultIds.map((id) => ({
        name: findModel(id).name,
        score: benchmarkScore(results[id]),
        lines: resultLines(results[id]),
      })),
    )
    try {
      await Clipboard.setStringAsync(text)
      showToast({ title: '結果をコピーしました' })
    } catch (e) {
      console.warn(`[benchmark] コピーに失敗: ${e?.message || e}`)
    }
  }, [device.model, device.os, ram, resultIds, results])

  const clearAll = () => {
    setResults({})
    persist({})
  }

  const isRunning = running !== null

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.section, { color: theme.textDim }]}>端末</Text>
      <View style={[styles.box, { backgroundColor: theme.surface }]}>
        <Info label="機種" value={device.model} theme={theme} />
        <Info label="OS" value={device.os} theme={theme} />
        <Info label="RAM" value={ram} theme={theme} />
      </View>

      <View style={styles.sectionRow}>
        <Text style={[styles.sectionInline, { color: theme.textDim }]}>
          測るモデル
        </Text>
        {installed.length > 0 && !isRunning ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="すべて選ぶ"
              hitSlop={8}
              onPress={() => setChecked(new Set(installed.map((m) => m.id)))}
            >
              <Text style={{ color: theme.accent, fontSize: 12 }}>
                すべて選ぶ
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="選択を解除"
              hitSlop={8}
              onPress={() => setChecked(new Set())}
            >
              <Text style={{ color: theme.textDim, fontSize: 12 }}>解除</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      <View style={[styles.box, { backgroundColor: theme.surface }]}>
        {installed.length === 0 ? (
          <Text style={{ color: theme.textDim, fontSize: 13 }}>
            AI の設定でモデルを入手すると、ここで測れます
          </Text>
        ) : null}
        {installed.map((model) => {
          const on = checked.has(model.id)
          return (
            <Pressable
              key={model.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: isRunning }}
              accessibilityLabel={`${model.name} を測る`}
              disabled={isRunning}
              onPress={() => toggle(model.id)}
              style={styles.checkRow}
            >
              <View
                style={[
                  styles.check,
                  {
                    borderColor: on ? theme.accent : theme.textFaint,
                    backgroundColor: on ? theme.accent : 'transparent',
                  },
                ]}
              >
                {on ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <View style={styles.flex}>
                <Text style={{ color: theme.text, fontSize: 14 }}>
                  {model.name}
                </Text>
                <Text style={{ color: theme.textFaint, fontSize: 12 }}>
                  {formatModelSize(model.sizeBytes)}
                </Text>
              </View>
            </Pressable>
          )
        })}
        {installed.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isRunning ? 'ベンチマークを止める' : 'ベンチマークを実行'
            }
            disabled={!isRunning && checked.size === 0}
            onPress={isRunning ? stop : runAll}
            style={[
              styles.runButton,
              {
                backgroundColor: isRunning ? theme.danger : theme.accent,
                opacity: !isRunning && checked.size === 0 ? 0.4 : 1,
              },
            ]}
          >
            <Text style={{ color: theme.badgeText, fontWeight: '600' }}>
              {isRunning ? '止める' : `${checked.size} 本を測定`}
            </Text>
          </Pressable>
        ) : null}
        {isRunning ? (
          <Text style={{ color: theme.textDim, fontSize: 12 }}>{phase}</Text>
        ) : null}
        <Text style={{ color: theme.textFaint, fontSize: 12 }}>
          測定中は端末が熱くなります。シミュレーターの数値は実機の目安になりません。
        </Text>
      </View>

      {resultIds.length > 0 ? (
        <>
          <View style={styles.sectionRow}>
            <Text style={[styles.sectionInline, { color: theme.textDim }]}>
              結果
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="結果をコピー"
              hitSlop={8}
              onPress={copyAll}
            >
              <Text style={{ color: theme.accent, fontSize: 12 }}>コピー</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="結果を消去"
              disabled={isRunning}
              hitSlop={8}
              onPress={clearAll}
            >
              <Text style={{ color: theme.danger, fontSize: 12 }}>消去</Text>
            </Pressable>
          </View>
          <Text style={[styles.scoreHint, { color: theme.textFaint }]}>
            速さの点数です。軽いモデルほど高く出るので、同じモデル同士で比べてください。
          </Text>
          {resultIds.map((id) => (
            <View
              key={id}
              style={[
                styles.box,
                styles.resultBox,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <View style={styles.scoreRow}>
                <Text
                  style={[styles.flex, { color: theme.text, fontSize: 14 }]}
                >
                  {findModel(id).name}
                </Text>
                {benchmarkScore(results[id]) === null ? null : (
                  <Text
                    accessibilityLabel={`${benchmarkScore(results[id])} 点`}
                    style={{ color: theme.accent }}
                  >
                    <Text style={styles.scoreValue}>
                      {benchmarkScore(results[id])}
                    </Text>
                    <Text style={styles.scoreUnit}> 点</Text>
                  </Text>
                )}
              </View>
              {resultLines(results[id]).map((line) => (
                <Text
                  key={line}
                  selectable
                  style={{ color: theme.textDim, fontSize: 12 }}
                >
                  {line}
                </Text>
              ))}
              {results[id].summary?.sample ||
              results[id].translation?.sample ? (
                <Text
                  selectable
                  numberOfLines={3}
                  style={{ color: theme.textFaint, fontSize: 12 }}
                >
                  {results[id].summary?.sample ||
                    results[id].translation?.sample}
                </Text>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 80 },
  section: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionInline: { flex: 1, fontSize: 12, fontWeight: '600' },
  box: { padding: 12, gap: 10 },
  resultBox: { borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scoreValue: { fontSize: 28, fontWeight: '700' },
  scoreUnit: { fontSize: 13, fontWeight: '600' },
  scoreHint: { paddingHorizontal: 12, paddingBottom: 8, fontSize: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  runButton: {
    alignItems: 'center',
    borderRadius: 8,
    paddingVertical: 10,
  },
})
