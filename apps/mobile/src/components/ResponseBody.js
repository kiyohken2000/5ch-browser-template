/**
 * レス本文の描画。lib/body.js が作ったブロック / トークンを RN の要素にする。
 *
 * **解析と描画を分けてある。** 解析側（lib/body.js）はテストで固めてあるので、
 * ここは「取れたトークンをどう見せるか」だけを持つ。M1 の受け入れ条件 3
 * （`>>` の参照ポップアップ）はデスクトップ版で「たびたび壊れる」と指摘された
 * 箇所なので、壊れやすい解析をコンポーネントに書かない。
 *
 * AA ブロック（§9-2）:
 *   - 等幅フォントで出す
 *   - **横スクロール。** 幅に合わせて縮小しない（横長の AA で字が小さくなりすぎる）
 *   - **折りたたみの対象から外す**（呼ぶ側が `hasAa` を見て決める）
 */

import { Image } from 'expo-image'
import React from 'react'
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native'

import { splitBeIcons } from 'lib/body'
import { idColor } from 'lib/idcolor'
import { MONO_FONT } from 'theme/ember'

const mono = Platform.select(MONO_FONT)

/** 画像は文字の行に混ぜず、本文の上に置く。5ch の本文でも先頭の 1 行を占めている。 */
function BeIcons({ icons, size }) {
  return (
    <View style={styles.beIcons}>
      {icons.map((icon) => (
        <Image
          key={icon.url}
          source={{ uri: icon.url }}
          style={{ width: size, height: size }}
          contentFit="contain"
          cachePolicy="disk"
          accessibilityLabel="BE アイコン"
          onError={(e) =>
            console.warn(
              `[media] BE アイコンを読めない: ${icon.url}: ${
                e?.error || '不明なエラー'
              }`,
            )
          }
        />
      ))}
    </View>
  )
}

function InlineTokens({ tokens, theme, fontSize, onAnchor, onId, onUrl }) {
  if (tokens.length === 0) return null
  return (
    <Text
      style={[
        styles.body,
        { color: theme.text, fontSize, lineHeight: fontSize * 1.55 },
      ]}
    >
      {tokens.map((t, i) => {
        if (t.type === 'anchor') {
          return (
            <Text
              key={i}
              style={{ color: theme.link }}
              onPress={() => onAnchor && onAnchor(t)}
              suppressHighlighting={false}
            >
              {t.text}
            </Text>
          )
        }
        if (t.type === 'id') {
          return (
            <Text
              key={i}
              style={[
                styles.bodyId,
                { color: idColor(t.id, theme.dark) || theme.text },
              ]}
              onPress={() => onId && onId(t.id)}
            >
              {t.text}
            </Text>
          )
        }
        if (t.type === 'url') {
          return (
            <Text
              key={i}
              style={[styles.link, { color: theme.link }]}
              onPress={() => onUrl && onUrl(t.url)}
            >
              {t.text}
            </Text>
          )
        }
        return <Text key={i}>{t.text}</Text>
      })}
    </Text>
  )
}

function AaBlock({ block, theme, fontSize }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      style={[
        styles.aaWrap,
        { backgroundColor: theme.aaBg, borderColor: theme.border },
      ]}
      contentContainerStyle={styles.aaContent}
    >
      <Text
        style={[
          styles.aa,
          {
            color: theme.text,
            fontFamily: mono,
            fontSize: fontSize - 2,
            lineHeight: (fontSize - 2) * 1.2,
          },
        ]}
      >
        {block.lines.join('\n')}
      </Text>
    </ScrollView>
  )
}

export default function ResponseBody({
  parsed,
  theme,
  fontSize = 15,
  hideImages = false,
  onAnchor,
  onId,
  onUrl,
}) {
  return (
    <View style={styles.container}>
      {parsed.blocks.map((block, i) => {
        if (block.kind === 'aa') {
          return (
            <AaBlock key={i} block={block} theme={theme} fontSize={fontSize} />
          )
        }
        const { icons, tokens } = splitBeIcons(block.tokens)
        return (
          <React.Fragment key={i}>
            {icons.length > 0 && !hideImages ? (
              <BeIcons icons={icons} size={Math.round(fontSize * 1.6)} />
            ) : null}
            <InlineTokens
              tokens={tokens}
              theme={theme}
              fontSize={fontSize}
              onAnchor={onAnchor}
              onId={onId}
              onUrl={onUrl}
            />
          </React.Fragment>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  body: {},
  bodyId: { fontWeight: '600' },
  link: { textDecorationLine: 'underline' },
  beIcons: { flexDirection: 'row', gap: 4 },
  aaWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    marginVertical: 2,
  },
  aaContent: { paddingHorizontal: 8, paddingVertical: 6 },
  aa: { includeFontPadding: false },
})
