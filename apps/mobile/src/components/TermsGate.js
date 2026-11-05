/**
 * 初回起動時の同意画面（App Store Review Guideline 1.2）。同意するまでアプリの他の画面は
 * 開けない。最後まで読むと同意できる。文言を変えて `TERMS_VERSION` を上げると、もう一度出る。
 */

import React, { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { openInAppBrowser } from 'lib/inAppBrowser'
import { hasReachedEnd, PRIVACY_URL, TERMS_URL } from 'lib/terms'
import { useEmberTheme } from 'theme/ember'
import TermsBody from './TermsBody'

export default function TermsGate({ onAccept }) {
  const theme = useEmberTheme()
  const insets = useSafeAreaInsets()
  const [readToEnd, setReadToEnd] = useState(false)
  const viewportHeight = useRef(0)

  const onScroll = useCallback(({ nativeEvent }) => {
    const { contentOffset, layoutMeasurement, contentSize } = nativeEvent
    if (
      hasReachedEnd(
        contentOffset.y,
        layoutMeasurement.height,
        contentSize.height,
      )
    ) {
      setReadToEnd(true)
    }
  }, [])

  // スクロールしなくても全部見える端末では、最初から同意できる
  const onContentSizeChange = useCallback((_, height) => {
    if (
      viewportHeight.current > 0 &&
      hasReachedEnd(0, viewportHeight.current, height)
    ) {
      setReadToEnd(true)
    }
  }, [])

  return (
    <View
      style={[
        styles.flex,
        {
          backgroundColor: theme.bg,
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 12,
        },
      ]}
    >
      <Text style={[styles.heading, { color: theme.text }]}>ご利用の前に</Text>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        onLayout={(e) => {
          viewportHeight.current = e.nativeEvent.layout.height
        }}
        onScroll={onScroll}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={100}
      >
        <TermsBody theme={theme} />
        <View style={styles.links}>
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => openInAppBrowser(TERMS_URL)}
          >
            <Text style={{ color: theme.accent, fontSize: 14 }}>利用規約</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => openInAppBrowser(PRIVACY_URL)}
          >
            <Text style={{ color: theme.accent, fontSize: 14 }}>
              プライバシーポリシー
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Text style={[styles.hint, { color: theme.textDim }]}>
          {readToEnd
            ? '18 歳以上で、上記の内容に同意する場合のみご利用いただけます。'
            : '最後まで読むと同意できます。'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="同意して始める"
          accessibilityState={{ disabled: !readToEnd }}
          disabled={!readToEnd}
          onPress={onAccept}
          style={[
            styles.button,
            { backgroundColor: theme.accent, opacity: readToEnd ? 1 : 0.4 },
          ]}
        >
          <Text style={[styles.buttonText, { color: theme.badgeText }]}>
            同意して始める
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  links: { flexDirection: 'row', gap: 20, marginTop: 20 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
  },
  hint: { fontSize: 12, textAlign: 'center' },
  button: { alignItems: 'center', borderRadius: 10, paddingVertical: 14 },
  buttonText: { fontSize: 16, fontWeight: '700' },
})
