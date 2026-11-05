/**
 * AI の結果を出す下部のパネル。生成中も本文を読めるよう、画面全体を覆わない。
 */

import React from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { parseMarkdown } from 'lib/markdown'
import { MONO_FONT } from 'theme/ember'

function Spans({ spans, theme }) {
  return spans.map((span, i) => (
    <Text
      // 生成中に増えるだけで並びは変わらない
      // eslint-disable-next-line react/no-array-index-key
      key={i}
      style={[
        span.bold ? styles.bold : null,
        span.italic ? styles.italic : null,
        span.code
          ? {
              fontFamily: Platform.select(MONO_FONT),
              backgroundColor: theme.surfaceAlt,
            }
          : null,
      ]}
    >
      {span.text}
    </Text>
  ))
}

function MarkdownText({ text, theme }) {
  return parseMarkdown(text).map((block, i) => {
    const textStyle = [
      styles.text,
      { color: theme.text },
      block.type === 'heading' ? styles.heading : null,
    ]
    const key = `${i}-${block.type}`
    if (block.type === 'bullet' || block.type === 'ordered') {
      return (
        <View
          key={key}
          style={[styles.item, { marginLeft: (block.indent || 0) * 14 }]}
        >
          <Text style={[textStyle, { color: theme.textDim }]}>
            {block.type === 'bullet' ? '•' : block.marker}
          </Text>
          <Text selectable style={[textStyle, styles.itemBody]}>
            <Spans spans={block.spans} theme={theme} />
          </Text>
        </View>
      )
    }
    return (
      <Text key={key} selectable style={textStyle}>
        <Spans spans={block.spans} theme={theme} />
      </Text>
    )
  })
}

export default function AiResultPanel({
  title,
  text,
  running,
  error,
  markdown = false,
  bottom = 0,
  theme,
  onStop,
  onClose,
}) {
  let body = text
  if (!body && running) body = '準備しています…'

  return (
    <View
      style={[
        styles.panel,
        { bottom, backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.textDim }]}>{title}</Text>
        {running ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="AI を止める"
            hitSlop={8}
            onPress={onStop}
          >
            <Text style={{ color: theme.danger, fontSize: 13 }}>止める</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="AI の結果を閉じる"
            hitSlop={8}
            onPress={onClose}
          >
            <Text style={{ color: theme.accent, fontSize: 13 }}>閉じる</Text>
          </Pressable>
        )}
      </View>
      <ScrollView style={styles.scroll}>
        {error ? (
          <Text style={[styles.text, { color: theme.danger }]}>{error}</Text>
        ) : null}
        {!error && markdown && text ? (
          <MarkdownText text={text} theme={theme} />
        ) : null}
        {!error && !(markdown && text) ? (
          <Text selectable style={[styles.text, { color: theme.text }]}>
            {body}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 6,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontSize: 12, fontWeight: '600' },
  scroll: { maxHeight: 220 },
  text: { fontSize: 14, lineHeight: 21 },
  heading: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  item: { flexDirection: 'row', gap: 6 },
  itemBody: { flex: 1 },
})
