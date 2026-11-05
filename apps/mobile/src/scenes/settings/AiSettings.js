/**
 * AI の設定。画面の組み立ては FeedOwn の AiSettings に揃える。
 *
 * - 「オンデバイス AI」のスイッチで全体を入り切りする。切ると AI の項目を画面に出さない
 * - モデルは用途ごとにラジオで選ぶ。行に状態（使用中 / 入手済み / 未入手）を出す
 * - 未入手の行を選ぶとダウンロードが始まる。RAM が足りない行は選べない
 * - 測定は「ベンチマーク」の行から別の画面へ
 *
 * 推論はすべて端末の中で行い、書き込みを外部へ送らない。
 */

import * as Device from 'expo-device'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { AI_MODELS, canRunOnDevice, formatModelSize } from 'ai/catalog'
import { deleteModel, downloadModel, isModelInstalled } from 'ai/download'
import Icon from 'components/Icon'
import {
  addAiRule,
  removeAiRule,
  setAiOption,
  setAiRuleThreshold,
  toggleAiRule,
} from 'slices/ai.slice'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'

const USES = [
  { use: 'general', title: '要約と投稿前チェック', key: 'generalModel' },
  { use: 'ng', title: '曖昧 NG', key: 'ngModel' },
  { use: 'translation', title: '翻訳', key: 'translationModel' },
]

const THRESHOLDS = [
  { value: 0.9, label: '確実なものだけ' },
  { value: 0.8, label: '標準' },
  { value: 0.6, label: '広め' },
]

function Chips({ options, value, label, onChange, theme }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${label} ${o.label}`}
            onPress={() => onChange(o.value)}
            style={[
              styles.chip,
              {
                backgroundColor: on ? theme.accent : 'transparent',
                borderColor: on ? theme.accent : theme.border,
              },
            ]}
          >
            <Text
              style={{
                color: on ? theme.badgeText : theme.textDim,
                fontSize: 12,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function Badge({ text, color, theme }) {
  return (
    <View style={[styles.badge, { borderColor: color || theme.border }]}>
      <Text style={{ color: color || theme.textDim, fontSize: 11 }}>
        {text}
      </Text>
    </View>
  )
}

function ModelRow({
  model,
  selected,
  installed,
  progress,
  otherDownloading,
  onSelect,
  onCancel,
  onDelete,
  theme,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const gate = canRunOnDevice(model, Device.totalMemory)
  const downloading = progress !== undefined
  const disabled = !gate.ok || otherDownloading

  let status = <Badge text="未入手" theme={theme} />
  if (downloading) {
    status = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${model.name} のダウンロードをやめる`}
        hitSlop={8}
        onPress={onCancel}
      >
        <Text style={{ color: theme.danger, fontSize: 12 }}>
          {`${Math.round(progress * 100)}%  中止`}
        </Text>
      </Pressable>
    )
  } else if (installed) {
    status = selected ? (
      <Badge text="使用中" color={theme.accent} theme={theme} />
    ) : (
      <Badge text="入手済み" theme={theme} />
    )
  }

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${model.name} を選ぶ`}
      disabled={disabled}
      onPress={onSelect}
      style={[
        styles.modelRow,
        {
          borderColor: selected ? theme.accent : theme.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.radio,
          { borderColor: selected ? theme.accent : theme.textFaint },
        ]}
      >
        {selected ? (
          <View style={[styles.radioFill, { backgroundColor: theme.accent }]} />
        ) : null}
      </View>
      <View style={styles.flex}>
        <Text style={{ color: theme.text, fontSize: 14 }}>{model.name}</Text>
        <Text style={{ color: theme.textFaint, fontSize: 12 }}>
          {`${model.note}  •  ${formatModelSize(model.sizeBytes)}`}
        </Text>
        {gate.ok ? null : (
          <Text style={{ color: theme.danger, fontSize: 12 }}>
            {`⚠ ${gate.reason}`}
          </Text>
        )}
      </View>
      <View style={styles.modelStatus}>
        {status}
        {installed && !downloading ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${model.name} を削除`}
            hitSlop={8}
            onPress={() => {
              if (!confirmDelete) {
                setConfirmDelete(true)
                return
              }
              setConfirmDelete(false)
              onDelete()
            }}
          >
            <Text style={{ color: theme.danger, fontSize: 12 }}>
              {confirmDelete ? 'もう一度で削除' : '削除'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  )
}

export default function AiSettings({ navigation }) {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const ai = useSelector((state) => state.ai)
  const [installed, setInstalled] = useState(new Set())
  const [progress, setProgress] = useState({})
  const [draft, setDraft] = useState('')
  const jobs = useRef({})

  const refresh = useCallback(async () => {
    const results = await Promise.all(
      AI_MODELS.map(async (m) => [m.id, await isModelInstalled(m)]),
    )
    setInstalled(new Set(results.filter(([, ok]) => ok).map(([id]) => id)))
  }, [])

  useEffect(() => {
    refresh().catch((e) =>
      console.warn(`[ai] モデルの確認に失敗: ${e?.message || e}`),
    )
  }, [refresh])

  const startDownload = useCallback(
    async (model) => {
      setProgress((p) => ({ ...p, [model.id]: 0 }))
      jobs.current[model.id] = downloadModel(model, (fraction) =>
        setProgress((p) => ({ ...p, [model.id]: fraction })),
      )
      try {
        await jobs.current[model.id].done
      } catch (e) {
        console.warn(`[ai] ダウンロードに失敗: ${e?.message || e}`)
        showToast({ title: e?.message || 'ダウンロードできませんでした' })
      }
      delete jobs.current[model.id]
      setProgress((p) => {
        const next = { ...p }
        delete next[model.id]
        return next
      })
      refresh().catch((e) =>
        console.warn(`[ai] モデルの確認に失敗: ${e?.message || e}`),
      )
    },
    [refresh],
  )

  const anyDownloading = Object.keys(progress).length > 0

  const addRule = () => {
    if (!draft.trim()) return
    dispatch(addAiRule({ predicates: draft.split('\n') }))
    setDraft('')
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Text style={[styles.section, { color: theme.textDim }]}>
        オンデバイス AI
      </Text>
      <View style={[styles.box, { backgroundColor: theme.surface }]}>
        <View style={styles.toggleRow}>
          <View style={styles.flex}>
            <Text style={{ color: theme.text, fontSize: 14 }}>AI を使う</Text>
            <Text style={{ color: theme.textFaint, fontSize: 12 }}>
              すべて端末の中で動き、書き込みを外部へ送りません
            </Text>
          </View>
          <Switch
            accessibilityLabel="AI を使う"
            value={ai.enabled}
            disabled={anyDownloading}
            onValueChange={(value) =>
              dispatch(setAiOption({ key: 'enabled', value }))
            }
            trackColor={{ true: theme.accent }}
          />
        </View>

        {ai.enabled
          ? USES.map(({ use, title, key }) => (
              <View key={use} style={styles.useGroup}>
                <Text style={{ color: theme.text, fontSize: 13 }}>{title}</Text>
                {AI_MODELS.filter((m) => m.uses.includes(use)).map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    theme={theme}
                    selected={ai[key] === model.id}
                    installed={installed.has(model.id)}
                    progress={progress[model.id]}
                    otherDownloading={
                      anyDownloading && progress[model.id] === undefined
                    }
                    onSelect={() => {
                      dispatch(setAiOption({ key, value: model.id }))
                      if (
                        !installed.has(model.id) &&
                        progress[model.id] === undefined
                      ) {
                        startDownload(model)
                      }
                    }}
                    onCancel={() => jobs.current[model.id]?.cancel()}
                    onDelete={async () => {
                      await deleteModel(model)
                      refresh().catch((e) =>
                        console.warn(
                          `[ai] モデルの確認に失敗: ${e?.message || e}`,
                        ),
                      )
                    }}
                  />
                ))}
              </View>
            ))
          : null}
      </View>

      {ai.enabled ? (
        <>
          <Text style={[styles.section, { color: theme.textDim }]}>
            ベンチマーク
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ベンチマークを開く"
            onPress={() => navigation.navigate('AiBenchmark')}
            style={[styles.linkRow, { backgroundColor: theme.surface }]}
          >
            <View style={styles.flex}>
              <Text style={{ color: theme.text, fontSize: 14 }}>
                この端末で測る
              </Text>
              <Text style={{ color: theme.textFaint, fontSize: 12 }}>
                速度と曖昧 NG の正解率をモデルごとに比べます
              </Text>
            </View>
            <Icon name="chevronRight" size={16} color={theme.textFaint} />
          </Pressable>

          <Text style={[styles.section, { color: theme.textDim }]}>
            曖昧 NG のルール
          </Text>
          <View style={[styles.box, { backgroundColor: theme.surface }]}>
            <Text style={{ color: theme.textFaint, fontSize: 12 }}>
              「この書き込みは政治の話題である。」のように書きます。改行で分けると、すべてに当てはまるものを隠します（3
              行まで）。スレの抽出メニューから判定します。
            </Text>
            <TextInput
              accessibilityLabel="曖昧 NG のルール"
              value={draft}
              onChangeText={setDraft}
              placeholder="この書き込みは政治の話題である。"
              placeholderTextColor={theme.textFaint}
              multiline
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="ルールを追加"
              hitSlop={8}
              onPress={addRule}
              style={styles.addRule}
            >
              <Text style={{ color: theme.accent, fontWeight: '600' }}>
                追加
              </Text>
            </Pressable>
          </View>
          {ai.rules.map((rule) => (
            <View
              key={rule.id}
              style={[
                styles.box,
                styles.ruleBox,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <View style={styles.toggleRow}>
                <Text
                  style={[
                    styles.flex,
                    { color: rule.disabled ? theme.textFaint : theme.text },
                  ]}
                >
                  {rule.predicates.join('\n')}
                </Text>
                <Switch
                  accessibilityLabel="ルールを有効にする"
                  value={!rule.disabled}
                  onValueChange={() => dispatch(toggleAiRule(rule.id))}
                  trackColor={{ true: theme.accent }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="ルールを削除"
                  hitSlop={8}
                  onPress={() => dispatch(removeAiRule(rule.id))}
                >
                  <Icon name="close" size={20} color={theme.textDim} />
                </Pressable>
              </View>
              <Chips
                label="隠す基準"
                value={rule.threshold}
                theme={theme}
                options={THRESHOLDS}
                onChange={(threshold) =>
                  dispatch(setAiRuleThreshold({ id: rule.id, threshold }))
                }
              />
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
  box: { padding: 12, gap: 12 },
  ruleBox: { borderTopWidth: StyleSheet.hairlineWidth },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  useGroup: { gap: 8 },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioFill: { width: 10, height: 10, borderRadius: 5 },
  modelStatus: { alignItems: 'flex-end', gap: 6 },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    padding: 8,
    minHeight: 60,
    fontSize: 14,
  },
  addRule: { alignSelf: 'flex-end' },
})
