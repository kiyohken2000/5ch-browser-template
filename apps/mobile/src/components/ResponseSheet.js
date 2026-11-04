/**
 * レスを並べるボトムシート。**3 つの画面を 1 つの部品で賄う。**
 *   - 参照ポップアップ（`>>` タップ、§8-7）
 *   - ID シート（ID タップ、§8-6）
 *   - 被参照一覧（`▼N` タップ、§8-7）
 *
 * **不変条件 2: この中でも NG を効かせる。**
 * 呼ぶ側は `applyNg` を通した行だけを渡し、この部品は受け取った行をそのまま
 * 描く。`hide` の行はそもそも渡ってこない。
 *
 * **連鎖で辿れる**（§8-7 必須）。シートの中の `>>` をタップすると、
 * 今のシートの上にもう 1 枚積む。戻るボタンで 1 枚ずつ戻る。
 */

import React from 'react'
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { idColor, idIcon } from 'lib/idcolor'
import ResponseBody from './ResponseBody'

export default function ResponseSheet({
  stack,
  theme,
  fontSize,
  onClose,
  onBack,
  onAnchor,
  onId,
  onUrl,
}) {
  const top = stack.length > 0 ? stack[stack.length - 1] : null
  if (!top) return null

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={[styles.head, { borderColor: theme.border }]}>
          {stack.length > 1 ? (
            <Pressable onPress={onBack} hitSlop={8}>
              <Text style={[styles.headBtn, { color: theme.accent }]}>
                戻る
              </Text>
            </Pressable>
          ) : (
            <View style={styles.headSpacer} />
          )}
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {top.title}
          </Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={[styles.headBtn, { color: theme.accent }]}>
              閉じる
            </Text>
          </Pressable>
        </View>

        <FlatList
          data={top.rows}
          keyExtractor={(r) => String(r.no)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: theme.textDim }}>
                {top.emptyText || '該当するレスがありません'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.ngMode === 'abone') {
              return (
                <View style={[styles.row, { borderColor: theme.border }]}>
                  <Text
                    style={{ color: theme.textFaint, fontSize: fontSize - 2 }}
                  >
                    あぼーん
                  </Text>
                </View>
              )
            }
            return (
              <View style={[styles.row, { borderColor: theme.border }]}>
                <View style={styles.rowHead}>
                  <Text
                    style={[
                      styles.no,
                      { color: theme.textDim, fontSize: fontSize - 3 },
                    ]}
                  >
                    {item.no}
                  </Text>
                  <Text
                    style={[
                      styles.name,
                      { color: theme.textDim, fontSize: fontSize - 3 },
                    ]}
                    numberOfLines={1}
                  >
                    {item.name || '名無し'}
                  </Text>
                  {item.id ? (
                    <Text
                      style={[
                        styles.id,
                        {
                          color: idColor(item.id, theme.dark) || theme.textDim,
                          fontSize: fontSize - 4,
                        },
                      ]}
                    >
                      {idIcon(item.id)} ID:{item.id}
                    </Text>
                  ) : null}
                </View>
                <ResponseBody
                  parsed={item.parsed}
                  theme={theme}
                  fontSize={fontSize}
                  onAnchor={(t) => onAnchor && onAnchor(t, item.no)}
                  onId={onId}
                  onUrl={onUrl}
                />
              </View>
            )
          }}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '75%',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  headBtn: { fontSize: 14, fontWeight: '600' },
  headSpacer: { width: 36 },
  title: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700' },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  no: { fontWeight: '700' },
  name: { flexShrink: 1 },
  id: { fontWeight: '600' },
  empty: { padding: 24, alignItems: 'center' },
})
