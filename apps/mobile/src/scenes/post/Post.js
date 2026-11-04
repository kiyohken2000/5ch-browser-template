/**
 * 書き込み画面（§8-9）。スレビューから全画面モーダルで開く。
 *
 * **本文は失わない。** 入力中の本文はスレごとに保存し、消すのは書き込みが
 * 成功したときだけ。届いたか分からないときも残す（lib/post.js）。
 *
 * 送信ボタンは送信中に押せない。二重投稿を画面の側でも防ぐ。
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import {
  appendQuote,
  mailToRemember,
  mailToSend,
  sageChecked,
  withoutDraft,
  withDraft,
} from 'lib/postDrafts'
import { resultText, submitPost } from 'lib/post'
import { KEYS, load, save } from 'lib/storage'
import { normalizeExternalUrl } from 'lib/urls'
import { recordMyPost } from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'

const SAVE_DELAY_MS = 500

function warnIfFailed(ok, what) {
  if (!ok) console.warn(`[post] ${what}の保存に失敗した`)
}

export default function Post({ route, navigation }) {
  const { threadId, threadUrl, boardUrl, boardName, title, quote } =
    route.params
  const dispatch = useDispatch()
  const theme = useEmberTheme()
  const fontSize = useSelector((state) => state.settings.fontSize)
  const sageDefault = useSelector((state) => state.settings.composeSageDefault)
  // キーボードの余白の計算に使う、画面の上端の位置（ヘッダーの高さの分）
  const [topOffset, setTopOffset] = useState(0)
  const rootRef = useRef(null)

  const [name, setName] = useState('')
  const [mail, setMail] = useState('')
  // この書き込みだけの sage。保存せず、開くたびに設定の既定値から始める
  const [sage, setSage] = useState(sageDefault)
  const [message, setMessage] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const sendingRef = useRef(false)
  const draftsRef = useRef({})

  useEffect(() => {
    let alive = true
    Promise.all([load(KEYS.postDefaults, {}), load(KEYS.postDrafts, {})]).then(
      ([defaults, drafts]) => {
        if (!alive) return
        draftsRef.current = drafts && typeof drafts === 'object' ? drafts : {}
        setName(defaults?.name || '')
        setMail(mailToRemember(defaults?.mail))
        setMessage(appendQuote(draftsRef.current[threadUrl], quote))
        setLoaded(true)
      },
    )
    return () => {
      alive = false
    }
  }, [threadUrl, quote])

  const saveDraft = useCallback(
    (text) => {
      draftsRef.current = withDraft(draftsRef.current, threadUrl, text)
      save(KEYS.postDrafts, draftsRef.current).then((ok) =>
        warnIfFailed(ok, '本文'),
      )
    },
    [threadUrl],
  )

  // 入力が止まったら本文を保存する。落ちても書いた文章が残るように
  useEffect(() => {
    if (!loaded) return undefined
    const id = setTimeout(() => saveDraft(message), SAVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [loaded, message, saveDraft])

  // 入力の直後に閉じても、最後の入力まで残す。書き込めた本文だけは残さない
  const latestRef = useRef({ loaded: false, message: '', posted: false })
  latestRef.current.loaded = loaded
  latestRef.current.message = message
  useEffect(
    () => () => {
      const { loaded: ready, message: text, posted } = latestRef.current
      if (ready && !posted) saveDraft(text)
    },
    [saveDraft],
  )

  const send = useCallback(async () => {
    if (sendingRef.current || !message.trim()) return
    sendingRef.current = true
    setSending(true)
    setResult(null)
    const got = await submitPost({
      threadUrl,
      name,
      mail: mailToSend(mail, sageChecked(mail, sage)),
      message,
    })
    sendingRef.current = false
    setSending(false)

    save(KEYS.postDefaults, { name, mail: mailToRemember(mail) }).then((ok) =>
      warnIfFailed(ok, '名前とメール'),
    )

    if (got.kind !== 'success') {
      setResult(got)
      return
    }
    latestRef.current.posted = true
    dispatch(
      recordMyPost({
        threadId,
        threadUrl,
        boardUrl,
        boardName,
        title,
        message,
        at: Date.now(),
      }),
    )
    draftsRef.current = withoutDraft(draftsRef.current, threadUrl)
    save(KEYS.postDrafts, draftsRef.current).then((ok) =>
      warnIfFailed(ok, '本文'),
    )
    navigation.popTo('Thread', { postedAt: Date.now() }, { merge: true })
  }, [
    dispatch,
    threadId,
    threadUrl,
    boardUrl,
    boardName,
    title,
    name,
    mail,
    sage,
    message,
    navigation,
  ])

  const canSend = loaded && !sending && message.trim().length > 0
  const sageOn = sageChecked(mail, sage)

  const toggleSage = useCallback(
    (on) => {
      setSage(on)
      // 手で打った sage を残すと、切ったのに sage で飛んでしまう
      if (!on) setMail((current) => mailToRemember(current))
    },
    [setMail],
  )

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '書き込み',
      headerRight: () =>
        sending ? (
          <ActivityIndicator color={theme.accent} style={styles.headerBtn} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="送信"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            hitSlop={8}
            onPress={send}
            style={styles.headerBtn}
          >
            <Text
              style={[
                styles.send,
                { color: canSend ? theme.accent : theme.textFaint },
              ]}
            >
              送信
            </Text>
          </Pressable>
        ),
    })
  }, [navigation, sending, canSend, send, theme.accent, theme.textFaint])

  const authUrl = result?.authUrl ? normalizeExternalUrl(result.authUrl) : null

  return (
    <KeyboardAvoidingView
      ref={rootRef}
      behavior="padding"
      keyboardVerticalOffset={topOffset}
      onLayout={() =>
        rootRef.current?.measureInWindow?.((x, y) => setTopOffset(y))
      }
      style={[styles.flex, { backgroundColor: theme.bg }]}
    >
      {title ? (
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            { color: theme.textDim, borderColor: theme.border },
          ]}
        >
          {title}
        </Text>
      ) : null}

      {result ? (
        <View style={[styles.result, { backgroundColor: theme.accentDim }]}>
          <Text style={{ color: theme.danger, fontSize: 13, lineHeight: 19 }}>
            {resultText(result)}
          </Text>
          {authUrl ? (
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                Linking.openURL(authUrl).catch((e) =>
                  console.warn(
                    `[post] 認証ページを開けない: ${e?.message || e}`,
                  ),
                )
              }
            >
              <Text style={[styles.link, { color: theme.accent }]}>
                ブラウザで認証する
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.fields, { borderColor: theme.border }]}>
        <TextInput
          accessibilityLabel="名前"
          value={name}
          onChangeText={setName}
          placeholder="名前（省略可）"
          placeholderTextColor={theme.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
          editable={!sending}
          style={[styles.field, { color: theme.text }]}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <TextInput
          accessibilityLabel="メール"
          value={sage ? 'sage' : mail}
          onChangeText={setMail}
          placeholder="メール（sage など）"
          placeholderTextColor={theme.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
          editable={!sending && !sage}
          style={[styles.field, { color: sage ? theme.textFaint : theme.text }]}
        />
      </View>

      <View style={[styles.sageRow, { borderColor: theme.border }]}>
        <Text style={{ color: theme.text, fontSize: 14 }}>sage</Text>
        <Switch
          accessibilityLabel="sage"
          value={sageOn}
          onValueChange={toggleSage}
          disabled={sending}
          trackColor={{ true: theme.accent }}
        />
      </View>

      <TextInput
        accessibilityLabel="本文"
        value={message}
        onChangeText={setMessage}
        placeholder="本文"
        placeholderTextColor={theme.textFaint}
        multiline
        autoFocus
        textAlignVertical="top"
        editable={!sending}
        style={[styles.body, { color: theme.text, fontSize }]}
      />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerBtn: { paddingHorizontal: 16 },
  send: { fontSize: 16, fontWeight: '600' },
  title: {
    fontSize: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  result: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  link: { fontSize: 14, fontWeight: '600' },
  fields: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  field: { flex: 1, fontSize: 14, paddingHorizontal: 16, paddingVertical: 10 },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  sageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, padding: 16, lineHeight: 22 },
})
