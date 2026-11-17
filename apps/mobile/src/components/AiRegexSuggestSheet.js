/**
 * 例のレスから正規表現 NG を作る画面。候補は件数を見て、直してから追加できる。
 * 正規表現は軽いので、直した候補もその場で数え直す。
 */

import React, { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import {
  addNos,
  measureRegex,
  REGEX_TARGETS,
  regexMeasureText,
  sameIdNos,
  similarRows,
  toggleNo,
} from 'ai/regexSuggest'
import { parseExampleNos } from 'ai/ruleSuggest'
import useRegexSuggest from 'ai/useRegexSuggest'

/** 例の一覧に出すレスの数 */
const PICK_LIMIT = 10

/** 「/…/」から中身を取り出す。囲みが無ければ入力をそのまま中身とみなす。 */
const bodyOf = (text) => {
  const t = text.trim()
  return t.length > 2 && t.startsWith('/') && t.endsWith('/') ? t.slice(1, -1) : t
}

export default function AiRegexSuggestSheet({
  target: initial,
  rows,
  generalModel,
  theme,
  onAdd,
  onClose,
}) {
  const [noText, setNoText] = useState(String(initial.no))
  const [target, setTarget] = useState('body')
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const { busy, error, candidate, run, stop } = useRegexSuggest({
    generalModel,
    rows,
  })

  useEffect(() => {
    setText(candidate ? `/${candidate.body}/` : '')
  }, [candidate])

  const exampleNos = candidate?.target === target ? candidate.exampleNos : null
  const body = bodyOf(text)
  const measure = useMemo(
    () =>
      exampleNos && body
        ? measureRegex(body, { rows, exampleNos, target })
        : null,
    [body, exampleNos, rows, target],
  )
  const canAdd = !!measure?.ok && measure.hits > 0

  const picked = parseExampleNos(noText)
  const choices = useMemo(
    () => similarRows(rows, initial.no, target, { query, limit: PICK_LIMIT }),
    [rows, initial.no, target, query],
  )
  const sameId = useMemo(() => sameIdNos(rows, initial.no), [rows, initial.no])
  const sameIdMissing = sameId.filter((no) => !picked.includes(no))
  const { textOf, label: targetLabel } = REGEX_TARGETS[target]

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: theme.bg }]}>
        <View style={[styles.head, { borderColor: theme.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="閉じる"
            hitSlop={8}
            onPress={onClose}
          >
            <Text style={{ color: theme.textDim, fontSize: 15 }}>閉じる</Text>
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]}>
            正規表現 NG を作る
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="NG に追加"
            accessibilityState={{ disabled: !canAdd }}
            disabled={!canAdd}
            hitSlop={8}
            onPress={() =>
              onAdd({ list: REGEX_TARGETS[target].list, value: `/${body}/` })
            }
          >
            <Text
              style={{
                color: canAdd ? theme.accent : theme.textFaint,
                fontSize: 15,
              }}
            >
              追加
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={[styles.segment, { borderColor: theme.border }]}>
            {Object.entries(REGEX_TARGETS).map(([key, t]) => {
              const on = key === target
              return (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: !!busy }}
                  accessibilityLabel={`${t.label}から作る`}
                  disabled={!!busy}
                  onPress={() => setTarget(key)}
                  style={[
                    styles.segmentItem,
                    on && { backgroundColor: theme.accent },
                  ]}
                >
                  <Text
                    style={{
                      color: on ? theme.badgeText : theme.text,
                      fontWeight: on ? '600' : '400',
                    }}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          <Text style={{ color: theme.textDim, fontSize: 13 }}>
            {`隠したいレスを選んでください（似ている順・${picked.length} 件選択中）`}
          </Text>
          <TextInput
            accessibilityLabel="例の候補を絞り込む"
            value={query}
            onChangeText={setQuery}
            editable={!busy}
            placeholder={`${targetLabel}の一部で絞り込む`}
            placeholderTextColor={theme.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border },
            ]}
          />
          <View style={[styles.pickList, { borderColor: theme.border }]}>
            {choices.length === 0 ? (
              <Text style={[styles.pickEmpty, { color: theme.textFaint }]}>
                当てはまるレスがありません
              </Text>
            ) : (
              choices.map((r, i) => {
                const on = picked.includes(r.no)
                return (
                  <Pressable
                    key={r.no}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: !!busy }}
                    accessibilityLabel={`>>${r.no} を例にする`}
                    disabled={!!busy}
                    onPress={() => setNoText((t) => toggleNo(t, r.no, !on))}
                    style={[
                      styles.pickRow,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pickMark,
                        { color: on ? theme.accent : theme.textFaint },
                      ]}
                    >
                      {on ? '✓' : '○'}
                    </Text>
                    <Text style={[styles.pickNo, { color: theme.textDim }]}>
                      {r.no}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.flex, { color: theme.text, fontSize: 14 }]}
                    >
                      {textOf(r).replace(/\s+/g, ' ').trim()}
                    </Text>
                  </Pressable>
                )
              })
            )}
          </View>
          {sameId.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="同じ ID のレスを例に加える"
              accessibilityState={{
                disabled: !!busy || sameIdMissing.length === 0,
              }}
              disabled={!!busy || sameIdMissing.length === 0}
              hitSlop={8}
              onPress={() => setNoText((t) => addNos(t, sameId))}
            >
              <Text
                style={{
                  color:
                    sameIdMissing.length > 0 ? theme.accent : theme.textFaint,
                  fontSize: 14,
                }}
              >
                {sameIdMissing.length > 0
                  ? `同じ ID のレスを加える（あと ${sameIdMissing.length} 件）`
                  : `同じ ID のレス ${sameId.length} 件を選んでいます`}
              </Text>
            </Pressable>
          ) : null}
          <Text style={{ color: theme.textDim, fontSize: 13 }}>
            番号で指定（スペースで区切って複数書けます）
          </Text>
          <TextInput
            accessibilityLabel="例にするレス番号"
            value={noText}
            onChangeText={setNoText}
            editable={!busy}
            keyboardType="numbers-and-punctuation"
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border },
            ]}
          />
          {busy ? (
            <View style={styles.busy}>
              <Text style={[styles.flex, { color: theme.text, fontSize: 13 }]}>
                {busy}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="候補を作るのを止める"
                hitSlop={8}
                onPress={stop}
              >
                <Text style={{ color: theme.danger, fontWeight: '600' }}>
                  止める
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="候補を作る"
              onPress={() => run(noText, target)}
              style={[styles.run, { backgroundColor: theme.accent }]}
            >
              <Text style={{ color: theme.badgeText, fontWeight: '600' }}>
                候補を作る
              </Text>
            </Pressable>
          )}
          {error ? (
            <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
          ) : null}

          {exampleNos ? (
            <View style={[styles.candidate, { borderColor: theme.border }]}>
              <Text style={{ color: theme.textDim, fontSize: 12 }}>
                {`${REGEX_TARGETS[target].label}の NG（直せます）`}
              </Text>
              <TextInput
                accessibilityLabel="正規表現の候補"
                value={text}
                onChangeText={setText}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                style={[styles.candidateText, { color: theme.text }]}
              />
              <Text
                style={{
                  color:
                    measure && !measure.ok ? theme.danger : theme.textFaint,
                  fontSize: 12,
                }}
              >
                {regexMeasureText(measure)}
              </Text>
            </View>
          ) : null}
          {exampleNos ? (
            <Text style={{ color: theme.textFaint, fontSize: 12 }}>
              件数を見て、隠したくないレスまで当たっていないか確かめてから追加してください。
            </Text>
          ) : (
            <Text style={{ color: theme.textFaint, fontSize: 12 }}>
              AI が例のレスに共通する語句から正規表現を作り、このスレのレスに当てて確かめます。例のすべてに当たらない答えや、広すぎる答えは出しません。
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontWeight: '600' },
  content: { padding: 16, gap: 12, paddingBottom: 60 },
  segment: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  pickList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  pickMark: { width: 16, fontSize: 15, fontWeight: '700' },
  pickNo: { minWidth: 32, fontSize: 13, fontVariant: ['tabular-nums'] },
  pickEmpty: { padding: 12, fontSize: 13 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  run: { alignItems: 'center', paddingVertical: 10, borderRadius: 8 },
  candidate: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  candidateText: {
    fontSize: 15,
    padding: 0,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
})
