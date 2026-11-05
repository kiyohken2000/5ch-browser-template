/**
 * AI の設定。モデルのダウンロードと端末 RAM による可否、用途ごとのモデル、
 * CPU / GPU の切り替え、曖昧 NG のルール。
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

function ModelRow({ model, installed, onChanged, theme }) {
  const [progress, setProgress] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const job = useRef(null)
  const gate = canRunOnDevice(model, Device.totalMemory)

  const start = async () => {
    setProgress(0)
    job.current = downloadModel(model, setProgress)
    try {
      await job.current.done
    } catch (e) {
      console.warn(`[ai] ダウンロードに失敗: ${e?.message || e}`)
      showToast({ title: e?.message || 'ダウンロードできませんでした' })
    }
    job.current = null
    setProgress(null)
    onChanged()
  }

  let action = null
  if (progress !== null) {
    action = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${model.name} のダウンロードをやめる`}
        hitSlop={8}
        onPress={() => job.current && job.current.cancel()}
      >
        <Text style={{ color: theme.danger, fontSize: 13 }}>
          {`${Math.round(progress * 100)}% 中止`}
        </Text>
      </Pressable>
    )
  } else if (installed) {
    action = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${model.name} を削除`}
        hitSlop={8}
        onPress={async () => {
          if (!confirmDelete) {
            setConfirmDelete(true)
            return
          }
          await deleteModel(model)
          setConfirmDelete(false)
          onChanged()
        }}
      >
        <Text style={{ color: theme.danger, fontSize: 13 }}>
          {confirmDelete ? 'もう一度押すと削除' : '削除'}
        </Text>
      </Pressable>
    )
  } else if (gate.ok) {
    action = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${model.name} をダウンロード`}
        hitSlop={8}
        onPress={start}
      >
        <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '600' }}>
          入手
        </Text>
      </Pressable>
    )
  }

  return (
    <View style={[styles.item, { borderColor: theme.border }]}>
      <View style={styles.flex}>
        <Text style={{ color: theme.text, fontSize: 14 }}>{model.name}</Text>
        <Text style={{ color: theme.textFaint, fontSize: 12 }}>
          {`${formatModelSize(model.sizeBytes)} ・ ${model.note}`}
        </Text>
        {gate.ok ? null : (
          <Text style={{ color: theme.danger, fontSize: 12 }}>
            {gate.reason}
          </Text>
        )}
      </View>
      {action}
    </View>
  )
}

export default function AiSettings() {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const ai = useSelector((state) => state.ai)
  const [installed, setInstalled] = useState(new Set())
  const [draft, setDraft] = useState('')

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

  const modelChoices = (use) =>
    AI_MODELS.filter((m) => m.uses.includes(use) && installed.has(m.id)).map(
      (m) => ({ value: m.id, label: m.name }),
    )

  const addRule = () => {
    const predicates = draft.split('\n')
    if (!draft.trim()) return
    dispatch(addAiRule({ predicates }))
    setDraft('')
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Text style={[styles.note, { color: theme.textFaint }]}>
        AI
        はすべて端末の中で動き、書き込みを外部へ送りません。モデルは大きいので
        Wi-Fi でのダウンロードをおすすめします。
      </Text>

      <Text style={[styles.section, { color: theme.textDim }]}>モデル</Text>
      <View style={{ backgroundColor: theme.surface }}>
        {AI_MODELS.map((m) => (
          <ModelRow
            key={m.id}
            model={m}
            installed={installed.has(m.id)}
            onChanged={refresh}
            theme={theme}
          />
        ))}
      </View>

      <Text style={[styles.section, { color: theme.textDim }]}>使い方</Text>
      <View style={[styles.box, { backgroundColor: theme.surface }]}>
        <Text style={{ color: theme.text, fontSize: 14 }}>処理に使う装置</Text>
        <Chips
          label="処理に使う装置"
          value={ai.backend}
          theme={theme}
          options={[
            { value: 'auto', label: 'GPU（速い）' },
            { value: 'cpu', label: 'CPU（熱くなりにくい）' },
          ]}
          onChange={(value) => dispatch(setAiOption({ key: 'backend', value }))}
        />
        <Text style={{ color: theme.text, fontSize: 14 }}>
          要約と投稿前チェック
        </Text>
        {modelChoices('general').length > 0 ? (
          <Chips
            label="要約のモデル"
            value={ai.generalModel}
            theme={theme}
            options={modelChoices('general')}
            onChange={(value) =>
              dispatch(setAiOption({ key: 'generalModel', value }))
            }
          />
        ) : (
          <Text style={{ color: theme.textFaint, fontSize: 12 }}>
            対応するモデルを入手してください
          </Text>
        )}
        <Text style={{ color: theme.text, fontSize: 14 }}>曖昧 NG</Text>
        {modelChoices('ng').length > 0 ? (
          <Chips
            label="曖昧 NG のモデル"
            value={ai.ngModel}
            theme={theme}
            options={modelChoices('ng')}
            onChange={(value) =>
              dispatch(setAiOption({ key: 'ngModel', value }))
            }
          />
        ) : (
          <Text style={{ color: theme.textFaint, fontSize: 12 }}>
            対応するモデルを入手してください
          </Text>
        )}
      </View>

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
          <Text style={{ color: theme.accent, fontWeight: '600' }}>追加</Text>
        </Pressable>
      </View>
      {ai.rules.map((rule) => (
        <View
          key={rule.id}
          style={[
            styles.box,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              borderTopWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          <View style={styles.ruleHead}>
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
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 80 },
  note: { padding: 12, fontSize: 12, lineHeight: 18 },
  section: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  box: { padding: 12, gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    padding: 8,
    minHeight: 60,
    fontSize: 14,
  },
  addRule: { alignSelf: 'flex-end' },
  ruleHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
})
