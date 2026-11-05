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
 * 今のシートの上にもう 1 枚積む。下へドラッグか「戻る」で 1 枚ずつ戻る。
 * 積まれた枚数は `stack` が持ち、シート 1 枚が配列の要素 1 つに対応する。
 * 閉じる操作の結果は `onDismissAt` で受けて配列を切り詰める（画面と配列をずらさない）。
 *
 * 高さは半分と全画面の 2 段（§3-4）。ドラッグの処理は UI スレッドで動く（不変条件 4）。
 */

import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetModal,
} from '@gorhom/bottom-sheet'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  BackHandler,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { shouldHideImages } from 'lib/ng'
import ResponseBody from './ResponseBody'
import ResponseHeader from './ResponseHeader'
import ResponseMedia from './ResponseMedia'
import useSheetAnimation from './useSheetAnimation'

const SNAP_POINTS = ['55%', '92%']
/** シートの動きが止まるまでの時間（useSheetAnimation の 150ms より少し長く）。 */
const SHEET_SETTLE_MS = 200

function renderBackdrop(props) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
    />
  )
}

function SheetLayer({
  sheet,
  index,
  isTop,
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
  topInset,
  textOptions,
}) {
  const animationConfigs = useSheetAnimation()
  const ref = useRef(null)
  const insets = useSafeAreaInsets()
  const listBoxRef = useRef(null)
  const [listPad, setListPad] = useState(insets.bottom)

  // シートの中身の枠は最大の高さで作られ、途中の高さでは画面の下へはみ出す。はみ出した
  // 分を余白にしないと最後のレスに届かない。止まるたびに測り直す
  const measureList = useCallback(() => {
    setTimeout(() => {
      if (!listBoxRef.current) return
      listBoxRef.current.measureInWindow((x, y, width, height) => {
        const hidden = y + height - Dimensions.get('window').height
        setListPad(Math.max(0, hidden) + insets.bottom)
      })
    }, SHEET_SETTLE_MS)
  }, [insets.bottom])

  useEffect(() => {
    if (ref.current) ref.current.present()
  }, [])

  const dismiss = useCallback(() => {
    if (ref.current) ref.current.dismiss()
  }, [])

  // Android の戻るボタンは、いちばん上のシートだけを閉じる
  useEffect(() => {
    if (!isTop) return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss()
      return true
    })
    return () => sub.remove()
  }, [isTop, dismiss])

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
          style={[styles.row, { borderColor: theme.border }]}
        >
          <ResponseHeader
            row={item}
            theme={theme}
            fontSize={fontSize}
            idSeq={idSeqs?.get(item.no)}
            onId={onId}
            onBe={onBe}
            highlights={textOptions?.highlights}
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
    <BottomSheetModal
      animationConfigs={animationConfigs}
      accessible={false}
      ref={ref}
      name={`response-sheet-${index}`}
      stackBehavior="push"
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      enablePanDownToClose
      // 本文のスワイプはリストのスクロールに使う。途中の高さでもすぐ読み進められるように。
      // シートの高さはつまみで変える
      enableContentPanningGesture={false}
      // ヘッダーの裏へ入らないようにする。入るとつまみが隠れて掴めなくなる
      topInset={topInset}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.surface }}
      handleIndicatorStyle={{ backgroundColor: theme.textFaint }}
      onDismiss={() => onDismissAt(index)}
      onChange={measureList}
    >
      <View style={[styles.head, { borderColor: theme.border }]}>
        {index > 0 ? (
          <Pressable onPress={dismiss} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.headBtn, { color: theme.accent }]}>戻る</Text>
          </Pressable>
        ) : (
          <View style={styles.headSpacer} />
        )}
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {sheet.title}
        </Text>
        <Pressable onPress={onCloseAll} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.headBtn, { color: theme.accent }]}>閉じる</Text>
        </Pressable>
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

      <View ref={listBoxRef} style={styles.listBox} onLayout={measureList}>
        <BottomSheetFlatList
          data={sheet.rows}
          keyExtractor={(r) => String(r.no)}
          contentContainerStyle={{ paddingBottom: listPad }}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: theme.textDim }}>
                {sheet.emptyText || '該当するレスがありません'}
              </Text>
            </View>
          }
        />
      </View>
    </BottomSheetModal>
  )
}

export default function ResponseSheet({ stack, ...rest }) {
  return stack.map((sheet, index) => (
    <SheetLayer
      // 積む順序は変わらないので位置をそのままキーにする
      // eslint-disable-next-line react/no-array-index-key
      key={index}
      sheet={sheet}
      index={index}
      isTop={index === stack.length - 1}
      {...rest}
    />
  ))
}

const styles = StyleSheet.create({
  reply: { alignSelf: 'flex-end', marginTop: 8 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  headBtn: { fontSize: 14, fontWeight: '600' },
  headSpacer: { width: 36 },
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
  title: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700' },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  no: { fontWeight: '700' },
  name: { flexShrink: 1 },
  id: { fontWeight: '600' },
  listBox: { flex: 1 },
  empty: { padding: 24, alignItems: 'center' },
})
