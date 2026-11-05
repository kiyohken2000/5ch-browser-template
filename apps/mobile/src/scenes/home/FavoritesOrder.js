/**
 * お気に入りの並べ替え。右端のつまみをドラッグして動かす。
 */

import React, { useCallback } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import DraggableFlatList, {
  ScaleDecorator,
} from 'react-native-draggable-flatlist'
import { useDispatch, useSelector } from 'react-redux'

import { setFavoriteOrder } from 'slices/watch.slice'
import { useEmberTheme } from 'theme/ember'

export default function FavoritesOrder() {
  const theme = useEmberTheme()
  const dispatch = useDispatch()
  const favorites = useSelector((state) => state.watch.favorites)

  const renderItem = useCallback(
    ({ item, drag, isActive }) => (
      <ScaleDecorator>
        <View
          style={[
            styles.row,
            {
              backgroundColor: isActive ? theme.surfaceAlt : theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.text}>
            <Text numberOfLines={2} style={{ color: theme.text, fontSize: 14 }}>
              {item.title || '(無題)'}
            </Text>
            <Text style={{ color: theme.textFaint, fontSize: 11 }}>
              {item.boardName}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title || '無題'} を動かす`}
            hitSlop={10}
            onPressIn={drag}
            style={styles.handle}
          >
            <Text style={[styles.handleText, { color: theme.textDim }]}>≡</Text>
          </Pressable>
        </View>
      </ScaleDecorator>
    ),
    [theme],
  )

  return (
    <DraggableFlatList
      style={{ backgroundColor: theme.bg }}
      data={favorites}
      keyExtractor={(item) => item.threadId}
      renderItem={renderItem}
      onDragEnd={({ data }) =>
        dispatch(setFavoriteOrder(data.map((t) => t.threadId)))
      }
    />
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingLeft: 14,
    minHeight: 56,
  },
  text: { flex: 1, gap: 2, paddingVertical: 8 },
  handle: { paddingHorizontal: 16, paddingVertical: 10 },
  handleText: { fontSize: 24 },
})
