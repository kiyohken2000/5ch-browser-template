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

import { shouldHideImages } from 'lib/ng'
import ResponseBody from './ResponseBody'
import ResponseHeader from './ResponseHeader'
import ResponseMedia from './ResponseMedia'

function ResponseItem({
  row,
  theme,
  fontSize,
  textOptions,
  backlinks,
  collapseLines,
  showReadLine,
  showNewLine,
  isNew,
  highlighted,
  mine,
  replyToMe,
  idSeq,
  mediaOptions,
  onImage,
  onTap,
  onAnchor,
  onId,
  onBacklinks,
  onBe,
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

      {showNewLine ? (
        <View style={styles.readLineWrap}>
          <View style={[styles.readLine, { backgroundColor: theme.accent }]} />
          <Text style={[styles.readLineText, { color: theme.accent }]}>
            ここから新着
          </Text>
          <View style={[styles.readLine, { backgroundColor: theme.accent }]} />
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
              { backgroundColor: mine ? theme.mine : theme.reply },
            ]}
          />
        ) : null}
        <ResponseHeader
          row={row}
          theme={theme}
          fontSize={fontSize}
          backlinks={backlinks}
          mine={mine}
          replyToMe={replyToMe}
          idSeq={idSeq}
          onId={onId}
          onBacklinks={onBacklinks}
          onBe={onBe}
          highlights={textOptions?.highlights}
          isNew={isNew}
        />

        <View
          style={
            collapsed
              ? [
                  styles.collapsed,
                  {
                    maxHeight:
                      (textOptions?.collapsedLines || 10) * fontSize * 1.55,
                  },
                ]
              : null
          }
        >
          <ResponseBody
            parsed={row.parsed}
            textOptions={textOptions}
            hideImages={shouldHideImages(row)}
            theme={theme}
            fontSize={fontSize}
            onAnchor={(t) => onAnchor && onAnchor(t, row.no)}
            onId={onId}
            onUrl={onUrl}
          />
        </View>
        {textOptions?.trailingBlank ? (
          <View style={{ height: fontSize * 1.55 }} />
        ) : null}

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
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  ownBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  collapsed: { overflow: 'hidden' },
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
