/**
 * 画像 NG の管理。追加は画像ビューアの「NG」ボタンから。
 * 一覧のサムネイルは、見たくない画像なのでぼかして出す。
 */

import { Image } from 'expo-image'
import React from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from 'components/Icon'
import {
  removeImageNg,
  setImageNgThreshold,
  toggleImageNg,
} from 'slices/imageNg.slice'
import { useEmberTheme } from 'theme/ember'

const THRESHOLDS = [
  { value: 5, label: 'ほぼ同じ' },
  { value: 10, label: '標準' },
  { value: 15, label: '広め' },
]

const THUMB_BLUR = 30

export default function ImageNgSettings() {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const { entries, threshold } = useSelector((state) => state.imageNg)

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <View
        style={[
          styles.box,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Text style={{ color: theme.text, fontSize: 14 }}>隠す範囲</Text>
        <View style={styles.chips}>
          {THRESHOLDS.map((t) => {
            const on = threshold === t.value
            return (
              <Pressable
                key={t.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`隠す範囲 ${t.label}`}
                onPress={() => dispatch(setImageNgThreshold(t.value))}
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
                  {t.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <Text style={{ color: theme.textFaint, fontSize: 12 }}>
          画像ビューアの「NG」から追加します。登録があると、判定のために画像の表示が少し遅くなります。カードの中の画像は対象外です。
        </Text>
      </View>

      {entries.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textFaint }]}>
          まだありません
        </Text>
      ) : (
        entries.map((entry) => (
          <View
            key={entry.hash}
            style={[
              styles.item,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Image
              source={{ uri: entry.sourceUrl }}
              style={[styles.thumb, { backgroundColor: theme.surfaceAlt }]}
              contentFit="cover"
              cachePolicy="memory-disk"
              blurRadius={THUMB_BLUR}
              onError={(e) =>
                console.warn(
                  `[imageNg] 一覧の画像を読めない: ${entry.sourceUrl}: ${
                    e?.error || '不明なエラー'
                  }`,
                )
              }
            />
            <Text
              numberOfLines={2}
              style={[styles.url, { color: theme.textDim }]}
            >
              {entry.sourceUrl}
            </Text>
            <Switch
              accessibilityLabel={`${entry.sourceUrl} を有効にする`}
              value={!entry.disabled}
              onValueChange={() => dispatch(toggleImageNg(entry.hash))}
              trackColor={{ true: theme.accent }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${entry.sourceUrl} を削除`}
              hitSlop={8}
              onPress={() => dispatch(removeImageNg(entry.hash))}
            >
              <Icon name="close" size={20} color={theme.textDim} />
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 60, paddingTop: 12 },
  box: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  thumb: { width: 48, height: 48, borderRadius: 6 },
  url: { flex: 1, fontSize: 11 },
  empty: { padding: 24, textAlign: 'center' },
})
