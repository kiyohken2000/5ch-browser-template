/**
 * 書き込み画面（§8-9）。スレビューから全画面モーダルで開く。
 *
 * **本文は失わない。** 入力中の本文はスレごとに保存し、消すのは書き込みが
 * 成功したときだけ。届いたか分からないときも残す（lib/post.js）。
 *
 * 送信ボタンは送信中に押せない。二重投稿を画面の側でも防ぐ。
 */

import { CommonActions } from '@react-navigation/native'
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Toast from 'react-native-toast-message'

import ResponseBody from 'components/ResponseBody'
import TermsBody from 'components/TermsBody'
import { parseBody } from 'lib/body'
import {
  appendQuote,
  mailToRemember,
  mailToSend,
  messageStats,
  messageToDatBody,
  pushName,
  sageChecked,
  withoutDraft,
  withDraft,
} from 'lib/postDrafts'
import { resultText, submitPost } from 'lib/post'
import { KEYS, load, save } from 'lib/storage'
import { hasConsented, TERMS_VERSION } from 'lib/terms'
import { normalizeExternalUrl } from 'lib/urls'
import { recordMyPost } from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'

const SAVE_DELAY_MS = 500

function warnIfFailed(ok, what) {
  if (!ok) console.warn(`[post] ${what}の保存に失敗した`)
}

export default function Post({ route, navigation }) {
  const {
    threadId,
    threadUrl,
    threadRouteKey,
    boardUrl,
    boardName,
    title,
    quote,
  } = route.params
  const dispatch = useDispatch()
  const beLoggedIn = useSelector((state) => state.account.be.status === 'in')
  const upliftLoggedIn = useSelector(
    (state) => state.account.uplift.status === 'in',
  )
  const theme = useEmberTheme()
  const fontSize = useSelector((state) => state.settings.fontSize)
  const sageDefault = useSelector((state) => state.settings.composeSageDefault)
  const keepOpen = useSelector((state) => state.settings.composeKeepOpen)
  const keepHistory = useSelector((state) => state.settings.keepPostHistory)
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
  /** null は確認中。同意するまで入力欄を出さない */
  const [consented, setConsented] = useState(null)
  const [names, setNames] = useState([])
  const [nameFocused, setNameFocused] = useState(false)
  const [preview, setPreview] = useState(false)
  const sendingRef = useRef(false)
  const draftsRef = useRef({})

  useEffect(() => {
    let alive = true
    load(KEYS.termsConsent, null).then((stored) => {
      if (alive) setConsented(hasConsented(stored))
    })
    return () => {
      alive = false
    }
  }, [])

  const acceptTerms = useCallback(() => {
    setConsented(true)
    save(KEYS.termsConsent, { version: TERMS_VERSION, at: Date.now() }).then(
      (ok) => warnIfFailed(ok, '同意'),
    )
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([
      load(KEYS.postDefaults, {}),
      load(KEYS.postDrafts, {}),
      load(KEYS.nameHistory, []),
    ]).then(([defaults, drafts, history]) => {
      if (!alive) return
      setNames(Array.isArray(history) ? history : [])
      draftsRef.current = drafts && typeof drafts === 'object' ? drafts : {}
      setName(defaults?.name || '')
      setMail(mailToRemember(defaults?.mail))
      setMessage(appendQuote(draftsRef.current[threadUrl], quote))
      setLoaded(true)
    })
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
    const nextNames = pushName(names, name)
    setNames(nextNames)
    save(KEYS.nameHistory, nextNames).then((ok) => warnIfFailed(ok, '名前履歴'))
    if (keepHistory) {
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
    }
    draftsRef.current = withoutDraft(draftsRef.current, threadUrl)
    save(KEYS.postDrafts, draftsRef.current).then((ok) =>
      warnIfFailed(ok, '本文'),
    )
    if (keepOpen && threadRouteKey) {
      // 閉じずに次を書ける。後ろのスレには新着を取りに行かせる
      setMessage('')
      setPreview(false)
      Toast.show({ type: 'success', text1: '書き込みました' })
      navigation.dispatch({
        ...CommonActions.setParams({ postedAt: Date.now() }),
        source: threadRouteKey,
      })
      return
    }
    latestRef.current.posted = true
    navigation.popTo('Thread', { postedAt: Date.now() }, { merge: true })
  }, [
    dispatch,
    threadId,
    threadUrl,
    threadRouteKey,
    boardUrl,
    boardName,
    title,
    name,
    names,
    mail,
    sage,
    message,
    navigation,
    keepOpen,
    keepHistory,
  ])

  const canSend =
    consented === true && loaded && !sending && message.trim().length > 0
  const stats = messageStats(message)
  const previewBody = useMemo(
    () => (preview ? parseBody(messageToDatBody(message)) : null),
    [preview, message],
  )
  const nameChoices = names.filter((n) => n !== name)
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
    if (consented === false) {
      navigation.setOptions({
        title: '書き込みの利用条件',
        headerRight: () => null,
      })
      return
    }
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
  }, [
    navigation,
    consented,
    sending,
    canSend,
    send,
    theme.accent,
    theme.textFaint,
  ])

  const authUrl = result?.authUrl ? normalizeExternalUrl(result.authUrl) : null

  if (consented === null) {
    return <View style={[styles.flex, { backgroundColor: theme.bg }]} />
  }

  if (consented === false) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.bg }]}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.termsBody}
        >
          <Text style={[styles.termsLead, { color: theme.text }]}>
            初めて書き込む前に、次の内容を確認してください。
          </Text>
          <TermsBody theme={theme} />
        </ScrollView>
        <View style={[styles.termsActions, { borderColor: theme.border }]}>
          <Pressable
            accessibilityRole="button"
            onPress={acceptTerms}
            style={[styles.termsAgree, { backgroundColor: theme.accent }]}
          >
            <Text style={[styles.termsAgreeText, { color: theme.badgeText }]}>
              同意して書き込む
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => navigation.goBack()}
          >
            <Text style={{ color: theme.textDim, fontSize: 14 }}>
              同意しない
            </Text>
          </Pressable>
        </View>
      </View>
    )
  }

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
          onFocus={() => setNameFocused(true)}
          onBlur={() => setNameFocused(false)}
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

      {nameFocused && nameChoices.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={[styles.names, { borderColor: theme.border }]}
          contentContainerStyle={styles.namesContent}
        >
          {nameChoices.map((n) => (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`名前を ${n} にする`}
              onPress={() => setName(n)}
              style={[styles.nameChip, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.textDim, fontSize: 12 }}>{n}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={[styles.sageRow, { borderColor: theme.border }]}>
        <Text style={{ color: theme.text, fontSize: 14 }}>sage</Text>
        <Text style={[styles.accountHint, { color: theme.textDim }]}>
          {[beLoggedIn ? 'BE' : null, upliftLoggedIn ? 'UPLIFT' : null]
            .filter(Boolean)
            .join(' / ')}
        </Text>
        <Switch
          accessibilityLabel="sage"
          value={sageOn}
          onValueChange={toggleSage}
          disabled={sending}
          trackColor={{ true: theme.accent }}
        />
      </View>

      {previewBody ? (
        <ScrollView
          accessibilityLabel="プレビュー"
          style={styles.flex}
          contentContainerStyle={styles.previewBody}
        >
          <ResponseBody
            parsed={previewBody}
            theme={theme}
            fontSize={fontSize}
          />
        </ScrollView>
      ) : (
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
      )}

      <View style={[styles.counterRow, { borderColor: theme.border }]}>
        <Text style={{ color: theme.textDim, fontSize: 12 }}>
          {`${stats.chars} 文字 / ${stats.lines} 行`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: preview }}
          hitSlop={8}
          onPress={() => setPreview((v) => !v)}
        >
          <Text
            style={{ color: theme.accent, fontSize: 13, fontWeight: '600' }}
          >
            {preview ? '編集に戻る' : 'プレビュー'}
          </Text>
        </Pressable>
      </View>
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
  accountHint: { flex: 1, fontSize: 12, textAlign: 'right', paddingRight: 12 },
  sageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, padding: 16, lineHeight: 22 },
  previewBody: { padding: 16 },
  termsBody: { padding: 20, gap: 18 },
  termsLead: { fontSize: 15, lineHeight: 22 },
  termsActions: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  termsAgree: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 10,
  },
  termsAgreeText: { fontSize: 15, fontWeight: '700' },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  names: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  namesContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  nameChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
})
