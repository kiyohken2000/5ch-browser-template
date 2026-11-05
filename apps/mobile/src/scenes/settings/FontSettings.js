/**
 * フォントの選択。端末のフォントを名前で探して選ぶ。各行はそのフォント自身で表示する。
 * `route.params.settingKey` は 'bodyFont' か 'aaFont'。
 */

import React, { useMemo, useState } from 'react'
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from 'components/Icon'
import {
  FONT_PRESETS,
  filterFonts,
  listDeviceFonts,
  resolveFontFamily,
} from 'lib/fonts'
import { setSetting } from 'slices/settings.slice'
import { useEmberTheme } from 'theme/ember'

const SAMPLE = 'あいう 亜愛 Abc 123'

export default function FontSettings({ route }) {
  const { settingKey } = route.params
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const current = useSelector((state) => state.settings[settingKey])
  const [query, setQuery] = useState('')

  const families = useMemo(() => listDeviceFonts(), [])
  const rows = useMemo(() => {
    const found = filterFonts(families, query).map((f) => ({
      value: f,
      label: f,
    }))
    return query.trim() ? found : [...FONT_PRESETS, ...found]
  }, [families, query])

  const renderItem = ({ item }) => {
    const selected = item.value === current
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={item.label}
        onPress={() =>
          dispatch(setSetting({ key: settingKey, value: item.value }))
        }
        style={[styles.row, { borderColor: theme.border }]}
      >
        <View style={styles.flex}>
          <Text style={{ color: theme.textDim, fontSize: 12 }}>
            {item.label}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: theme.text,
              fontSize: 17,
              fontFamily: resolveFontFamily(item.value),
            }}
          >
            {SAMPLE}
          </Text>
        </View>
        {selected ? <Icon name="check" size={18} color={theme.accent} /> : null}
      </Pressable>
    )
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <TextInput
        accessibilityLabel="フォントを検索"
        placeholder="フォント名で検索"
        placeholderTextColor={theme.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        value={query}
        onChangeText={setQuery}
        style={[
          styles.search,
          { color: theme.text, backgroundColor: theme.surface },
        ]}
      />
      <FlatList
        data={rows}
        keyExtractor={(item) => item.value}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textDim }]}>
            見つかりません
          </Text>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  search: { margin: 12, padding: 10, borderRadius: 8, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { padding: 24, textAlign: 'center', fontSize: 13 },
})
