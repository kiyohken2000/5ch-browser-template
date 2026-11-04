/**
 * レス 1 件。
 *
 * **NG はここで判定しない。** 呼ぶ側が lib/ng.js の `applyNg` を通した行を渡す
 * （不変条件 2: すべての描画経路で効かせるため、判定を 1 箇所に寄せる）。
 * ここがやるのは「`ngMode` が `abone` なら 1 行で出す」だけ。
 *
 * 折りたたみ（§8-4）は **AA ブロックを含むレスには掛けない**（§9-2 必須）。
 */

import React, { memo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { idIcon, idColor } from 'lib/idcolor'
import { shouldHideImages } from 'lib/ng'
import ResponseBody from './ResponseBody'
import ResponseMedia from './ResponseMedia'

function ResponseItem({
  row,
  theme,
  fontSize,
  backlinks,
  collapseLines,
  showReadLine,
  highlighted,
  mine,
  replyToMe,
  mediaOptions,
  onImage,
  onTap,
  onAnchor,
  onId,
  onBacklinks,
  onUrl,
  onLongPress,
}) {
  const [expanded, setExpanded] = useState(false)

  if (row.ngMode === 'abone') {
    return (
      <View style={[styles.abone, { borderColor: theme.border }]}>
        <Text style={{ color: theme.textFaint, fontSize: fontSize - 2 }}>
          あぼーん（{row.ngBy || 'NG'}）
        </Text>
      </View>
    )
  }

  const color = idColor(row.id, theme.dark)
  const lineCount = row.parsed.plain.split('\n').length
  // AA を含むレスは絶対に折りたたまない（§9-2）
  const collapsible =
    !row.hasAa && collapseLines > 0 && lineCount > collapseLines
  const collapsed = collapsible && !expanded

  return (
    <View>
      {showReadLine ? (
        <View style={styles.readLineWrap}>
          <View
            style={[styles.readLine, { backgroundColor: theme.readLine }]}
          />
          <Text style={[styles.readLineText, { color: theme.readLine }]}>
            ここまで読んだ
          </Text>
          <View
            style={[styles.readLine, { backgroundColor: theme.readLine }]}
          />
        </View>
      ) : null}

      <Pressable
        accessible={false}
        onPress={(e) => onTap && onTap(e)}
        onLongPress={() => onLongPress && onLongPress(row)}
        delayLongPress={350}
        style={[
          styles.card,
          {
            backgroundColor: highlighted ? theme.accentDim : theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        {mine || replyToMe ? (
          <View
            style={[
              styles.ownBar,
              { backgroundColor: theme.accent, width: mine ? 4 : 2 },
            ]}
          />
        ) : null}
        <View style={styles.header}>
          <Text
            style={[
              styles.no,
              { color: theme.textDim, fontSize: fontSize - 3 },
            ]}
          >
            {row.no}
          </Text>
          <Text
            style={[
              styles.name,
              { color: theme.textDim, fontSize: fontSize - 3 },
            ]}
            numberOfLines={1}
          >
            {row.name || '名無し'}
          </Text>
          {mine || replyToMe ? (
            <Text
              style={[
                styles.ownTag,
                { color: theme.accent, fontSize: fontSize - 4 },
              ]}
            >
              {mine ? '自分' : '自分宛て'}
            </Text>
          ) : null}
          {backlinks && backlinks.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`レス ${row.no} への返信 ${backlinks.length} 件`}
              onPress={() => onBacklinks && onBacklinks(row.no)}
              hitSlop={8}
            >
              <Text
                style={[
                  styles.backlinks,
                  { color: theme.accent, fontSize: fontSize - 3 },
                ]}
              >
                ▼{backlinks.length}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.header2}>
          <Text
            style={[
              styles.date,
              { color: theme.textFaint, fontSize: fontSize - 4 },
            ]}
          >
            {row.date}
          </Text>
          {row.id ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`ID:${row.id}`}
              onPress={() => onId && onId(row.id)}
              hitSlop={6}
            >
              <Text
                style={[
                  styles.id,
                  { color: color || theme.textDim, fontSize: fontSize - 4 },
                ]}
              >
                {idIcon(row.id)} ID:{row.id}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={collapsed ? styles.collapsed : null}>
          <ResponseBody
            parsed={row.parsed}
            hideImages={shouldHideImages(row)}
            theme={theme}
            fontSize={fontSize}
            onAnchor={(t) => onAnchor && onAnchor(t, row.no)}
            onId={onId}
            onUrl={onUrl}
          />
        </View>

        <ResponseMedia
          media={row.media}
          options={mediaOptions}
          hideImages={shouldHideImages(row)}
          theme={theme}
          onImage={onImage}
          onUrl={onUrl}
        />

        {collapsible ? (
          <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={6}>
            <Text
              style={[
                styles.more,
                { color: theme.accent, fontSize: fontSize - 3 },
              ]}
            >
              {expanded ? '閉じる' : `…続きを読む（${lineCount} 行）`}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  )
}

export default memo(ResponseItem)

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ownTag: { fontWeight: '700' },
  ownBar: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  header2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 3,
  },
  no: { fontWeight: '700', minWidth: 22 },
  name: { flexShrink: 1, fontWeight: '600' },
  backlinks: { fontWeight: '700' },
  date: {},
  id: { fontWeight: '600' },
  collapsed: { maxHeight: 220, overflow: 'hidden' },
  more: { marginTop: 4 },
  abone: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  readLineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  readLine: { flex: 1, height: StyleSheet.hairlineWidth },
  readLineText: { fontSize: 11, fontWeight: '600' },
})
