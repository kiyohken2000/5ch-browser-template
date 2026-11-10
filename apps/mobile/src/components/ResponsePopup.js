/**
 * レスを並べるポップアップ。アンカー、被アンカー、ID、検索結果の一覧をすべてこれで出す。
 *
 * **不変条件 2: この中でも NG を効かせる。**
 * 呼ぶ側は `applyNg` を通した行だけを渡し、この部品は受け取った行をそのまま描く。
 *
 * **連鎖で辿れる**（§8-7 必須）。カードの中の `>>` をタップすると上にもう 1 枚重なる。
 * 外側をタップすると最前面の 1 枚だけ閉じる。カードは内容の高さに合わせ、下に必ず
 * タップできる隙間を残す。
 *
 * ヘッダーとタブより上に出すため、App.js に置いたポータルへ描く。メニューのシートは
 * さらに上の層に出る。
 */

import { Portal } from '@gorhom/portal'
import { BlurView } from 'expo-blur'
import React, { useCallback, useEffect } from 'react'
import {
  BackHandler,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'

import { shouldHideImages } from 'lib/ng'
import Icon from './Icon'
import ResponseBody from './ResponseBody'
import ResponseHeader from './ResponseHeader'
import ResponseMedia from './ResponseMedia'

/** App.js の PortalHost と揃える */
export const POPUP_HOST = 'response-popup'
const FADE_MS = 120
/** ツリーの 1 段の字下げ */
const TREE_INDENT = 12
/** カードの下に残す隙間。タップで閉じられる場所を必ず残す */
const BOTTOM_GAP = 96
const TOP_GAP = 8

function PopupLayer({
  sheet,
  index,
  isTop,
  glass,
  topInset,
  theme,
  fontSize,
  mediaOptions,
  onDismissAt,
  onCloseAll,
  onAnchor,
  onId,
  onUrl,
  onJump,
  onReply,
  onBe,
  onImage,
  idSeqs,
  textOptions,
}) {
  const { height } = useWindowDimensions()
  // ヘッダーは常に最前面に描かれるので、その下から始める
  const top = topInset + TOP_GAP

  const close = useCallback(() => onDismissAt(index), [onDismissAt, index])

  // Android の戻るボタンは、最前面の 1 枚だけを閉じる
  useEffect(() => {
    if (!isTop) return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close()
      return true
    })
    return () => sub.remove()
  }, [isTop, close])

  const renderItem = useCallback(
    ({ item }) => {
      if (item.ngMode === 'abone') {
        return (
          <View style={[styles.row, { borderColor: theme.border }]}>
            <Text style={{ color: theme.textFaint, fontSize: fontSize - 2 }}>
              あぼーん
            </Text>
          </View>
        )
      }
      return (
        <Pressable
          accessible={false}
          onPress={() => onJump && onJump(item.no)}
          style={[
            styles.row,
            { borderColor: theme.border },
            item.treeDepth > 0
              ? {
                  marginLeft: item.treeDepth * TREE_INDENT,
                  borderLeftWidth: StyleSheet.hairlineWidth,
                  borderLeftColor: theme.border,
                }
              : null,
            item.treeFocus ? { backgroundColor: theme.surfaceAlt } : null,
          ]}
        >
          <ResponseHeader
            row={item}
            theme={theme}
            fontSize={fontSize}
            idSeq={idSeqs?.get(item.no)}
            onId={onId}
            onBe={onBe}
            highlights={textOptions?.highlights}
            idColors={textOptions?.idColors !== false}
          />
          <ResponseBody
            parsed={item.parsed}
            textOptions={textOptions}
            hideImages={shouldHideImages(item)}
            theme={theme}
            fontSize={fontSize}
            onAnchor={(t) => onAnchor && onAnchor(t, item.no)}
            onId={onId}
            onUrl={onUrl}
          />
          <ResponseMedia
            media={item.media}
            options={mediaOptions}
            hideImages={shouldHideImages(item)}
            theme={theme}
            onImage={onImage}
            onUrl={onUrl}
          />
          {onReply ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`レス ${item.no} に返信`}
              hitSlop={8}
              onPress={() => onReply(item.no)}
              style={styles.reply}
            >
              <Text style={{ color: theme.accent, fontSize: fontSize - 3 }}>
                ここにレス
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      )
    },
    [
      theme,
      fontSize,
      mediaOptions,
      onJump,
      onReply,
      onBe,
      idSeqs,
      textOptions,
      onAnchor,
      onId,
      onUrl,
      onImage,
    ],
  )

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        entering={FadeIn.duration(FADE_MS)}
        exiting={FadeOut.duration(FADE_MS)}
        style={StyleSheet.absoluteFill}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ポップアップを閉じる"
          onPress={close}
          style={[
            StyleSheet.absoluteFill,
            index > 0 ? styles.scrimUpper : null,
            index === 0 && !glass ? styles.scrimBase : null,
          ]}
        >
          {index === 0 && glass ? (
            <BlurView
              tint={theme.dark ? 'dark' : 'light'}
              intensity={45}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
        </Pressable>
      </Animated.View>

      <Animated.View
        entering={FadeIn.duration(FADE_MS)}
        exiting={FadeOut.duration(FADE_MS)}
        accessibilityViewIsModal
        style={[
          styles.card,
          {
            top,
            maxHeight: height - top - BOTTOM_GAP,
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={[styles.head, { borderColor: theme.border }]}>
          <Pressable
            onPress={close}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="閉じる"
          >
            <Icon name="close" size={18} color={theme.textDim} />
          </Pressable>
          <Text
            style={[styles.title, { color: theme.textDim }]}
            numberOfLines={1}
          >
            {sheet.title}
          </Text>
          {index > 0 ? (
            <Pressable
              onPress={onCloseAll}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={[styles.headBtn, { color: theme.accent }]}>
                全部閉じる
              </Text>
            </Pressable>
          ) : null}
        </View>

        {sheet.lead ? (
          <Text
            selectable
            style={[
              styles.lead,
              { color: theme.text, borderColor: theme.border },
            ]}
          >
            {sheet.lead}
          </Text>
        ) : null}

        {sheet.actions && sheet.actions.length > 0 ? (
          <View style={[styles.actions, { borderColor: theme.border }]}>
            {sheet.actions.map((a) => (
              <Pressable
                key={a.label}
                onPress={a.onPress}
                hitSlop={6}
                accessibilityRole="button"
              >
                <Text style={[styles.action, { color: theme.accent }]}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <FlatList
          style={styles.list}
          data={sheet.rows}
          keyExtractor={(r) => String(r.no)}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: theme.textDim }}>
                {sheet.emptyText || '該当するレスがありません'}
              </Text>
            </View>
          }
        />
      </Animated.View>
    </View>
  )
}

export default function ResponsePopup({ stack, ...rest }) {
  // 閉じているときはポータルに何も置かない
  if (stack.length === 0) return null
  return (
    <Portal hostName={POPUP_HOST}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {stack.map((sheet, index) => (
          <PopupLayer
            // 積む順序は変わらないので位置をそのままキーにする
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            sheet={sheet}
            index={index}
            isTop={index === stack.length - 1}
            {...rest}
          />
        ))}
      </View>
    </Portal>
  )
}

const styles = StyleSheet.create({
  scrimBase: { backgroundColor: 'rgba(0,0,0,0.55)' },
  scrimUpper: { backgroundColor: 'rgba(0,0,0,0.35)' },
  card: {
    position: 'absolute',
    left: 6,
    right: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  headBtn: { fontSize: 13, fontWeight: '600' },
  title: { flex: 1, fontSize: 13, fontWeight: '600' },
  lead: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  action: { fontSize: 13, fontWeight: '600' },
  // カードが内容の高さに縮むように、伸ばさず縮められるだけにする
  list: { flexGrow: 0, flexShrink: 1 },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  reply: { alignSelf: 'flex-end', marginTop: 8 },
  empty: { padding: 24, alignItems: 'center' },
})
