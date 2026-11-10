/**
 * レスの見出し。本文リストとシートで同じものを使う。
 *
 * 色と項目はデスクトップ版に揃える（番号 / 名前 / ワッチョイ / メール / ▼N、日付 / ID / BE）。
 * 画面が狭いので、名前は折り返し、ID は 2 行目の右に寄せる。
 */

import { highlightStyle, matchColor, splitHighlights } from 'lib/highlights'
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { POPULAR_MIN_BACKLINKS } from 'lib/extract'
import { idColor, idIcon } from 'lib/idcolor'
import { splitNameWatchoi } from 'lib/parse'

export default function ResponseHeader({
  row,
  theme,
  fontSize,
  backlinks,
  mine,
  replyToMe,
  idSeq,
  onId,
  onBacklinks,
  onBe,
  highlights,
  isNew,
  idColors = true,
}) {
  const { name, watchoi } = splitNameWatchoi(row.name)
  const idHighlight = matchColor(row.id, highlights?.ids)
  const small = fontSize - 4
  // 色分けを切っても形のアイコンは残すので、同じ人かどうかは見分けられる
  const color = idColors ? idColor(row.id, theme.dark) : null

  return (
    <View style={styles.wrap}>
      <View style={styles.line}>
        <Text
          style={[styles.no, { color: theme.resNo, fontSize: fontSize - 3 }]}
        >
          {row.no}
        </Text>
        {isNew ? (
          <Text
            style={[styles.newMark, { color: theme.accent, fontSize: small }]}
          >
            New!
          </Text>
        ) : null}
        {mine ? (
          <Text style={[styles.tag, { color: theme.mine, fontSize: small }]}>
            [自分]
          </Text>
        ) : null}
        {replyToMe ? (
          <Text style={[styles.tag, { color: theme.reply, fontSize: small }]}>
            [自分宛]
          </Text>
        ) : null}
        <Text
          style={[
            styles.name,
            { color: theme.resName, fontSize: fontSize - 3 },
          ]}
        >
          {splitHighlights(name || '名無し', highlights?.names).map((part, i) =>
            part.color ? (
              <Text key={i} style={highlightStyle(part.color)}>
                {part.text}
              </Text>
            ) : (
              part.text
            ),
          )}
        </Text>
        {watchoi ? (
          <Text style={{ color: theme.textDim, fontSize: small }}>
            ({watchoi})
          </Text>
        ) : null}
        {row.mail ? (
          <Text style={{ color: theme.textDim, fontSize: small }}>
            [{row.mail}]
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
                {
                  color:
                    backlinks.length >= POPULAR_MIN_BACKLINKS
                      ? theme.danger
                      : theme.link,
                  fontSize: fontSize - 3,
                },
              ]}
            >
              ▼{backlinks.length}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.line2}>
        <Text style={{ color: theme.textFaint, fontSize: small }}>
          {row.date}
        </Text>
        <View style={styles.right}>
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
                  { color: color || theme.textDim, fontSize: small },
                  idHighlight ? highlightStyle(idHighlight) : null,
                ]}
              >
                {idIcon(row.id)} ID:{row.id}
                {idSeq && idSeq.count > 1
                  ? `(${idSeq.seq}/${idSeq.count})`
                  : ''}
              </Text>
            </Pressable>
          ) : null}
          {row.be ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`BE:${row.be}`}
              hitSlop={6}
              disabled={!onBe}
              onPress={() => onBe && onBe(row.be)}
            >
              <Text style={{ color: theme.be, fontSize: small }}>
                BE:{row.be}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  newMark: { fontWeight: '700' },
  wrap: { gap: 1 },
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 5,
  },
  line2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: 8,
  },
  right: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 6,
    marginLeft: 'auto',
  },
  no: { fontWeight: '700' },
  name: { fontWeight: '700' },
  tag: { fontWeight: '700' },
  backlinks: { fontWeight: '700' },
  id: { fontWeight: '600' },
})
