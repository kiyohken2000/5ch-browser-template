/**
 * 例のレスから曖昧 NG のルールを作る画面。候補は数字を見て選び、直してから追加できる。
 * 直した候補は測り直していないので、数字を出さない。
 */

import React, { useEffect, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { NG_AI_MAX_PREDICATES } from 'ai/judge'
import { measureCandidates, measureText } from 'ai/ruleSuggest'
import useRuleSuggest from 'ai/useRuleSuggest'

function CandidateRow({ item, theme, onToggle, onEdit }) {
  return (
    <View
      style={[
        styles.candidate,
        { borderColor: item.selected ? theme.accent : theme.border },
      ]}
    >
      <View style={styles.candidateHead}>
        <Text style={{ color: theme.textDim, fontSize: 12 }}>{item.slot}</Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.selected }}
          accessibilityLabel={`${item.slot}の候補を使う`}
          hitSlop={8}
          onPress={onToggle}
        >
          <Text
            style={{
              color: item.selected ? theme.accent : theme.textDim,
              fontSize: 13,
              fontWeight: '600',
            }}
          >
            {item.selected ? '使う ✓' : '使う'}
          </Text>
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel={`${item.slot}の候補`}
        value={item.text}
        onChangeText={onEdit}
        multiline
        style={[styles.candidateText, { color: theme.text }]}
      />
      <Text style={{ color: theme.textFaint, fontSize: 12 }}>
        {item.edited
          ? '直した文は測っていません'
          : measureText(measureCandidates([item]))}
      </Text>
    </View>
  )
}

export default function AiRuleSuggestSheet({
  target,
  rows,
  generalModel,
  theme,
  onAdd,
  onClose,
}) {
  const [noText, setNoText] = useState(String(target.no))
  const [items, setItems] = useState([])
  const { busy, error, candidates, run, stop } = useRuleSuggest({
    generalModel,
    rows,
  })

  useEffect(() => {
    setItems(candidates.map((c) => ({ ...c, selected: false, edited: false })))
  }, [candidates])

  const change = (i, changes) =>
    setItems((list) =>
      list.map((item, j) => (j === i ? { ...item, ...changes } : item)),
    )

  const selected = items.filter((item) => item.selected)
  const canAdd =
    selected.length > 0 &&
    selected.length <= NG_AI_MAX_PREDICATES &&
    selected.every((item) => item.text.trim())
  // 2 つ選ぶと AND になり、数字が変わる。1 つなら候補の欄と同じなので出さない
  const combined =
    selected.length > 1 && selected.every((item) => !item.edited)
      ? measureText(measureCandidates(selected))
      : null

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
            曖昧 NG のルールを作る
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ルールを追加"
            accessibilityState={{ disabled: !canAdd }}
            disabled={!canAdd}
            hitSlop={8}
            onPress={() => onAdd(selected.map((item) => item.text))}
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
          <Text style={{ color: theme.textDim, fontSize: 13 }}>
            隠したいレスの番号（スペースで区切って複数書けます）
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
              onPress={() => run(noText)}
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

          {items.map((item, i) => (
            <CandidateRow
              key={item.slot}
              item={item}
              theme={theme}
              onToggle={() => change(i, { selected: !item.selected })}
              onEdit={(text) => change(i, { text, edited: true })}
            />
          ))}
          {combined ? (
            <Text style={{ color: theme.text, fontSize: 13 }}>
              {`選んだ条件すべてに当たるもの: ${combined}`}
            </Text>
          ) : null}
          {items.length > 0 ? (
            <Text style={{ color: theme.textFaint, fontSize: 12 }}>
              例を拾えていない候補や、このスレの大半に当たる候補は使わないでください。文面だけでは良し悪しが分からないので、数字で選んでください。
            </Text>
          ) : null}
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
  candidateHead: { flexDirection: 'row', justifyContent: 'space-between' },
  candidateText: { fontSize: 14, lineHeight: 20, padding: 0 },
})
