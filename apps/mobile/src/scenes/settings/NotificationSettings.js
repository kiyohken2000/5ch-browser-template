/**
 * 通知の設定（§9-8）。全体のスイッチはホームのベルと同じ値。
 * 種類ごとのスイッチ、監視の「N 件以上」、テスト通知と今すぐ確認を置く。
 */

import { useFocusEffect } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import {
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'

import {
  SettingRow,
  SettingsScreen,
  SettingToggle,
  useSettingValues,
} from 'components/SettingsRows'
import SettingsSection from 'components/SettingsSection'
import { watchEnabled } from 'lib/homeSegments'
import {
  backgroundIntervals,
  describeNotifyDiag,
  describeRun,
  formatMinutes,
  MAX_WATCH_THRESHOLD,
  NOTIFY_POSTED_DAYS,
  NOTIFY_POSTED_MAX,
  normalizeWatchThreshold,
} from 'lib/notify'
import {
  loadNotifyDiag,
  loadRunLog,
  runNotifyCheck,
  sendTestNotification,
} from 'lib/notifyTask'
import { MAX_WATCHED } from 'lib/threadLists'
import { useEmberTheme } from 'theme/ember'
import { showToast } from 'utils/showToast'
import useNotifySwitch from 'utils/useNotifySwitch'

const NOTE =
  '通知は OS が空いた時間に確認するので、数分〜数時間遅れることがあります。' +
  '必ず届くわけではありません。iOS ではアプリを上にスワイプして終了すると' +
  '届かなくなります。NG で隠れるレスでは通知しません。'

function openOsSettings() {
  Linking.openSettings().catch((e) =>
    console.warn(`[notify] OS の設定を開けない: ${e?.message || e}`),
  )
}

function checkResultToast(result) {
  if (result.failed > 0 && result.checked === 0) {
    return { title: '確認できませんでした', body: '通信を確かめてください' }
  }
  const title =
    result.notified > 0
      ? `${result.notified} 件の通知を出しました`
      : '新しい通知はありません'
  return {
    title,
    body: result.failed > 0 ? `${result.failed} 本は読めませんでした` : '',
  }
}

export default function NotificationSettings() {
  const theme = useEmberTheme()
  const { settings, set } = useSettingValues()
  const { enabled, permission, setEnabled } = useNotifySwitch()
  const [busy, setBusy] = useState(false)
  const [runLog, setRunLog] = useState([])
  const [diag, setDiag] = useState(null)
  const refreshRunLog = useCallback(() => {
    loadRunLog()
      .then(setRunLog)
      .catch((e) =>
        console.warn(`[notify] 巡回の記録を読めない: ${e?.message || e}`),
      )
    loadNotifyDiag()
      .then(setDiag)
      .catch((e) =>
        console.warn(`[notify] 巡回の診断を読めない: ${e?.message || e}`),
      )
  }, [])
  useFocusEffect(refreshRunLog)
  const lastBackground = runLog.find((r) => r.background)
  const intervals = backgroundIntervals(runLog)
  const threshold = normalizeWatchThreshold(settings.notifyWatchThreshold)
  const denied = permission === 'denied'
  const noKinds = !settings.notifyReplies && !settings.notifyWatch
  const watchShown = watchEnabled(settings.homeSegmentsShown)

  const toggle = async (on) => {
    const ok = await setEnabled(on)
    refreshRunLog()
    if (!ok) {
      showToast({
        title: '通知が許可されていません',
        body: 'OS の設定で Ember の通知を許可してください',
      })
    }
  }

  const test = async () => {
    try {
      await sendTestNotification()
    } catch (e) {
      console.warn(`[notify] テスト通知を出せない: ${e?.message || e}`)
      showToast({ title: 'テスト通知を出せませんでした' })
    }
  }

  const checkNow = async () => {
    if (busy) return
    setBusy(true)
    try {
      showToast(checkResultToast(await runNotifyCheck({ foreground: true })))
    } catch (e) {
      console.warn(`[notify] 今すぐ確認に失敗: ${e?.message || e}`)
      showToast({ title: '確認できませんでした' })
    } finally {
      setBusy(false)
      refreshRunLog()
    }
  }

  const button = (label, onPress, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, { borderColor: theme.border }]}
    >
      <Text
        style={[
          styles.label,
          { color: disabled ? theme.textFaint : theme.accent },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )

  const steps = [
    ['－', '件数を減らす', Math.max(1, threshold - 1)],
    ['＋', '件数を増やす', Math.min(MAX_WATCH_THRESHOLD, threshold + 1)],
  ]

  let mainHint
  if (denied) mainHint = 'OS の設定で通知が切られています'
  else if (enabled && noKinds) mainHint = '通知する種類がありません'

  return (
    <SettingsScreen>
      <SettingsSection title="通知" theme={theme}>
        <SettingRow label="通知する" hint={mainHint}>
          <Switch
            accessibilityLabel="通知する"
            value={enabled}
            onValueChange={toggle}
            trackColor={{ true: theme.accent }}
          />
        </SettingRow>
        {denied ? button('OS の設定を開く', openOsSettings) : null}
      </SettingsSection>

      <SettingsSection title="通知する種類" theme={theme}>
        <SettingToggle
          settingKey="notifyReplies"
          label="自分宛てのレス"
          hint={`書いてから ${NOTIFY_POSTED_DAYS} 日以内のスレ（新しい順に ${NOTIFY_POSTED_MAX} 本まで）で、自分のレスへの返信`}
        />
        <SettingToggle
          settingKey="notifyWatch"
          label="監視中のスレの新着"
          hint={
            watchShown
              ? `ホームの「監視」に入れたスレ（${MAX_WATCHED} 本まで）。スレごとに 1 件にまとめます`
              : 'ホームの設定で「監視」を表示すると使えます'
          }
        />
        <SettingRow
          label="新着が何件から通知するか"
          hint={`${threshold} 件以上`}
        >
          <View style={styles.steps}>
            {steps.map(([mark, label, next]) => (
              <Pressable
                key={mark}
                accessibilityRole="button"
                accessibilityLabel={label}
                disabled={!settings.notifyWatch}
                onPress={() => set('notifyWatchThreshold', next)}
                style={[styles.stepper, { borderColor: theme.border }]}
              >
                <Text
                  style={{
                    color: settings.notifyWatch ? theme.text : theme.textFaint,
                  }}
                >
                  {mark}
                </Text>
              </Pressable>
            ))}
          </View>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="確認" theme={theme}>
        {button('テスト通知を送る', test, denied)}
        {button(busy ? '確認しています…' : '今すぐ確認', checkNow, busy)}
      </SettingsSection>

      <SettingsSection title="巡回の記録" theme={theme}>
        <SettingRow
          label="最後のバックグラウンド巡回"
          hint={lastBackground ? describeRun(lastBackground) : 'まだありません'}
        />
        <SettingRow
          label="バックグラウンド巡回の間隔"
          hint={
            intervals
              ? `平均 ${formatMinutes(
                  intervals.averageMin,
                )}（最短 ${formatMinutes(
                  intervals.minMin,
                )}・最長 ${formatMinutes(intervals.maxMin)}、直近 ${
                  intervals.count
                } 回）`
              : '2 回以上動くと出ます'
          }
        />
        {runLog.length > 0 ? (
          <View style={[styles.row, { borderColor: theme.border }]}>
            {runLog.slice(0, 5).map((r) => (
              <Text
                key={`${r.at}-${r.background}`}
                style={[styles.logLine, { color: theme.textDim }]}
              >
                {describeRun(r)}
              </Text>
            ))}
          </View>
        ) : null}
      </SettingsSection>

      <SettingsSection title="巡回の診断" theme={theme}>
        {diag
          ? describeNotifyDiag(diag).map((row) => (
              <SettingRow key={row.label} label={row.label} hint={row.hint} />
            ))
          : null}
      </SettingsSection>

      <Text style={[styles.note, { color: theme.textFaint }]}>{NOTE}</Text>
    </SettingsScreen>
  )
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 15 },
  steps: { flexDirection: 'row', gap: 6 },
  stepper: {
    width: 36,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: { fontSize: 12, lineHeight: 18, paddingHorizontal: 20 },
  logLine: { fontSize: 12, lineHeight: 18 },
})
