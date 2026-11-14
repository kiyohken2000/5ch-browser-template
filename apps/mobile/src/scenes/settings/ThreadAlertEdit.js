/**
 * スレ立て通知の条件を足す / 直す（§9-8）。板 1 つとワード（1 行に 1 語）。
 * 通知の設定の「スレ立て通知」と、スレ一覧のヘッダーのベルから開く。
 *
 * params: `{id}`（直す）か `{boardUrl, boardName}`（その板で足す）。どちらも
 * 無ければ、お気に入りの板と最近開いた板から選ぶ。
 */

import React, { useMemo, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { MAX_ALERT_WORDS, parseAlertWords, upsertAlert } from 'lib/notify'
import { setSetting } from 'slices/settings.slice'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'

export default function ThreadAlertEdit({ navigation, route }) {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const alerts = useSelector((state) => state.settings.threadAlerts || [])
  const boardFavorites = useSelector((state) => state.watch.boardFavorites)
  const recentBoards = useSelector((state) => state.watch.recentBoards)
  const params = route.params || {}
  const editing = params.id ? alerts.find((a) => a.id === params.id) : null

  const [board, setBoard] = useState(() => {
    if (editing) return { url: editing.boardUrl, name: editing.boardName }
    if (params.boardUrl) {
      return { url: params.boardUrl, name: params.boardName || '' }
    }
    return null
  })
  const [wordsText, setWordsText] = useState(() =>
    editing ? editing.words.join('\n') : '',
  )
  const words = parseAlertWords(wordsText)

  // 選べる板。お気に入り → 最近開いた板。同じ板は 1 つにする
  const choices = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const b of [...(boardFavorites || []), ...(recentBoards || [])]) {
      if (!b?.url || seen.has(b.url)) continue
      seen.add(b.url)
      out.push({ url: b.url, name: b.name || b.board || b.url })
    }
    return out
  }, [boardFavorites, recentBoards])

  const canSave = !!board && words.length > 0

  const saveAlert = () => {
    if (!canSave) return
    const next = upsertAlert(
      alerts,
      {
        id: editing?.id,
        boardUrl: board.url,
        boardName: board.name,
        words,
      },
      Date.now(),
    )
    if (!next) {
      showToast({ title: 'これ以上は登録できません' })
      return
    }
    dispatch(setSetting({ key: 'threadAlerts', value: next }))
    navigation.goBack()
  }

  const remove = () => {
    if (!editing) return
    dispatch(
      setSetting({
        key: 'threadAlerts',
        value: alerts.filter((a) => a.id !== editing.id),
      }),
    )
    navigation.goBack()
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.heading, { color: theme.textDim }]}>板</Text>
      {board ? (
        <View
          style={[
            styles.card,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.boardName, { color: theme.text }]}>
            {board.name || board.url}
          </Text>
          {!params.boardUrl || editing ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setBoard(null)}
            >
              <Text style={{ color: theme.accent, fontSize: 14 }}>変える</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View
          style={[
            styles.list,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          {choices.length === 0 ? (
            <Text style={[styles.hint, styles.pad, { color: theme.textDim }]}>
              お気に入りの板も最近開いた板もありません。板のスレ一覧を開き、上のベルから登録してください
            </Text>
          ) : (
            choices.map((b) => (
              <Pressable
                key={b.url}
                accessibilityRole="button"
                onPress={() => setBoard(b)}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    borderColor: theme.border,
                    backgroundColor: pressed ? theme.surfaceAlt : 'transparent',
                  },
                ]}
              >
                <Text style={{ color: theme.text, fontSize: 15 }}>
                  {b.name}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      )}

      <Text style={[styles.heading, { color: theme.textDim }]}>
        ワード（1 行に 1 つ、{MAX_ALERT_WORDS} 個まで）
      </Text>
      <TextInput
        accessibilityLabel="スレ立て通知のワード"
        value={wordsText}
        onChangeText={setWordsText}
        multiline
        autoCorrect={false}
        autoCapitalize="none"
        placeholder={'例:\n次スレ\nPart'}
        placeholderTextColor={theme.textFaint}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
      />
      <Text style={[styles.hint, { color: theme.textFaint }]}>
        スレタイにどれか 1
        つが入っていれば通知します（部分一致。全角半角・大文字小文字は区別しません）。登録した後に立ったスレだけが対象です。スレ一覧
        NG に当たるスレと、自分が立てたスレは通知しません。OS
        が空いた時間に確認するので、数時間遅れることがあります。
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave }}
        disabled={!canSave}
        onPress={saveAlert}
        style={[
          styles.button,
          { backgroundColor: canSave ? theme.accent : theme.border },
        ]}
      >
        <Text style={[styles.buttonText, { color: theme.bg }]}>
          {editing ? '保存' : '登録'}
        </Text>
      </Pressable>
      {editing ? (
        <Pressable
          accessibilityRole="button"
          onPress={remove}
          style={styles.remove}
        >
          <Text style={{ color: theme.danger, fontSize: 15 }}>
            この条件を消す
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  heading: { fontSize: 13, marginTop: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  boardName: { fontSize: 15, flexShrink: 1 },
  list: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pad: { padding: 14 },
  input: {
    minHeight: 120,
    padding: 12,
    fontSize: 15,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    textAlignVertical: 'top',
  },
  hint: { fontSize: 12, lineHeight: 18 },
  button: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  remove: { paddingVertical: 14, alignItems: 'center' },
})
